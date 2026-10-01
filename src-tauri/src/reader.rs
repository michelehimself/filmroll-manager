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

/// A JPEG preview of any supported image that fits into `size` × `size` pixels,
/// turned the way the picture is meant to be seen. Also returns its width and height.
pub(crate) fn make_thumbnail_sized(path: &Path, size: u32, quality: u8) -> Result<(Vec<u8>, u32, u32), String> {
    let image = image::open(path)
        .map_err(|e| format!("Could not read \"{}\": {e}", file_name(path)))?;
    let mut small = image.thumbnail(size, size);
    // Show the picture the way it is meant to be seen (after Rotate, for example)
    let orientation = Metadata::new_from_path(path).map(|exif| read_orientation(&exif)).unwrap_or(1);
    if let Some(turn) = image::metadata::Orientation::from_exif(orientation as u8) {
        small.apply_orientation(turn);
    }
    let small = small.to_rgb8();
    let (width, height) = small.dimensions();
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality)
        .encode_image(&small)
        .map_err(|e| e.to_string())?;
    Ok((bytes, width, height))
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
