//! All file operations of FilmRoll Manager.
//! Every command works on the image files of one folder, sorted naturally
//! (scan_2 before scan_10), exactly the order the frontend shows.

use chrono::{NaiveDateTime, TimeDelta};
use img_parts::jpeg::{markers, Jpeg, JpegSegment};
use img_parts::Bytes;
use little_exif::exif_tag::ExifTag;
use little_exif::metadata::Metadata;
use little_exif::rational::uR64;
use serde::Deserialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

const IMAGE_EXTENSIONS: [&str; 5] = ["jpg", "jpeg", "png", "tif", "tiff"];
pub(crate) const XMP_HEADER: &[u8] = b"http://ns.adobe.com/xap/1.0/\0";
const SECONDS_BETWEEN_FRAMES: i64 = 3;
/// Only real film speeds count, so catalog numbers like "5219" are ignored
const STANDARD_ISO: [u16; 29] = [
    6, 8, 10, 12, 16, 20, 25, 32, 40, 50, 64, 80, 100, 125, 160, 200, 250, 320,
    400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 6400,
];

// ───────────────────────────── Helpers ─────────────────────────────

pub(crate) fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

pub(crate) fn extension(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().into_owned())
        .unwrap_or_default()
}

pub(crate) fn is_jpeg(path: &Path) -> bool {
    matches!(extension(path).to_lowercase().as_str(), "jpg" | "jpeg")
}

/// All supported images in `folder`, hidden files excluded, natural sort order.
pub(crate) fn collect_images(folder: &Path) -> Result<Vec<PathBuf>, String> {
    let entries = fs::read_dir(folder).map_err(|e| format!("Could not open the folder: {e}"))?;

    let mut files: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter(|path| !file_name(path).starts_with('.'))
        .filter(|path| IMAGE_EXTENSIONS.contains(&extension(path).to_lowercase().as_str()))
        .collect();

    files.sort_by(|a, b| natord::compare(&file_name(a), &file_name(b)));
    Ok(files)
}

/// The files a tool should work on: all images of the folder, or only the chosen
/// ones (matched by name against the folder's real files, always in natural order).
pub(crate) fn select_images(folder: &Path, only: Option<&[String]>) -> Result<Vec<PathBuf>, String> {
    let all = collect_images(folder)?;
    let Some(names) = only else { return Ok(all) };

    let wanted: HashSet<&str> = names.iter().map(String::as_str).collect();
    let chosen: Vec<PathBuf> = all.into_iter().filter(|p| wanted.contains(file_name(p).as_str())).collect();
    if chosen.len() != wanted.len() {
        return Err("Some of the selected files are no longer in the folder. Please reload the folder.".to_string());
    }
    if chosen.is_empty() {
        return Err("No files selected.".to_string());
    }
    Ok(chosen)
}

fn emit_progress(app: &AppHandle, value: f64) {
    let _ = app.emit("progress", value);
}

/// Removes characters that are not allowed in filenames on macOS, Windows or Linux.
fn sanitize(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect()
}

/// "Kodak Gold 200" → "Kodak-Gold-200"
fn film_slug(film: &str) -> String {
    let joined = film.split_whitespace().collect::<Vec<_>>().join("-");
    if joined.is_empty() { "Film".to_string() } else { sanitize(&joined) }
}

fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Renames `sources[i]` to `targets[i]` via temporary names, so files can
/// safely swap names with each other (needed for reversing the order).
fn two_pass_rename(
    progress: &dyn Fn(f64),
    folder: &Path,
    sources: &[PathBuf],
    targets: &[PathBuf],
) -> Result<(), String> {
    // Every file needs a unique new name (case-insensitive, like macOS/Windows)
    let mut seen = HashSet::new();
    for target in targets {
        if !seen.insert(file_name(target).to_lowercase()) {
            return Err(format!(
                "Two files would both be named \"{}\". Add a number (# or IMG-#) to your template.",
                file_name(target)
            ));
        }
    }

    // Never overwrite a file that is not part of this roll
    let source_names: HashSet<String> =
        sources.iter().map(|s| file_name(s).to_lowercase()).collect();
    for target in targets {
        if target.exists() && !source_names.contains(&file_name(target).to_lowercase()) {
            return Err(format!(
                "A file named \"{}\" already exists in this folder.",
                file_name(target)
            ));
        }
    }

    let total = sources.len().max(1) as f64;

    // Pass 1 – everything to a temporary name
    let mut temps = Vec::with_capacity(sources.len());
    for (i, source) in sources.iter().enumerate() {
        let temp = folder.join(format!("__filmroll_tmp_{i:06}.{}", extension(source)));
        fs::rename(source, &temp)
            .map_err(|e| format!("Could not rename \"{}\": {e}", file_name(source)))?;
        temps.push(temp);
        progress((i + 1) as f64 / total * 0.5);
    }

    // Pass 2 – temporary name to final name
    for (i, (temp, target)) in temps.iter().zip(targets).enumerate() {
        fs::rename(temp, target)
            .map_err(|e| format!("Could not rename to \"{}\": {e}", file_name(target)))?;
        progress(0.5 + (i + 1) as f64 / total * 0.5);
    }

    Ok(())
}

// ───────────────────────────── Commands ─────────────────────────────

/// Step 1 – returns the filenames of all images in the folder, in order.
#[tauri::command]
pub fn list_images(folder: String) -> Result<Vec<String>, String> {
    Ok(collect_images(Path::new(&folder))?
        .iter()
        .map(|path| file_name(path))
        .collect())
}

/// Step 2 – the first file gets the name of the last one, and so on.
#[tauri::command]
pub async fn reverse_order(app: AppHandle, folder: String, files: Option<Vec<String>>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        reverse_in(Path::new(&folder), files.as_deref(), &|v| emit_progress(&app, v))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn reverse_in(folder: &Path, only: Option<&[String]>, progress: &dyn Fn(f64)) -> Result<(), String> {
    {
        let files = select_images(folder, only)?;
        let count = files.len();

        let targets: Vec<PathBuf> = (0..count)
            .map(|i| {
                let donor = &files[count - 1 - i];
                let stem = donor.file_stem().unwrap_or_default().to_string_lossy();
                folder.join(format!("{stem}.{}", extension(&files[i])))
            })
            .collect();

        two_pass_rename(progress, folder, &files, &targets)
    }
}

#[derive(Deserialize)]
pub struct MetadataInput {
    pub(crate) camera: String,
    pub(crate) lens: String,
    pub(crate) film: String,
    pub(crate) date: String, // YYYY-MM-DD
    pub(crate) time: String, // HH:MM
}

/// Step 3 – writes date/time (+3 s per frame), camera, lens and film.
#[tauri::command]
pub async fn write_metadata(
    app: AppHandle,
    folder: String,
    meta: MetadataInput,
    files: Option<Vec<String>>,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        write_metadata_in(Path::new(&folder), files.as_deref(), &meta, &|v| emit_progress(&app, v))
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(crate) fn write_metadata_in(
    folder: &Path,
    only: Option<&[String]>,
    meta: &MetadataInput,
    progress: &dyn Fn(f64),
) -> Result<usize, String> {
    {
        let files = select_images(folder, only)?;
        let start = NaiveDateTime::parse_from_str(
            &format!("{} {}", meta.date, meta.time),
            "%Y-%m-%d %H:%M",
        )
        .map_err(|_| "Please enter a valid date and time.".to_string())?;

        let total = files.len().max(1) as f64;
        for (i, file) in files.iter().enumerate() {
            let timestamp = (start + TimeDelta::seconds(i as i64 * SECONDS_BETWEEN_FRAMES))
                .format("%Y:%m:%d %H:%M:%S")
                .to_string();
            write_file_metadata(file, &timestamp, meta)
                .map_err(|e| format!("\"{}\": {e}", file_name(file)))?;
            progress((i + 1) as f64 / total);
        }
        Ok(files.len())
    }
}

fn write_file_metadata(path: &Path, timestamp: &str, meta: &MetadataInput) -> Result<(), String> {
    let camera = meta.camera.trim();
    let lens = meta.lens.trim();
    let film = meta.film.trim();

    let mut exif = Metadata::new_from_path(path).unwrap_or_else(|_| Metadata::new());

    // Lab scans usually have no EXIF at all. Apple Photos ignores the whole EXIF
    // block (lens, focal length, ISO …) unless these required fields exist.
    add_required_exif_fields(&mut exif, path);

    exif.set_tag(ExifTag::DateTimeOriginal(timestamp.to_string()));
    exif.set_tag(ExifTag::CreateDate(timestamp.to_string()));
    exif.set_tag(ExifTag::ModifyDate(timestamp.to_string()));

    if !camera.is_empty() {
        exif.set_tag(ExifTag::Model(camera.to_string()));
    }

    if !lens.is_empty() {
        exif.set_tag(ExifTag::LensModel(lens.to_string()));
        let specs = parse_lens(lens);
        if let (Some(min), Some(max)) = (specs.focal_min, specs.focal_max) {
            // Focal length of the shot is only certain for prime lenses
            if min == max {
                exif.set_tag(ExifTag::FocalLength(vec![rational(min)]));
            }
            let f = specs.aperture.map(rational).unwrap_or(uR64 { nominator: 0, denominator: 0 });
            exif.set_tag(ExifTag::LensInfo(vec![rational(min), rational(max), f.clone(), f]));
        }
        if let Some(f_number) = specs.aperture {
            // EXIF stores the widest aperture as APEX value: 2 · log2(f-number)
            exif.set_tag(ExifTag::MaxApertureValue(vec![rational(2.0 * f_number.log2())]));
        }
    }

    if !film.is_empty() {
        if let Some(iso) = parse_film_iso(film) {
            exif.set_tag(ExifTag::ISO(vec![iso]));
        }
        // PNG/TIFF: no XMP writer here, so the film goes into the EXIF description
        if !is_jpeg(path) {
            exif.set_tag(ExifTag::ImageDescription(film.to_string()));
        }
    }

    exif.write_to_file(path).map_err(|e| e.to_string())?;

    if !film.is_empty() && is_jpeg(path) {
        write_xmp_film_label(path, film)?;
    }
    Ok(())
}

fn rational(value: f64) -> uR64 {
    uR64 { nominator: (value * 100.0).round() as u32, denominator: 100 }
}

/// Adds the fields the EXIF standard requires – only where they are missing,
/// so data the lab's scanner already wrote is never overwritten.
fn add_required_exif_fields(exif: &mut Metadata, path: &Path) {
    let missing = |exif: &Metadata, tag: ExifTag| exif.get_tag(&tag).next().is_none();

    if missing(exif, ExifTag::ExifVersion(vec![])) {
        exif.set_tag(ExifTag::ExifVersion(b"0232".to_vec()));
    }
    if missing(exif, ExifTag::FlashpixVersion(vec![])) {
        exif.set_tag(ExifTag::FlashpixVersion(b"0100".to_vec()));
    }
    if missing(exif, ExifTag::ComponentsConfiguration(vec![])) {
        exif.set_tag(ExifTag::ComponentsConfiguration(vec![1, 2, 3, 0]));
    }
    if missing(exif, ExifTag::ColorSpace(vec![])) {
        exif.set_tag(ExifTag::ColorSpace(vec![1])); // sRGB
    }
    if missing(exif, ExifTag::XResolution(vec![])) {
        exif.set_tag(ExifTag::XResolution(vec![uR64 { nominator: 72, denominator: 1 }]));
    }
    if missing(exif, ExifTag::YResolution(vec![])) {
        exif.set_tag(ExifTag::YResolution(vec![uR64 { nominator: 72, denominator: 1 }]));
    }
    if missing(exif, ExifTag::ResolutionUnit(vec![])) {
        exif.set_tag(ExifTag::ResolutionUnit(vec![2])); // inches
    }
    if missing(exif, ExifTag::YCbCrPositioning(vec![])) {
        exif.set_tag(ExifTag::YCbCrPositioning(vec![1]));
    }
    if let Ok(size) = imagesize::size(path) {
        if missing(exif, ExifTag::ExifImageWidth(vec![])) {
            exif.set_tag(ExifTag::ExifImageWidth(vec![size.width as u32]));
        }
        if missing(exif, ExifTag::ExifImageHeight(vec![])) {
            exif.set_tag(ExifTag::ExifImageHeight(vec![size.height as u32]));
        }
    }
}

#[derive(Debug, PartialEq)]
struct LensSpecs {
    focal_min: Option<f64>,
    focal_max: Option<f64>,
    aperture: Option<f64>,
}

/// Reads focal length and widest aperture from free text:
/// "Nikkor 50mm f/1.4", "Canon Lens SH 30mm ƒ1.7", "28-70mm F3.5-4.5", "1:2.8 35 mm"
fn parse_lens(text: &str) -> LensSpecs {
    let lower = text.to_lowercase().replace('ƒ', "f").replace(',', ".");
    let mut specs = LensSpecs { focal_min: None, focal_max: None, aperture: None };

    // Focal length: number(s) directly before "mm"
    if let Some(pos) = lower.find("mm") {
        let before = lower[..pos].trim_end();
        let start = before
            .rfind(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-'))
            .map(|i| i + 1)
            .unwrap_or(0);
        let numbers: Vec<f64> = before[start..]
            .split('-')
            .filter_map(|n| n.parse().ok())
            .filter(|n: &f64| *n > 0.0)
            .collect();
        match numbers.as_slice() {
            [single] => { specs.focal_min = Some(*single); specs.focal_max = Some(*single); }
            [min, max, ..] => { specs.focal_min = Some(*min); specs.focal_max = Some(*max); }
            _ => {}
        }
    }

    // Aperture: "f/1.4", "f1.4", "1:1.4" – first number after the marker
    for marker in ["f/", "1:", "f"] {
        let mut search = lower.as_str();
        while let Some(pos) = search.find(marker) {
            let rest = &search[pos + marker.len()..];
            let number: String = rest.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
            if let Ok(value) = number.trim_end_matches('.').parse::<f64>() {
                if (0.7..=64.0).contains(&value) {
                    specs.aperture = Some(value);
                    return specs;
                }
            }
            search = rest;
        }
    }
    specs
}

/// Film speed from the stock name: "Kodak Gold 200" → 200, "Cinestill 800T" → 800
fn parse_film_iso(film: &str) -> Option<u16> {
    film.split(|c: char| c.is_whitespace() || c == '-' || c == '/')
        .rev()
        .filter_map(|token| {
            // "800T" → 800, and one leading letter is fine too: "P3200", "E100"
            let digits = token.trim_end_matches(|c: char| c.is_ascii_alphabetic());
            let digits = digits.strip_prefix(|c: char| c.is_ascii_alphabetic()).unwrap_or(digits);
            if digits.len() >= 2 && digits.chars().all(|c| c.is_ascii_digit()) {
                digits.parse::<u16>().ok()
            } else {
                None
            }
        })
        .find(|iso| STANDARD_ISO.contains(iso))
}

/// Stores the film stock as xmp:Label inside the JPEG.
/// Only the metadata segment changes – image data stays byte-identical.
fn write_xmp_film_label(path: &Path, film: &str) -> Result<(), String> {
    let data = fs::read(path).map_err(|e| e.to_string())?;
    let mut jpeg = Jpeg::from_bytes(Bytes::from(data)).map_err(|e| e.to_string())?;

    // Replace an earlier XMP packet instead of stacking a second one
    jpeg.segments_mut().retain(|segment| {
        !(segment.marker() == markers::APP1 && segment.contents().starts_with(XMP_HEADER))
    });

    let packet = format!(
        r#"<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Label="{}"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>"#,
        xml_escape(film)
    );
    let mut contents = XMP_HEADER.to_vec();
    contents.extend_from_slice(packet.as_bytes());
    let segment = JpegSegment::new_with_contents(markers::APP1, Bytes::from(contents));

    // Place it right after the EXIF segment
    let position = jpeg
        .segments()
        .iter()
        .position(|s| s.marker() == markers::APP1)
        .map(|i| i + 1)
        .unwrap_or(0);
    jpeg.segments_mut().insert(position, segment);

    let mut output = Vec::new();
    jpeg.encoder().write_to(&mut output).map_err(|e| e.to_string())?;
    fs::write(path, output).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct TemplatePart {
    kind: String, // "text" | "date" | "num" | "imgnum" | "film"
    value: Option<String>,
}

/// Step 4 – renames every file according to the template.
#[tauri::command]
pub async fn rename_files(
    app: AppHandle,
    folder: String,
    parts: Vec<TemplatePart>,
    date: String,
    film: String,
    files: Option<Vec<String>>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        rename_in(Path::new(&folder), files.as_deref(), &parts, &date, &film, &|v| emit_progress(&app, v))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn rename_in(
    folder: &Path,
    only: Option<&[String]>,
    parts: &[TemplatePart],
    date: &str,
    film: &str,
    progress: &dyn Fn(f64),
) -> Result<(), String> {
    {
        let files = select_images(folder, only)?;
        let slug = film_slug(film);

        let mut targets = Vec::with_capacity(files.len());
        for (i, file) in files.iter().enumerate() {
            let number = format!("{:02}", i + 1);
            let base: String = parts
                .iter()
                .map(|part| match part.kind.as_str() {
                    "date" => date.to_string(),
                    "num" => number.clone(),
                    "imgnum" => format!("IMG-{number}"),
                    "film" => slug.clone(),
                    _ => sanitize(part.value.as_deref().unwrap_or("")),
                })
                .collect();
            let base = base.trim();
            if base.is_empty() {
                return Err("The filename template is empty.".to_string());
            }
            targets.push(folder.join(format!("{base}.{}", extension(file))));
        }

        two_pass_rename(progress, folder, &files, &targets)
    }
}


// ───────────────────────────── Rotate ─────────────────────────────

/// The orientation stored in the EXIF block (1 = normal if nothing is stored).
pub(crate) fn read_orientation(exif: &Metadata) -> u16 {
    match exif.get_tag(&ExifTag::Orientation(vec![])).next() {
        Some(ExifTag::Orientation(values)) => values.first().copied().filter(|v| (1..=8).contains(v)).unwrap_or(1),
        _ => 1,
    }
}

/// EXIF orientation after turning the picture by a quarter turn.
/// Pairs are (before, after) for a clockwise turn; mirrored orientations (2, 4, 5, 7) work too.
fn rotated_orientation(current: u16, clockwise: bool) -> u16 {
    const CLOCKWISE: [(u16, u16); 8] = [(1, 6), (6, 3), (3, 8), (8, 1), (2, 7), (7, 4), (4, 5), (5, 2)];
    let current = if (1..=8).contains(&current) { current } else { 1 };
    CLOCKWISE
        .iter()
        .find(|(before, after)| if clockwise { *before == current } else { *after == current })
        .map(|(before, after)| if clockwise { *after } else { *before })
        .unwrap_or(1)
}

/// Quick tool – turns the chosen pictures by a quarter turn.
/// Only the Orientation tag changes; the image data stays byte-identical.
#[tauri::command]
pub async fn rotate_images(
    app: AppHandle,
    folder: String,
    files: Vec<String>,
    clockwise: bool,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        rotate_in(Path::new(&folder), &files, clockwise, &|v| emit_progress(&app, v))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn rotate_in(folder: &Path, only: &[String], clockwise: bool, progress: &dyn Fn(f64)) -> Result<usize, String> {
    let files = select_images(folder, Some(only))?;
    let total = files.len().max(1) as f64;
    for (i, file) in files.iter().enumerate() {
        let mut exif = Metadata::new_from_path(file).unwrap_or_else(|_| Metadata::new());
        // Without the required EXIF fields Apple Photos would ignore the orientation, too
        add_required_exif_fields(&mut exif, file);
        let next = rotated_orientation(read_orientation(&exif), clockwise);
        exif.set_tag(ExifTag::Orientation(vec![next]));
        exif.write_to_file(file)
            .map_err(|e| format!("\"{}\": {e}", file_name(file)))?;
        progress((i + 1) as f64 / total);
    }
    Ok(files.len())
}

// ───────────────────────────── Tests ─────────────────────────────
// Run with:  cargo test   (inside src-tauri)

#[cfg(test)]
mod tests {
    use super::*;

    /// Creates a folder with `count` tiny JPEGs; each file's bytes encode its
    /// original position, so we can check where every frame ended up.
    fn roll(name: &str, count: usize) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("filmroll_test_{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        // Smallest valid JPEG (1×1 px), followed by a marker comment with the frame id
        let base: &[u8] = &[
            0xFF,0xD8,0xFF,0xDB,0x00,0x43,0x00,0x08,0x06,0x06,0x07,0x06,0x05,0x08,0x07,0x07,0x07,0x09,0x09,0x08,0x0A,0x0C,0x14,0x0D,0x0C,0x0B,0x0B,0x0C,0x19,0x12,0x13,0x0F,0x14,0x1D,0x1A,0x1F,0x1E,0x1D,0x1A,0x1C,0x1C,0x20,0x24,0x2E,0x27,0x20,0x22,0x2C,0x23,0x1C,0x1C,0x28,0x37,0x29,0x2C,0x30,0x31,0x34,0x34,0x34,0x1F,0x27,0x39,0x3D,0x38,0x32,0x3C,0x2E,0x33,0x34,0x32,
            0xFF,0xC0,0x00,0x0B,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,
            0xFF,0xC4,0x00,0x14,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x08,
            0xFF,0xC4,0x00,0x14,0x10,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
            0xFF,0xDA,0x00,0x08,0x01,0x01,0x00,0x00,0x3F,0x00,0x37,0xFF,0xD9,
        ];
        for i in 1..=count {
            let mut bytes = base[..2].to_vec();
            let tag = format!("frame{i:03}");
            bytes.extend_from_slice(&[0xFF, 0xFE, 0x00, (tag.len() + 2) as u8]);
            bytes.extend_from_slice(tag.as_bytes());
            bytes.extend_from_slice(&base[2..]);
            fs::write(dir.join(format!("scan_{i}.jpg")), bytes).unwrap();
        }
        dir
    }

    fn frame_id(path: &Path) -> String {
        let bytes = fs::read(path).unwrap();
        let pos = bytes.windows(5).position(|w| w == b"frame").unwrap();
        String::from_utf8_lossy(&bytes[pos..pos + 8]).into_owned()
    }

    fn names(dir: &Path) -> Vec<String> {
        collect_images(dir).unwrap().iter().map(|p| file_name(p)).collect()
    }

    #[test]
    fn natural_sort_order() {
        let dir = roll("sort", 12);
        let n = names(&dir);
        assert_eq!(n[0], "scan_1.jpg");
        assert_eq!(n[1], "scan_2.jpg");
        assert_eq!(n[11], "scan_12.jpg");
    }

    #[test]
    fn reverse_swaps_frames() {
        let dir = roll("reverse", 5);
        reverse_in(&dir, None, &|_| {}).unwrap();
        assert_eq!(names(&dir), vec!["scan_1.jpg", "scan_2.jpg", "scan_3.jpg", "scan_4.jpg", "scan_5.jpg"]);
        assert_eq!(frame_id(&dir.join("scan_1.jpg")), "frame005");
        assert_eq!(frame_id(&dir.join("scan_5.jpg")), "frame001");
        assert_eq!(frame_id(&dir.join("scan_3.jpg")), "frame003");
    }

    #[test]
    fn metadata_is_written_with_3s_offset() {
        let dir = roll("meta", 3);
        let meta = MetadataInput {
            camera: "Canon AE-1".into(), lens: "50mm f/1.4".into(), film: "Kodak Gold 200".into(),
            date: "2026-05-01".into(), time: "21:00".into(),
        };
        assert_eq!(write_metadata_in(&dir, None, &meta, &|_| {}).unwrap(), 3);

        let third = dir.join("scan_3.jpg");
        let exif = Metadata::new_from_path(&third).unwrap();
        let date = exif.get_tag(&ExifTag::DateTimeOriginal(String::new())).next().unwrap();
        assert_eq!(date, &ExifTag::DateTimeOriginal("2026:05:01 21:00:06".into()));
        let model = exif.get_tag(&ExifTag::Model(String::new())).next().unwrap();
        assert_eq!(model, &ExifTag::Model("Canon AE-1".into()));

        let bytes = fs::read(&third).unwrap();
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains(r#"xmp:Label="Kodak Gold 200""#));
        assert_eq!(frame_id(&third), "frame003"); // still the same image

        // Running it twice must not stack a second XMP packet
        write_metadata_in(&dir, None, &meta, &|_| {}).unwrap();
        let bytes = fs::read(&third).unwrap();
        assert_eq!(String::from_utf8_lossy(&bytes).matches("xmp:Label").count(), 1);
    }

    #[test]
    fn lab_scan_without_exif_gets_required_fields() {
        let dir = roll("required", 1);
        let meta = MetadataInput {
            camera: "Nikon FM3A".into(), lens: "Nikkor 50mm f/1.4".into(), film: "Portra 400".into(),
            date: "2026-05-01".into(), time: "21:00".into(),
        };
        write_metadata_in(&dir, None, &meta, &|_| {}).unwrap();
        let exif = Metadata::new_from_path(&dir.join("scan_1.jpg")).unwrap();
        assert!(exif.get_tag(&ExifTag::ExifVersion(vec![])).next().is_some());
        assert_eq!(exif.get_tag(&ExifTag::ISO(vec![])).next().unwrap(), &ExifTag::ISO(vec![400]));
        assert_eq!(
            exif.get_tag(&ExifTag::FocalLength(vec![])).next().unwrap(),
            &ExifTag::FocalLength(vec![uR64 { nominator: 5000, denominator: 100 }])
        );
    }

    #[test]
    fn lens_text_is_understood() {
        let s = parse_lens("Nikkor 50mm f/1.4");
        assert_eq!((s.focal_min, s.focal_max, s.aperture), (Some(50.0), Some(50.0), Some(1.4)));
        let s = parse_lens("Canon Lens SH 30mm ƒ1.7");
        assert_eq!((s.focal_min, s.aperture), (Some(30.0), Some(1.7)));
        let s = parse_lens("Zoom 28-70mm F3.5-4.5");
        assert_eq!((s.focal_min, s.focal_max, s.aperture), (Some(28.0), Some(70.0), Some(3.5)));
        let s = parse_lens("Zeiss Sonnar 1:2.8 38 mm");
        assert_eq!((s.focal_min, s.aperture), (Some(38.0), Some(2.8)));
        let s = parse_lens("Helios");
        assert_eq!((s.focal_min, s.aperture), (None, None));
    }

    #[test]
    fn film_speed_is_understood() {
        assert_eq!(parse_film_iso("Kodak Gold 200"), Some(200));
        assert_eq!(parse_film_iso("Cinestill 800T"), Some(800));
        assert_eq!(parse_film_iso("Kodak Vision3 500T 5219"), Some(500));
        assert_eq!(parse_film_iso("Ilford HP5 Plus"), None);
        assert_eq!(parse_film_iso("Fomapan 100 Classic"), Some(100));
        assert_eq!(parse_film_iso("Kodak T-Max P3200"), Some(3200));
        assert_eq!(parse_film_iso("Kodak Ektachrome E100"), Some(100));
        assert_eq!(parse_film_iso("Ilford FP4 Plus 125"), Some(125));
        assert_eq!(parse_film_iso("Ilford HP5"), None);
    }

    #[test]
    fn rename_from_template() {
        let dir = roll("rename", 3);
        let parts = vec![
            TemplatePart { kind: "date".into(), value: None },
            TemplatePart { kind: "text".into(), value: Some("_".into()) },
            TemplatePart { kind: "imgnum".into(), value: None },
            TemplatePart { kind: "text".into(), value: Some("_".into()) },
            TemplatePart { kind: "film".into(), value: None },
        ];
        rename_in(&dir, None, &parts, "2026-09-27", "Kodak Gold 200", &|_| {}).unwrap();
        assert_eq!(names(&dir), vec![
            "2026-09-27_IMG-01_Kodak-Gold-200.jpg",
            "2026-09-27_IMG-02_Kodak-Gold-200.jpg",
            "2026-09-27_IMG-03_Kodak-Gold-200.jpg",
        ]);
        assert_eq!(frame_id(&dir.join("2026-09-27_IMG-02_Kodak-Gold-200.jpg")), "frame002");
    }

    #[test]
    fn rename_refuses_duplicate_names() {
        let dir = roll("dupes", 3);
        let parts = vec![TemplatePart { kind: "film".into(), value: None }];
        let err = rename_in(&dir, None, &parts, "2026-09-27", "Portra 400", &|_| {}).unwrap_err();
        assert!(err.contains("same") || err.contains("both"));
        assert_eq!(names(&dir).len(), 3); // nothing was touched
        assert!(dir.join("scan_1.jpg").exists());
    }

    fn strings(names: &[&str]) -> Vec<String> {
        names.iter().map(|n| n.to_string()).collect()
    }

    #[test]
    fn reverse_only_selected_files() {
        let dir = roll("reverse_sel", 6);
        let only = strings(&["scan_2.jpg", "scan_3.jpg", "scan_5.jpg"]);
        reverse_in(&dir, Some(&only), &|_| {}).unwrap();
        // 2 ↔ 5, 3 stays in the middle; 1, 4 and 6 are untouched
        assert_eq!(frame_id(&dir.join("scan_2.jpg")), "frame005");
        assert_eq!(frame_id(&dir.join("scan_3.jpg")), "frame003");
        assert_eq!(frame_id(&dir.join("scan_5.jpg")), "frame002");
        assert_eq!(frame_id(&dir.join("scan_1.jpg")), "frame001");
        assert_eq!(frame_id(&dir.join("scan_4.jpg")), "frame004");
        assert_eq!(frame_id(&dir.join("scan_6.jpg")), "frame006");
    }

    #[test]
    fn metadata_only_for_selected_files() {
        let dir = roll("meta_sel", 4);
        let meta = MetadataInput {
            camera: "Canon AE-1".into(), lens: "".into(), film: "".into(),
            date: "2026-05-01".into(), time: "21:00".into(),
        };
        let only = strings(&["scan_2.jpg", "scan_4.jpg"]);
        assert_eq!(write_metadata_in(&dir, Some(&only), &meta, &|_| {}).unwrap(), 2);

        let model = |n: &str| Metadata::new_from_path(&dir.join(n)).ok()
            .and_then(|m| m.get_tag(&ExifTag::Model(String::new())).next().cloned());
        assert_eq!(model("scan_2.jpg"), Some(ExifTag::Model("Canon AE-1".into())));
        assert_eq!(model("scan_1.jpg"), None);
        // the second selected file is the second frame → +3 s
        let date = Metadata::new_from_path(&dir.join("scan_4.jpg")).unwrap()
            .get_tag(&ExifTag::DateTimeOriginal(String::new())).next().cloned();
        assert_eq!(date, Some(ExifTag::DateTimeOriginal("2026:05:01 21:00:03".into())));
    }

    #[test]
    fn rename_only_selected_and_protect_others() {
        let dir = roll("rename_sel", 4);
        let parts = vec![
            TemplatePart { kind: "text".into(), value: Some("pick_".into()) },
            TemplatePart { kind: "num".into(), value: None },
        ];
        let only = strings(&["scan_2.jpg", "scan_3.jpg"]);
        rename_in(&dir, Some(&only), &parts, "", "", &|_| {}).unwrap();
        assert_eq!(names(&dir), vec!["pick_01.jpg", "pick_02.jpg", "scan_1.jpg", "scan_4.jpg"]);

        // A target that belongs to a file outside the selection must never be overwritten
        let dir = roll("rename_protect", 3);
        let only = strings(&["scan_3.jpg"]);
        let parts = vec![TemplatePart { kind: "text".into(), value: Some("scan_1".into()) }];
        let err = rename_in(&dir, Some(&only), &parts, "", "", &|_| {}).unwrap_err();
        assert!(err.contains("already exists"));
        assert_eq!(names(&dir).len(), 3);
    }

    #[test]
    fn selection_must_exist() {
        let dir = roll("sel_missing", 2);
        let only = strings(&["nope.jpg"]);
        assert!(select_images(&dir, Some(&only)).is_err());
        assert!(select_images(&dir, Some(&[])).is_err());
    }

    #[test]
    fn rotation_table_matches_the_image_library() {
        // 2×3 picture with six different pixels, so every flip or turn is visible
        let base = image::RgbImage::from_fn(2, 3, |x, y| image::Rgb([(x * 40 + y * 10) as u8, y as u8, x as u8]));
        let shown = |orientation: u16| {
            let mut img = image::DynamicImage::ImageRgb8(base.clone());
            img.apply_orientation(image::metadata::Orientation::from_exif(orientation as u8).unwrap());
            img.to_rgb8()
        };
        for orientation in 1..=8u16 {
            let turned = image::DynamicImage::ImageRgb8(shown(orientation)).rotate90().to_rgb8();
            assert_eq!(shown(rotated_orientation(orientation, true)), turned, "clockwise from {orientation}");
            let back = rotated_orientation(rotated_orientation(orientation, true), false);
            assert_eq!(back, orientation, "counterclockwise undoes clockwise ({orientation})");
        }
        assert_eq!(rotated_orientation(0, true), 6);   // missing or invalid counts as normal
        assert_eq!(rotated_orientation(1, false), 8);
    }

    #[test]
    fn rotate_changes_only_the_orientation() {
        let dir = roll("rotate", 3);
        let meta = MetadataInput {
            camera: "Canon AE-1".into(), lens: "50mm f/1.4".into(), film: "Kodak Gold 200".into(),
            date: "2026-05-01".into(), time: "21:00".into(),
        };
        write_metadata_in(&dir, None, &meta, &|_| {}).unwrap();
        let before = fs::read(dir.join("scan_2.jpg")).unwrap();

        let only = strings(&["scan_2.jpg"]);
        assert_eq!(rotate_in(&dir, &only, true, &|_| {}).unwrap(), 1);
        let orientation = |n: &str| read_orientation(&Metadata::new_from_path(&dir.join(n)).unwrap());
        assert_eq!(orientation("scan_2.jpg"), 6);
        assert_eq!(orientation("scan_1.jpg"), 1);   // not selected
        rotate_in(&dir, &only, true, &|_| {}).unwrap();
        assert_eq!(orientation("scan_2.jpg"), 3);
        rotate_in(&dir, &only, false, &|_| {}).unwrap();
        assert_eq!(orientation("scan_2.jpg"), 6);

        // everything else survives: image frame, camera, film label
        let after = fs::read(dir.join("scan_2.jpg")).unwrap();
        assert_eq!(frame_id(&dir.join("scan_2.jpg")), "frame002");
        assert!(String::from_utf8_lossy(&after).contains(r#"xmp:Label="Kodak Gold 200""#));
        let exif = Metadata::new_from_path(&dir.join("scan_2.jpg")).unwrap();
        assert_eq!(exif.get_tag(&ExifTag::Model(String::new())).next().unwrap(), &ExifTag::Model("Canon AE-1".into()));
        assert!(after.len().abs_diff(before.len()) < 64);
    }
}
