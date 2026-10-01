//! Contact sheet: all chosen frames on one A4 page, saved as a PDF.
//! `layout` decides where everything goes. The preview in the dialog and the PDF
//! are both drawn from that one layout, so they always match.
//! The PDF is built on this computer; the pictures never leave it.

use crate::processor::{emit_progress, file_name, select_images};
use crate::reader::{make_thumbnail_sized, read_aspect};
use pdf_writer::types::LineCapStyle;
use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref, Str, TextStr};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::AppHandle;

const MM_TO_PT: f64 = 72.0 / 25.4;
const PAGE: (f64, f64) = (210.0, 297.0); // A4 portrait, in mm
const MARGIN: f64 = 12.0;
const GAP: f64 = 2.5;
const LABEL_H: f64 = 4.2;
const TITLE_PT: f64 = 16.0;
const SUBTITLE_PT: f64 = 9.0;
const LABEL_PT: f64 = 6.5;
// Header, measured from the top edge of the page
const TITLE_BASELINE: f64 = 18.0;
const SUBTITLE_BASELINE: f64 = 24.0;
const RULE_Y: f64 = 28.0;
const GRID_Y_WITH_HEADER: f64 = 32.0;
/// Picture size inside the PDF: sharp enough for print, small enough to stay a light file
const PDF_PICTURE_PX: u32 = 640;
const PDF_PICTURE_QUALITY: u8 = 85;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SheetOptions {
    landscape: bool,
    /// `None` = choose automatically
    columns: Option<u32>,
    show_names: bool,
    title: String,
    subtitle: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct CellPos {
    x: f64,
    y: f64,
}

/// Everything in millimetres, measured from the top left corner of the page.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    page_w: f64,
    page_h: f64,
    margin: f64,
    has_header: bool,
    title_baseline: f64,
    subtitle_baseline: f64,
    rule_y: f64,
    title_pt: f64,
    subtitle_pt: f64,
    label_pt: f64,
    cols: usize,
    rows: usize,
    box_w: f64,
    box_h: f64,
    label_h: f64,
    cells: Vec<CellPos>,
}

// ───────────────────────────── Layout ─────────────────────────────

/// 3:2 boxes for normal film frames, square boxes for square formats like 6×6.
fn box_aspect(aspects: &[f64]) -> f64 {
    let mut ratios: Vec<f64> = aspects
        .iter()
        .filter(|a| a.is_finite() && **a > 0.0)
        .map(|a| if *a >= 1.0 { *a } else { 1.0 / *a })
        .collect();
    if ratios.is_empty() {
        return 1.5;
    }
    ratios.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    if ratios[ratios.len() / 2] < 1.25 { 1.0 } else { 1.5 }
}

/// Width of the picture box when `cols` columns are used and everything has to fit on the page.
fn box_width(n: usize, cols: usize, grid_w: f64, grid_h: f64, aspect: f64) -> f64 {
    let rows = n.div_ceil(cols);
    let by_width = (grid_w - (cols - 1) as f64 * GAP) / cols as f64;
    let by_height = ((grid_h - (rows - 1) as f64 * GAP) / rows as f64 - LABEL_H) * aspect;
    by_width.min(by_height)
}

fn choose_columns(n: usize, grid_w: f64, grid_h: f64, aspect: f64) -> usize {
    let best = (1..=n)
        .map(|c| (c, box_width(n, c, grid_w, grid_h, aspect)))
        .fold((1, f64::MIN), |a, b| if b.1 > a.1 { b } else { a });
    // A strip of film has 6 frames, so 6 per row looks familiar – unless that makes the pictures much smaller
    if n >= 6 && box_width(n, 6, grid_w, grid_h, aspect) >= 0.8 * best.1 {
        6
    } else {
        best.0
    }
}

pub fn layout(aspects: &[f64], options: &SheetOptions) -> Layout {
    let (page_w, page_h) = if options.landscape { (PAGE.1, PAGE.0) } else { PAGE };
    let has_header = !options.title.trim().is_empty() || !options.subtitle.trim().is_empty();
    let grid_x = MARGIN;
    let grid_y = if has_header { GRID_Y_WITH_HEADER } else { MARGIN };
    let grid_w = page_w - 2.0 * MARGIN;
    let grid_h = page_h - MARGIN - grid_y;

    let n = aspects.len().max(1);
    let aspect = box_aspect(aspects);
    let cols = match options.columns {
        Some(c) if c >= 1 => (c as usize).min(n),
        _ => choose_columns(n, grid_w, grid_h, aspect),
    };
    let rows = n.div_ceil(cols);
    let box_w = box_width(n, cols, grid_w, grid_h, aspect).max(1.0);
    let box_h = box_w / aspect;

    // Centre the rows horizontally, start right below the header
    let used_w = cols as f64 * box_w + (cols - 1) as f64 * GAP;
    let left = grid_x + (grid_w - used_w).max(0.0) / 2.0;
    let cells = (0..aspects.len())
        .map(|i| CellPos {
            x: left + (i % cols) as f64 * (box_w + GAP),
            y: grid_y + (i / cols) as f64 * (box_h + LABEL_H + GAP),
        })
        .collect();

    Layout {
        page_w,
        page_h,
        margin: MARGIN,
        has_header,
        title_baseline: TITLE_BASELINE,
        subtitle_baseline: SUBTITLE_BASELINE,
        rule_y: RULE_Y,
        title_pt: TITLE_PT,
        subtitle_pt: SUBTITLE_PT,
        label_pt: LABEL_PT,
        cols,
        rows,
        box_w,
        box_h,
        label_h: LABEL_H,
        cells,
    }
}

// ───────────────────────────── PDF ─────────────────────────────

/// The standard PDF fonts use Windows-1252, so umlauts work; anything else becomes "?".
fn win_ansi(text: &str) -> Vec<u8> {
    text.chars()
        .map(|c| match c {
            '\u{2013}' => 0x96, // –
            '\u{2014}' => 0x97, // —
            '\u{2018}' => 0x91,
            '\u{2019}' => 0x92,
            '\u{201C}' => 0x93,
            '\u{201D}' => 0x94,
            '\u{2022}' => 0x95,
            '\u{2026}' => 0x85,
            '\u{20AC}' => 0x80,
            c if (c as u32) < 0x100 && !c.is_control() => c as u32 as u8,
            _ => b'?',
        })
        .collect()
}

/// Helvetica is about this wide per character (digits are exactly 0.556 em).
fn text_width_pt(text: &str, size_pt: f64) -> f64 {
    text.chars().map(|c| if c.is_ascii_digit() { 0.556 } else { 0.5 }).sum::<f64>() * size_pt
}

/// Cuts the text so it fits into `max_pt`.
fn fit_text(text: &str, size_pt: f64, max_pt: f64) -> String {
    let mut out = String::new();
    for c in text.chars() {
        let candidate = format!("{out}{c}");
        if text_width_pt(&candidate, size_pt) > max_pt {
            break;
        }
        out = candidate;
    }
    out
}

fn pt(mm: f64) -> f32 {
    (mm * MM_TO_PT) as f32
}

struct Picture {
    jpeg: Vec<u8>,
    width: u32,
    height: u32,
}

fn build_pdf(layout: &Layout, options: &SheetOptions, names: &[String], pictures: &[Picture]) -> Vec<u8> {
    let mut pdf = Pdf::new();
    let catalog_id = Ref::new(1);
    let tree_id = Ref::new(2);
    let page_id = Ref::new(3);
    let content_id = Ref::new(4);
    let font_regular = Ref::new(5);
    let font_bold = Ref::new(6);
    let info_id = Ref::new(7);
    let first_image = 10;
    let image_ids: Vec<Ref> = (0..pictures.len()).map(|i| Ref::new(first_image + i as i32)).collect();
    let image_names: Vec<String> = (0..pictures.len()).map(|i| format!("Im{i}")).collect();

    pdf.catalog(catalog_id).pages(tree_id);
    pdf.pages(tree_id).kids([page_id]).count(1);
    pdf.document_info(info_id)
        .title(TextStr(options.title.trim()))
        .creator(TextStr("FilmRoll Manager"));

    let mut page = pdf.page(page_id);
    page.media_box(Rect::new(0.0, 0.0, pt(layout.page_w), pt(layout.page_h)));
    page.parent(tree_id);
    page.contents(content_id);
    let mut resources = page.resources();
    resources.fonts().pair(Name(b"F1"), font_regular).pair(Name(b"F2"), font_bold);
    let mut xobjects = resources.x_objects();
    for (name, id) in image_names.iter().zip(&image_ids) {
        xobjects.pair(Name(name.as_bytes()), *id);
    }
    xobjects.finish();
    resources.finish();
    page.finish();

    pdf.type1_font(font_regular).base_font(Name(b"Helvetica")).encoding_predefined(Name(b"WinAnsiEncoding"));
    pdf.type1_font(font_bold).base_font(Name(b"Helvetica-Bold")).encoding_predefined(Name(b"WinAnsiEncoding"));

    for (picture, id) in pictures.iter().zip(&image_ids) {
        let mut image = pdf.image_xobject(*id, &picture.jpeg);
        image.filter(Filter::DctDecode);
        image.width(picture.width as i32);
        image.height(picture.height as i32);
        image.color_space().device_rgb();
        image.bits_per_component(8);
        image.finish();
    }

    // Everything the page shows. PDF counts y from the bottom, the layout from the top.
    let y_up = |y_mm: f64| pt(layout.page_h - y_mm);
    let mut c = Content::new();

    if layout.has_header {
        let max_w = (layout.page_w - 2.0 * layout.margin) * MM_TO_PT;
        let title = fit_text(options.title.trim(), layout.title_pt, max_w);
        let subtitle = fit_text(options.subtitle.trim(), layout.subtitle_pt, max_w);
        c.begin_text();
        c.set_fill_gray(0.1);
        c.set_font(Name(b"F2"), layout.title_pt as f32);
        c.next_line(pt(layout.margin), y_up(layout.title_baseline));
        c.show(Str(&win_ansi(&title)));
        c.end_text();
        c.begin_text();
        c.set_fill_gray(0.35);
        c.set_font(Name(b"F1"), layout.subtitle_pt as f32);
        c.next_line(pt(layout.margin), y_up(layout.subtitle_baseline));
        c.show(Str(&win_ansi(&subtitle)));
        c.end_text();
        c.set_stroke_gray(0.8);
        c.set_line_width(0.5);
        c.set_line_cap(LineCapStyle::ButtCap);
        c.move_to(pt(layout.margin), y_up(layout.rule_y));
        c.line_to(pt(layout.page_w - layout.margin), y_up(layout.rule_y));
        c.stroke();
    }

    let digits = names.len().to_string().len().max(2);
    for (i, (cell, picture)) in layout.cells.iter().zip(pictures).enumerate() {
        // Light grey box, the picture fitted inside it (portrait and landscape both stay visible)
        c.set_fill_gray(0.93);
        c.rect(pt(cell.x), y_up(cell.y + layout.box_h), pt(layout.box_w), pt(layout.box_h));
        c.fill_nonzero();

        let scale = (layout.box_w / picture.width as f64).min(layout.box_h / picture.height as f64);
        let (w, h) = (picture.width as f64 * scale, picture.height as f64 * scale);
        let (x, y) = (cell.x + (layout.box_w - w) / 2.0, cell.y + (layout.box_h - h) / 2.0);
        c.save_state();
        c.transform([pt(w), 0.0, 0.0, pt(h), pt(x), y_up(y + h)]);
        c.x_object(Name(image_names[i].as_bytes()));
        c.restore_state();

        // Frame number (and file name) centred below the picture
        let number = format!("{:0digits$}", i + 1);
        let label = if options.show_names { format!("{number}  {}", names[i]) } else { number };
        let label = fit_text(&label, layout.label_pt, layout.box_w * MM_TO_PT);
        let left = (cell.x + layout.box_w / 2.0) * MM_TO_PT - text_width_pt(&label, layout.label_pt) / 2.0;
        c.begin_text();
        c.set_fill_gray(0.3);
        c.set_font(Name(b"F1"), layout.label_pt as f32);
        c.next_line(left as f32, y_up(cell.y + layout.box_h + 3.1));
        c.show(Str(&win_ansi(&label)));
        c.end_text();
    }

    pdf.stream(content_id, &c.finish());
    pdf.finish()
}

// ───────────────────────────── Commands ─────────────────────────────

/// Where everything goes – used by the preview in the dialog.
#[tauri::command]
pub fn contact_sheet_layout(aspects: Vec<f64>, options: SheetOptions) -> Layout {
    layout(&aspects, &options)
}

/// Builds the contact sheet of the chosen files and saves it as a PDF at `target`.
#[tauri::command]
pub async fn save_contact_sheet(
    app: AppHandle,
    folder: String,
    files: Option<Vec<String>>,
    options: SheetOptions,
    target: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_in(Path::new(&folder), files.as_deref(), &options, Path::new(&target), &|v| emit_progress(&app, v))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn save_in(
    folder: &Path,
    only: Option<&[String]>,
    options: &SheetOptions,
    target: &Path,
    progress: &dyn Fn(f64),
) -> Result<(), String> {
    let paths = select_images(folder, only)?;
    let aspects: Vec<f64> = paths.iter().map(|p| read_aspect(p)).collect();
    let layout = layout(&aspects, options);

    let total = paths.len().max(1) as f64;
    let mut pictures = Vec::with_capacity(paths.len());
    for (i, path) in paths.iter().enumerate() {
        let (jpeg, width, height) = make_thumbnail_sized(path, PDF_PICTURE_PX, PDF_PICTURE_QUALITY)?;
        pictures.push(Picture { jpeg, width, height });
        progress((i + 1) as f64 / total * 0.95);
    }

    let names: Vec<String> = paths.iter().map(|p| file_name(p)).collect();
    let bytes = build_pdf(&layout, options, &names, &pictures);

    // Write next to the final place first, so an interrupted save never leaves a broken PDF behind
    let temp = target.with_extension("pdf.tmp");
    fs::write(&temp, &bytes).map_err(|e| format!("Could not save the PDF: {e}"))?;
    fs::rename(&temp, target).map_err(|e| format!("Could not save the PDF: {e}"))?;
    progress(1.0);
    Ok(())
}

// ───────────────────────────── Tests ─────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> SheetOptions {
        SheetOptions {
            landscape: false, columns: None, show_names: false,
            title: "Roll 12".into(), subtitle: "Kodak Portra 400 · Pentax 17".into(),
        }
    }

    /// Every picture box lies inside the page margins and no two boxes overlap.
    fn assert_fits(layout: &Layout) {
        for (i, a) in layout.cells.iter().enumerate() {
            assert!(a.x >= layout.margin - 0.001 && a.x + layout.box_w <= layout.page_w - layout.margin + 0.001, "cell {i} sticks out sideways");
            assert!(a.y + layout.box_h + layout.label_h <= layout.page_h - layout.margin + 0.001, "cell {i} sticks out at the bottom");
            for b in &layout.cells[i + 1..] {
                let apart_x = (a.x - b.x).abs() >= layout.box_w - 0.001;
                let apart_y = (a.y - b.y).abs() >= layout.box_h + layout.label_h - 0.001;
                assert!(apart_x || apart_y, "cells overlap");
            }
        }
    }

    #[test]
    fn a_roll_of_36_gets_six_per_row_on_one_page() {
        let layout = layout(&[1.5; 36], &options());
        assert_eq!((layout.cols, layout.rows), (6, 6));
        assert_eq!((layout.page_w, layout.page_h), (210.0, 297.0));
        assert_eq!(layout.cells.len(), 36);
        assert_fits(&layout);
        assert!(layout.cells[0].y >= GRID_Y_WITH_HEADER);   // below the header
    }

    #[test]
    fn everything_fits_for_any_number_of_frames_and_both_orientations() {
        for landscape in [false, true] {
            for n in [1, 2, 5, 12, 24, 36, 37, 72, 100, 200] {
                let mut o = options();
                o.landscape = landscape;
                assert_fits(&layout(&vec![1.5; n], &o));
            }
        }
        let mut o = options();
        o.landscape = true;
        assert_eq!((layout(&[1.5; 36], &o).page_w, layout(&[1.5; 36], &o).page_h), (297.0, 210.0));
    }

    #[test]
    fn chosen_columns_are_respected_and_square_formats_get_square_boxes() {
        let mut o = options();
        o.columns = Some(4);
        let l = layout(&[1.5; 36], &o);
        assert_eq!((l.cols, l.rows), (4, 9));
        assert_fits(&l);

        o.columns = None;
        let square = layout(&[1.0; 12], &o);
        assert!((square.box_w - square.box_h).abs() < 0.001);
        let film = layout(&[1.5, 0.667, 1.5, 1.5], &o);   // a portrait frame among landscape ones
        assert!((film.box_w / film.box_h - 1.5).abs() < 0.001);
    }

    #[test]
    fn no_header_means_more_room() {
        let mut o = options();
        o.title = " ".into();
        o.subtitle = "".into();
        let l = layout(&[1.5; 36], &o);
        assert!(!l.has_header);
        assert!(l.cells[0].y < GRID_Y_WITH_HEADER);
    }

    #[test]
    fn text_is_made_pdf_safe() {
        assert_eq!(win_ansi("Müller – 400"), vec![b'M', 0xFC, b'l', b'l', b'e', b'r', b' ', 0x96, b' ', b'4', b'0', b'0']);
        assert_eq!(win_ansi("日本"), b"??".to_vec());
        assert!(text_width_pt(&fit_text(&"W".repeat(100), 9.0, 100.0), 9.0) <= 100.0);
    }

    #[test]
    fn a_full_roll_becomes_one_pdf_page() {
        let dir = std::env::temp_dir().join("filmroll_sheet_36");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        for i in 1..=36u32 {
            // every 5th frame is a portrait picture
            let (w, h) = if i % 5 == 0 { (400, 600) } else { (600, 400) };
            image::RgbImage::from_fn(w, h, |x, y| {
                let fade = (x * 255 / w) as u8;
                image::Rgb([fade, (y * 255 / h) as u8, (i * 7 % 255) as u8])
            })
            .save(dir.join(format!("scan_{i:02}.jpg")))
            .unwrap();
        }
        let mut o = options();
        o.subtitle = "Kodak Portra 400  ·  Pentax 17  ·  HD Pentax 25mm F/3.5  ·  2026-05-01".into();
        o.show_names = true;
        save_in(&dir, None, &o, &dir.join("portrait.pdf"), &|_| {}).unwrap();
        o.landscape = true;
        o.show_names = false;
        save_in(&dir, None, &o, &dir.join("landscape.pdf"), &|_| {}).unwrap();
        for name in ["portrait.pdf", "landscape.pdf"] {
            let bytes = fs::read(dir.join(name)).unwrap();
            assert_eq!(String::from_utf8_lossy(&bytes).matches("/Subtype /Image").count(), 36);
        }
    }

    #[test]
    fn pdf_has_one_page_with_all_pictures() {
        let dir = std::env::temp_dir().join("filmroll_sheet_pdf");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        for i in 1..=7 {
            // alternate landscape and portrait pictures
            let (w, h) = if i % 2 == 0 { (60, 90) } else { (90, 60) };
            image::RgbImage::from_fn(w, h, |x, y| image::Rgb([(x * 3) as u8, (y * 3) as u8, (i * 30) as u8]))
                .save(dir.join(format!("scan_{i}.jpg")))
                .unwrap();
        }
        let target = dir.join("sheet.pdf");
        let mut o = options();
        o.show_names = true;
        save_in(&dir, None, &o, &target, &|_| {}).unwrap();

        let bytes = fs::read(&target).unwrap();
        let text = String::from_utf8_lossy(&bytes);
        assert!(bytes.starts_with(b"%PDF-"));
        assert_eq!(text.matches("/Subtype /Image").count(), 7);
        assert_eq!(text.matches("/Type /Page\n").count() + text.matches("/Type /Page ").count(), 1);
        assert!(!dir.join("sheet.pdf.tmp").exists());

        // Only the chosen files, in their natural order
        let only = vec!["scan_2.jpg".to_string(), "scan_5.jpg".to_string()];
        save_in(&dir, Some(&only), &o, &dir.join("two.pdf"), &|_| {}).unwrap();
        let two = fs::read(dir.join("two.pdf")).unwrap();
        assert_eq!(String::from_utf8_lossy(&two).matches("/Subtype /Image").count(), 2);
    }
}
