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
/// Left margin when the sheet is going to be punched for a binder (standard holes sit about 12 mm from the edge)
const PUNCH_MARGIN: f64 = 22.0;
const GAP: f64 = 2.5;
const LABEL_H: f64 = 4.2;
const TITLE_PT: f64 = 16.0;
const SUBTITLE_PT: f64 = 9.0;
const LABEL_PT: f64 = 6.5;
// Header lines, measured from the top edge of the page. A line that is empty is left out
// and the ones below move up.
const FIRST_BASELINE: f64 = 18.0;
const TITLE_TO_NEXT: f64 = 6.0;
const LINE_TO_NEXT: f64 = 5.0;
const LAST_BASELINE_TO_RULE: f64 = 4.0;
const RULE_TO_GRID: f64 = 4.0;
/// Where the grid starts at the earliest when there is a header (title and info line)
#[cfg(test)]
const GRID_Y_WITH_HEADER: f64 = 32.0;
/// Picture size inside the PDF: sharp enough for print, small enough to stay a light file
const PDF_PICTURE_PX: u32 = 640;
const PDF_PICTURE_QUALITY: u8 = 85;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SheetOptions {
    /// `None` = choose automatically (whichever page direction makes the pictures biggest)
    #[serde(default)]
    landscape: Option<bool>,
    /// `None` = choose automatically
    columns: Option<u32>,
    show_names: bool,
    /// Leave extra room on the left for a hole punch
    #[serde(default)]
    punched: bool,
    title: String,
    subtitle: String,
    /// Where the film was scanned (free text)
    scanned_at: String,
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
    /// Which direction was used (matters when it was chosen automatically)
    landscape: bool,
    margin: f64,
    /// Left margin; wider than `margin` when the sheet is punched
    margin_left: f64,
    has_header: bool,
    /// Baseline of each header line; `None` if that line is empty and not drawn
    title_baseline: Option<f64>,
    subtitle_baseline: Option<f64>,
    scan_baseline: Option<f64>,
    scan_text: String,
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

/// Portrait or landscape as chosen; on automatic, the direction that gives the bigger pictures
/// (portrait wins a tie).
pub fn layout(aspects: &[f64], options: &SheetOptions) -> Layout {
    match options.landscape {
        Some(landscape) => layout_on(aspects, options, landscape),
        None => {
            let portrait = layout_on(aspects, options, false);
            let landscape = layout_on(aspects, options, true);
            if landscape.box_w > portrait.box_w + 0.01 { landscape } else { portrait }
        }
    }
}

fn layout_on(aspects: &[f64], options: &SheetOptions, landscape: bool) -> Layout {
    let (page_w, page_h) = if landscape { (PAGE.1, PAGE.0) } else { PAGE };
    let scan_text = if options.scanned_at.trim().is_empty() {
        String::new()
    } else {
        format!("Scanned at: {}", options.scanned_at.trim())
    };
    let wanted = [!options.title.trim().is_empty(), !options.subtitle.trim().is_empty(), !scan_text.is_empty()];
    let has_header = wanted.iter().any(|w| *w);

    // Stack the lines that have text
    let mut baselines = [None; 3];
    let mut next = FIRST_BASELINE;
    let mut last = FIRST_BASELINE;
    for (i, present) in wanted.iter().enumerate() {
        if *present {
            baselines[i] = Some(next);
            last = next;
            next += if i == 0 { TITLE_TO_NEXT } else { LINE_TO_NEXT };
        }
    }
    let rule_y = last + LAST_BASELINE_TO_RULE;
    let margin_left = if options.punched { PUNCH_MARGIN } else { MARGIN };
    let grid_x = margin_left;
    let grid_y = if has_header { rule_y + RULE_TO_GRID } else { MARGIN };
    let grid_w = page_w - margin_left - MARGIN;
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
        landscape,
        margin: MARGIN,
        margin_left,
        has_header,
        title_baseline: baselines[0],
        subtitle_baseline: baselines[1],
        scan_baseline: baselines[2],
        scan_text,
        rule_y,
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
        let max_w = (layout.page_w - layout.margin_left - layout.margin) * MM_TO_PT;
        let mut line = |text: &str, baseline: Option<f64>, font: &'static [u8], size: f64, gray: f32| {
            let Some(baseline) = baseline else { return };
            c.begin_text();
            c.set_fill_gray(gray);
            c.set_font(Name(font), size as f32);
            c.next_line(pt(layout.margin_left), y_up(baseline));
            c.show(Str(&win_ansi(&fit_text(text, size, max_w))));
            c.end_text();
        };
        line(options.title.trim(), layout.title_baseline, b"F2", layout.title_pt, 0.1);
        line(options.subtitle.trim(), layout.subtitle_baseline, b"F1", layout.subtitle_pt, 0.35);
        line(&layout.scan_text, layout.scan_baseline, b"F1", layout.subtitle_pt, 0.35);
        c.set_stroke_gray(0.8);
        c.set_line_width(0.5);
        c.set_line_cap(LineCapStyle::ButtCap);
        c.move_to(pt(layout.margin_left), y_up(layout.rule_y));
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
            landscape: Some(false), columns: None, show_names: false, punched: false,
            title: "Roll 12".into(), subtitle: "Kodak Portra 400 · Pentax 17".into(),
            scanned_at: String::new(),
        }
    }

    /// Every picture box lies inside the page margins and no two boxes overlap.
    fn assert_fits(layout: &Layout) {
        for (i, a) in layout.cells.iter().enumerate() {
            assert!(a.x >= layout.margin_left - 0.001 && a.x + layout.box_w <= layout.page_w - layout.margin + 0.001, "cell {i} sticks out sideways");
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
                o.landscape = Some(landscape);
                assert_fits(&layout(&vec![1.5; n], &o));
            }
        }
        let mut o = options();
        o.landscape = Some(true);
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
    fn scan_place_gets_its_own_line_and_lines_move_up_when_empty() {
        let mut o = options();
        let without = layout(&[1.5; 36], &o);
        assert_eq!(without.scan_baseline, None);
        assert_eq!(without.scan_text, "");

        o.scanned_at = "  Fotolabor Müller, Hamburg ".into();
        let with = layout(&[1.5; 36], &o);
        assert_eq!(with.scan_text, "Scanned at: Fotolabor Müller, Hamburg");
        assert!(with.scan_baseline.unwrap() > with.subtitle_baseline.unwrap());
        assert!(with.cells[0].y > without.cells[0].y);   // the grid starts lower
        assert_fits(&with);

        // Only the scan place: it takes the first line, nothing is left blank above it
        o.title = "".into();
        o.subtitle = "".into();
        let only = layout(&[1.5; 36], &o);
        assert_eq!((only.title_baseline, only.subtitle_baseline), (None, None));
        assert_eq!(only.scan_baseline, Some(FIRST_BASELINE));
        assert_fits(&only);
    }

    #[test]
    fn automatic_page_direction_picks_the_bigger_pictures() {
        let mut o = options();
        o.landscape = None;
        for n in [1, 4, 12, 24, 36, 72] {
            let aspects = vec![1.5; n];
            let auto = layout(&aspects, &o);
            o.landscape = Some(false);
            let portrait = layout(&aspects, &o);
            o.landscape = Some(true);
            let landscape = layout(&aspects, &o);
            o.landscape = None;
            assert!(auto.box_w >= portrait.box_w.max(landscape.box_w) - 0.02, "{n} frames: automatic is not the biggest");
            assert_eq!(auto.landscape, landscape.box_w > portrait.box_w + 0.01);
            assert_fits(&auto);
        }
        // a handful of frames fit better side by side on a landscape page
        assert!(layout(&[1.5; 4], &o).landscape);
    }

    #[test]
    fn punched_sheet_keeps_the_left_edge_free_and_still_fits() {
        for landscape in [false, true] {
            let mut o = options();
            o.landscape = Some(landscape);
            o.punched = true;
            for n in [1, 12, 36, 72] {
                let l = layout(&vec![1.5; n], &o);
                assert!(l.margin_left > l.margin);
                assert_fits(&l);
                assert!(l.cells.iter().all(|c| c.x >= PUNCH_MARGIN - 0.001), "a picture reaches into the punch area");
            }
        }
        assert_eq!(layout(&[1.5; 6], &options()).margin_left, MARGIN);
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
        o.scanned_at = "Fotolabor Müller".into();
        o.show_names = true;
        save_in(&dir, None, &o, &dir.join("portrait.pdf"), &|_| {}).unwrap();
        o.landscape = Some(true);
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
