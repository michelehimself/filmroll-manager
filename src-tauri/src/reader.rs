//! Read-only access for the file list: what is already written in each image,
//! and small preview pictures. Nothing here ever changes a file.

use crate::processor::{collect_images, file_name, is_jpeg, read_orientation, XMP_HEADER};
use img_parts::jpeg::{markers, Jpeg};
use img_parts::Bytes;
use little_exif::exif_tag::ExifTag;
use little_exif::metadata::Metadata;
use serde::Serialize;
use std::fs;
use std::path::Path;

const THUMBNAIL_SIZE: u32 = 200;
/// Big enough to judge a picture on a large screen, small enough to load quickly
const PREVIEW_SIZE: u32 = 1600;

#[derive(Serialize, Debug, Default, PartialEq)]
pub struct FileInfo {
    name: String,
    path: String,
    camera: String,
    lens: String,
    film: String,
    date: String, // "YYYY-MM-DD HH:MM:SS", empty if unknown
    aspect: f64,  // width / height as the picture is shown (after Rotate), 1.5 for a normal landscape frame
}

// ───────────────────────────── Helpers ─────────────────────────────

fn clean(text: &str) -> String {
    text.trim_matches(|c: char| c.is_whitespace() || c == '\0').to_string()
}

/// EXIF dates look like "2026:05:01 21:00:06"
fn pretty_date(exif_date: &str) -> String {
    let text = clean(exif_date);
    let mut chars: Vec<char> = text.chars().collect();
    if chars.len() >= 10 && chars[4] == ':' && chars[7] == ':' {
        chars[4] = '-';
        chars[7] = '-';
    }
    chars.into_iter().collect()
}

fn xml_unescape(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
}

/// The film stock of a JPEG lives in the XMP packet as xmp:Label.
fn read_xmp_label(path: &Path) -> Option<String> {
    let data = fs::read(path).ok()?;
    let jpeg = Jpeg::from_bytes(Bytes::from(data)).ok()?;
    for segment in jpeg.segments() {
        if segment.marker() == markers::APP1 && segment.contents().starts_with(XMP_HEADER) {
            let packet = String::from_utf8_lossy(&segment.contents()[XMP_HEADER.len()..]).into_owned();
            let start = packet.find("xmp:Label=\"")? + "xmp:Label=\"".len();
            let end = packet[start..].find('"')? + start;
            return Some(clean(&xml_unescape(&packet[start..end])));
        }
    }
    None
}

/// Width / height as the picture is meant to be seen. 1.5 if the size cannot be read.
fn aspect_from(path: &Path, orientation: u16) -> f64 {
    match imagesize::size(path) {
        Ok(size) if size.width > 0 && size.height > 0 => {
            let ratio = size.width as f64 / size.height as f64;
            if orientation >= 5 { 1.0 / ratio } else { ratio }   // orientations 5–8 turn the picture by 90°
        }
        _ => 1.5,
    }
}

pub(crate) fn read_aspect(path: &Path) -> f64 {
    let orientation = Metadata::new_from_path(path).map(|exif| read_orientation(&exif)).unwrap_or(1);
    aspect_from(path, orientation)
}

fn read_info(path: &Path) -> FileInfo {
    let mut info = FileInfo {
        name: file_name(path),
        path: path.to_string_lossy().into_owned(),
        aspect: 1.5,
        ..FileInfo::default()
    };

    // Lab scans often have no EXIF at all – then everything stays empty
    let Ok(exif) = Metadata::new_from_path(path) else {
        if is_jpeg(path) {
            info.film = read_xmp_label(path).unwrap_or_default();
        }
        info.aspect = aspect_from(path, 1);
        return info;
    };
    info.aspect = aspect_from(path, read_orientation(&exif));

    if let Some(ExifTag::Model(text)) = exif.get_tag(&ExifTag::Model(String::new())).next() {
        info.camera = clean(text);
    }
    if let Some(ExifTag::LensModel(text)) = exif.get_tag(&ExifTag::LensModel(String::new())).next() {
        info.lens = clean(text);
    }
    if let Some(ExifTag::DateTimeOriginal(text)) =
        exif.get_tag(&ExifTag::DateTimeOriginal(String::new())).next()
    {
        info.date = pretty_date(text);
    }

    // Film: JPEG → XMP label, PNG/TIFF → EXIF description (same as when writing)
    if is_jpeg(path) {
        info.film = read_xmp_label(path).unwrap_or_default();
    } else if let Some(ExifTag::ImageDescription(text)) =
        exif.get_tag(&ExifTag::ImageDescription(String::new())).next()
    {
        info.film = clean(text);
    }
    info
}

/// The picture scaled down to fit into `size` × `size` pixels, turned the way it is meant to be seen.
fn scaled_picture(path: &Path, size: u32) -> Result<image::RgbImage, String> {
    let image = image::open(path)
        .map_err(|e| format!("Could not read \"{}\": {e}", file_name(path)))?;
    // Only ever scale down; a picture that is already small stays as it is
    let mut small = if image.width() > size || image.height() > size { image.thumbnail(size, size) } else { image };
    // Show the picture the way it is meant to be seen (after Rotate, for example)
    let orientation = Metadata::new_from_path(path).map(|exif| read_orientation(&exif)).unwrap_or(1);
    if let Some(turn) = image::metadata::Orientation::from_exif(orientation as u8) {
        small.apply_orientation(turn);
    }
    Ok(small.to_rgb8())
}

/// A JPEG preview of any supported image that fits into `size` × `size` pixels.
/// Also returns its width and height.
pub(crate) fn make_thumbnail_sized(path: &Path, size: u32, quality: u8) -> Result<(Vec<u8>, u32, u32), String> {
    let small = scaled_picture(path, size)?;
    let (width, height) = small.dimensions();
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality)
        .encode_image(&small)
        .map_err(|e| e.to_string())?;
    Ok((bytes, width, height))
}

/// Raw pixels for the quick look: width and height as two little-endian u32, then RGBA.
/// Skipping the JPEG step saves a few hundred milliseconds on big scans.
fn make_preview_pixels(path: &Path) -> Result<Vec<u8>, String> {
    let picture = scaled_picture(path, PREVIEW_SIZE)?;
    let (width, height) = picture.dimensions();
    let rgba = image::DynamicImage::ImageRgb8(picture).into_rgba8();
    let mut bytes = Vec::with_capacity(8 + rgba.as_raw().len());
    bytes.extend_from_slice(&width.to_le_bytes());
    bytes.extend_from_slice(&height.to_le_bytes());
    bytes.extend_from_slice(rgba.as_raw());
    Ok(bytes)
}

fn make_thumbnail(path: &Path) -> Result<Vec<u8>, String> {
    make_thumbnail_sized(path, THUMBNAIL_SIZE, 80).map(|(bytes, _, _)| bytes)
}

// ───────────────────────────── Commands ─────────────────────────────

/// All images of the folder (natural order) with the metadata they already contain.
#[tauri::command]
pub async fn read_folder(folder: String) -> Result<Vec<FileInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(collect_images(Path::new(&folder))?
            .iter()
            .map(|path| read_info(path))
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Preview picture as raw JPEG bytes (the frontend turns it into an image URL).
#[tauri::command]
pub async fn get_thumbnail(path: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || make_thumbnail(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
        .map(tauri::ipc::Response::new)
}

/// Large preview picture for the quick look (Space bar), as raw pixels (see `make_preview_pixels`).
#[tauri::command]
pub async fn get_preview(path: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        make_preview_pixels(Path::new(&path))
    })
    .await
    .map_err(|e| e.to_string())?
    .map(tauri::ipc::Response::new)
}

/// Shows the folder in Finder / Explorer / the Linux file manager. Changes nothing.
#[tauri::command]
pub fn open_folder(folder: String) -> Result<(), String> {
    let path = Path::new(&folder);
    if !path.is_dir() {
        return Err("This folder does not exist any more.".to_string());
    }
    let program = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer"
    } else {
        "xdg-open"
    };
    // Explorer reports an error code even when it works, so only a failed start counts
    std::process::Command::new(program)
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open the folder: {e}"))
}

// ───────────────────────────── Tests ─────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::processor::{write_metadata_in, MetadataInput};

    fn tiny_jpeg_folder(name: &str, count: usize) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("filmroll_reader_{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let jpeg: &[u8] = &[
            0xFF,0xD8,0xFF,0xDB,0x00,0x43,0x00,0x08,0x06,0x06,0x07,0x06,0x05,0x08,0x07,0x07,0x07,0x09,0x09,0x08,0x0A,0x0C,0x14,0x0D,0x0C,0x0B,0x0B,0x0C,0x19,0x12,0x13,0x0F,0x14,0x1D,0x1A,0x1F,0x1E,0x1D,0x1A,0x1C,0x1C,0x20,0x24,0x2E,0x27,0x20,0x22,0x2C,0x23,0x1C,0x1C,0x28,0x37,0x29,0x2C,0x30,0x31,0x34,0x34,0x34,0x1F,0x27,0x39,0x3D,0x38,0x32,0x3C,0x2E,0x33,0x34,0x32,
            0xFF,0xC0,0x00,0x0B,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,
            0xFF,0xC4,0x00,0x14,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x08,
            0xFF,0xC4,0x00,0x14,0x10,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
            0xFF,0xDA,0x00,0x08,0x01,0x01,0x00,0x00,0x3F,0x00,0x37,0xFF,0xD9,
        ];
        for i in 1..=count {
            fs::write(dir.join(format!("scan_{i}.jpg")), jpeg).unwrap();
        }
        dir
    }

    #[test]
    fn untouched_scan_has_empty_fields() {
        let dir = tiny_jpeg_folder("empty", 2);
        let infos: Vec<FileInfo> = collect_images(&dir).unwrap().iter().map(|p| read_info(p)).collect();
        assert_eq!(infos.len(), 2);
        assert_eq!(infos[0].name, "scan_1.jpg");
        assert_eq!((infos[0].camera.as_str(), infos[0].lens.as_str()), ("", ""));
        assert_eq!((infos[0].film.as_str(), infos[0].date.as_str()), ("", ""));
    }

    #[test]
    fn written_metadata_is_read_back() {
        let dir = tiny_jpeg_folder("roundtrip", 2);
        let meta = MetadataInput {
            camera: "Canon AE-1".into(), lens: "50mm f/1.4".into(), film: "Kodak Gold 200 & Co".into(),
            date: "2026-05-01".into(), time: "21:00".into(),
        };
        write_metadata_in(&dir, None, &meta, &|_| {}).unwrap();
        let second = read_info(&dir.join("scan_2.jpg"));
        assert_eq!(second.camera, "Canon AE-1");
        assert_eq!(second.lens, "50mm f/1.4");
        assert_eq!(second.film, "Kodak Gold 200 & Co");
        assert_eq!(second.date, "2026-05-01 21:00:03");
    }

    #[test]
    fn thumbnail_is_a_jpeg() {
        let dir = tiny_jpeg_folder("thumb", 1);
        let bytes = make_thumbnail(&dir.join("scan_1.jpg")).unwrap();
        assert_eq!(&bytes[..2], &[0xFF, 0xD8]);
    }

    #[test]
    fn preview_is_large_but_never_larger_than_the_limit() {
        let dir = std::env::temp_dir().join("filmroll_reader_preview");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("big.jpg");
        image::RgbImage::from_pixel(3000, 2000, image::Rgb([90, 140, 200])).save(&path).unwrap();
        let (bytes, width, height) = make_thumbnail_sized(&path, PREVIEW_SIZE, 88).unwrap();
        assert_eq!((width, height), (1600, 1067));
        assert_eq!(&bytes[..2], &[0xFF, 0xD8]);
        // the quick look gets raw pixels with a small header
        let pixels = make_preview_pixels(&path).unwrap();
        let (w, h) = (u32::from_le_bytes(pixels[0..4].try_into().unwrap()), u32::from_le_bytes(pixels[4..8].try_into().unwrap()));
        assert_eq!((w, h), (1600, 1067));
        assert_eq!(pixels.len(), 8 + (w * h * 4) as usize);
        // first pixel: the colour of the picture (JPEG may shift it by a hair), fully opaque
        for (got, want) in pixels[8..11].iter().zip([90i32, 140, 200]) {
            assert!((*got as i32 - want).abs() <= 3);
        }
        assert_eq!(pixels[11], 255);
        // a small picture is not blown up
        image::RgbImage::from_pixel(400, 300, image::Rgb([1, 2, 3])).save(dir.join("small.jpg")).unwrap();
        let (_, width, _) = make_thumbnail_sized(&dir.join("small.jpg"), PREVIEW_SIZE, 88).unwrap();
        assert_eq!(width, 400);
    }

    /// How long the quick look takes for a big scan. Not part of the normal tests, run by hand:
    ///   cargo test bench_preview -- --ignored --nocapture
    #[test]
    #[ignore]
    fn bench_preview() {
        let dir = std::env::temp_dir().join("filmroll_bench");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        // 6000 × 4000 px with noise, so the file is as heavy as a real scan
        let mut seed = 12345u32;
        let img = image::RgbImage::from_fn(6000, 4000, |x, y| {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let n = (seed >> 24) as u8 / 8;
            image::Rgb([((x / 24) as u8).wrapping_add(n), ((y / 16) as u8).wrapping_add(n), (((x + y) / 40) as u8).wrapping_add(n)])
        });
        for name in ["big.jpg", "big.tif"] {
            let path = dir.join(name);
            img.save(&path).unwrap();
            let size_mb = fs::metadata(&path).unwrap().len() / 1_000_000;
            let start = std::time::Instant::now();
            let bytes = make_preview_pixels(&path).unwrap();
            eprintln!("{name} ({size_mb} MB): {} ms, {} MB sent to the screen", start.elapsed().as_millis(), bytes.len() / 1_000_000);
            let start = std::time::Instant::now();
            let _ = make_thumbnail_sized(&path, 1600, 88).unwrap();
            eprintln!("{name}: {} ms if the picture was packed as JPEG first (the old way)", start.elapsed().as_millis());
        }
    }

    #[test]
    fn missing_folder_is_not_opened() {
        let err = open_folder("/this/folder/does/not/exist".to_string()).unwrap_err();
        assert!(err.contains("does not exist"));
    }

    #[test]
    fn exif_dates_are_made_readable() {
        assert_eq!(pretty_date("2026:05:01 21:00:06\0"), "2026-05-01 21:00:06");
        assert_eq!(pretty_date(""), "");
    }
}
