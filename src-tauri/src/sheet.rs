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
// Header lines, measured from the top edge of the page. A line that is empty is left out
// and the ones below move up.
const FIRST_BASELINE: f64 = 18.0;
const TITLE_TO_NEXT: f64 = 6.0;
const LINE_TO_NEXT: f64 = 5.0;
const LAST_BASELINE_TO_RULE: f64 = 4.0;
const RULE_TO_GRID: f64 = 4.0;
// Film strip look. Everything is derived from the picture width, so it scales with the page.
const FRAME_GAP_F: f64 = 0.055;       // space between two frames, as part of the picture width
const PERFORATION_BAND_F: f64 = 0.10; // band with the sprocket holes, as part of the picture width
const PLAIN_BAND_F: f64 = 0.035;      // thin dark border for formats without sprocket holes (medium format)
const STRIP_TEXT_ROW: f64 = 2.8;      // row for the edge print (frame numbers), in mm
const STRIP_GAP: f64 = 2.5;           // space between two strips, in mm
const EDGE_PT: f64 = 6.0;
const HOLES_PER_FRAME: f64 = 8.0;
/// Picture size inside the PDF: sharp enough for print, small enough to stay a light file
const PDF_PICTURE_PX: u32 = 640;
const PDF_PICTURE_QUALITY: u8 = 85;

#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SheetStyle {
    /// Pictures in a clean grid, number below each one
    #[default]
    Grid,
    /// Every row looks like a strip of film
    Strip,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SheetOptions {
    #[serde(default)]
    style: SheetStyle,
    landscape: bool,
    /// `None` = choose automatically
    columns: Option<u32>,
    show_names: bool,
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

/// One row in the film strip look.
#[derive(Serialize, Debug, PartialEq)]
pub struct Strip {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    frames: usize,
}

/// How a strip is built; the same for every strip. Positions are relative to the strip's top left corner.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StripSpec {
    perforated: bool,
    hole_w: f64,
    hole_h: f64,
    hole_pitch: f64,
    top_hole_y: f64,
    bottom_hole_y: f64,
    /// Distance from the bottom edge of a picture to the baseline of the edge print
    text_offset: f64,
    text_pt: f64,
}

/// Everything in millimetres, measured from the top left corner of the page.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    page_w: f64,
    page_h: f64,
    margin: f64,
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
    style: SheetStyle,
    cols: usize,
    rows: usize,
    box_w: f64,
    box_h: f64,
    label_h: f64,
    /// Where each picture box is
    cells: Vec<CellPos>,
    /// Film strip look only
    strips: Vec<Strip>,
    strip_spec: Option<StripSpec>,
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

fn choose_columns(n: usize, width_for: impl Fn(usize) -> f64) -> usize {
    let best = (1..=n)
        .map(|c| (c, width_for(c)))
        .fold((1, f64::MIN), |a, b| if b.1 > a.1 { b } else { a });
    // A strip of film has 6 frames, so 6 per row looks familiar – unless that makes the pictures much smaller
    if n >= 6 && width_for(6) >= 0.8 * best.1 {
        6
    } else {
        best.0
    }
}

/// (height of the sprocket band as part of the picture width, has sprocket holes)
fn strip_band(aspect: f64) -> (f64, bool) {
    if aspect >= 1.4 { (PERFORATION_BAND_F, true) } else { (PLAIN_BAND_F, false) }   // 35 mm has holes, 120 film has none
}

/// Picture width in the film strip look: every strip has to fit across and all strips down the page.
fn strip_box_width(n: usize, cols: usize, grid_w: f64, grid_h: f64, aspect: f64) -> f64 {
    let rows = n.div_ceil(cols);
    let (band, _) = strip_band(aspect);
    let by_width = grid_w / (cols as f64 * (1.0 + FRAME_GAP_F));
    let by_height = ((grid_h - (rows - 1) as f64 * STRIP_GAP) / rows as f64 - STRIP_TEXT_ROW) / (1.0 / aspect + 2.0 * band);
    by_width.min(by_height)
}

pub fn layout(aspects: &[f64], options: &SheetOptions) -> Layout {
    let (page_w, page_h) = if options.landscape { (PAGE.1, PAGE.0) } else { PAGE };
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
    let grid_x = MARGIN;
    let grid_y = if has_header { rule_y + RULE_TO_GRID } else { MARGIN };
    let grid_w = page_w - 2.0 * MARGIN;
    let grid_h = page_h - MARGIN - grid_y;

    let n = aspects.len().max(1);
    let aspect = box_aspect(aspects);
    let wanted_cols = options.columns.filter(|c| *c >= 1).map(|c| (c as usize).min(n));

    let mut layout = Layout {
        page_w,
        page_h,
        margin: MARGIN,
        has_header,
        title_baseline: baselines[0],
        subtitle_baseline: baselines[1],
        scan_baseline: baselines[2],
        scan_text,
        rule_y,
        title_pt: TITLE_PT,
        subtitle_pt: SUBTITLE_PT,
        label_pt: LABEL_PT,
        style: options.style,
        cols: 1,
        rows: 1,
        box_w: 1.0,
        box_h: 1.0,
        label_h: LABEL_H,
        cells: Vec::new(),
        strips: Vec::new(),
        strip_spec: None,
    };

    match options.style {
        SheetStyle::Grid => {
            let cols = wanted_cols.unwrap_or_else(|| choose_columns(n, |c| box_width(n, c, grid_w, grid_h, aspect)));
            let box_w = box_width(n, cols, grid_w, grid_h, aspect).max(1.0);
            let box_h = box_w / aspect;

            // Centre the rows horizontally, start right below the header
            let used_w = cols as f64 * box_w + (cols - 1) as f64 * GAP;
            let left = grid_x + (grid_w - used_w).max(0.0) / 2.0;
            layout.cells = (0..aspects.len())
                .map(|i| CellPos {
                    x: left + (i % cols) as f64 * (box_w + GAP),
                    y: grid_y + (i / cols) as f64 * (box_h + LABEL_H + GAP),
                })
                .collect();
            (layout.cols, layout.rows, layout.box_w, layout.box_h) = (cols, n.div_ceil(cols), box_w, box_h);
        }
        SheetStyle::Strip => {
            let cols = wanted_cols.unwrap_or_else(|| choose_columns(n, |c| strip_box_width(n, c, grid_w, grid_h, aspect)));
            let box_w = strip_box_width(n, cols, grid_w, grid_h, aspect).max(1.0);
            let box_h = box_w / aspect;
            let (band_f, perforated) = strip_band(aspect);
            let band = band_f * box_w;
            let frame_gap = FRAME_GAP_F * box_w;
            let pitch = box_w + frame_gap;
            let strip_h = band + box_h + STRIP_TEXT_ROW + band;
            let left = grid_x + (grid_w - cols as f64 * pitch).max(0.0) / 2.0;
            let rows = n.div_ceil(cols);

            for row in 0..rows {
                let frames = (aspects.len() - row * cols).min(cols);
                let (y, x) = (grid_y + row as f64 * (strip_h + STRIP_GAP), left);
                layout.strips.push(Strip { x, y, w: frames as f64 * pitch, h: strip_h, frames });
                for c in 0..frames {
                    layout.cells.push(CellPos { x: x + frame_gap / 2.0 + c as f64 * pitch, y: y + band });
                }
            }
            let hole_pitch = pitch / HOLES_PER_FRAME;
            let hole_h = 0.55 * band;
            layout.strip_spec = Some(StripSpec {
                perforated,
                hole_w: 0.6 * hole_pitch,
                hole_h,
                hole_pitch,
                top_hole_y: (band - hole_h) / 2.0,
                bottom_hole_y: strip_h - band + (band - hole_h) / 2.0,
                text_offset: STRIP_TEXT_ROW * 0.72,
                text_pt: EDGE_PT,
            });
            (layout.cols, layout.rows, layout.box_w, layout.box_h, layout.label_h) = (cols, rows, box_w, box_h, 0.0);
        }
    }
    layout
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

/// Rectangle with rounded corners (the sprocket holes), as a path ready to be filled.
fn rounded_rect(c: &mut Content, x: f32, y: f32, w: f32, h: f32, r: f32) {
    let k = 0.5523 * r;
    c.move_to(x + r, y);
    c.line_to(x + w - r, y);
    c.cubic_to(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
    c.line_to(x + w, y + h - r);
    c.cubic_to(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
    c.line_to(x + r, y + h);
    c.cubic_to(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
    c.line_to(x, y + r);
    c.cubic_to(x, y + r - k, x + r - k, y, x + r, y);
    c.close_path();
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
        let mut line = |text: &str, baseline: Option<f64>, font: &'static [u8], size: f64, gray: f32| {
            let Some(baseline) = baseline else { return };
            c.begin_text();
            c.set_fill_gray(gray);
            c.set_font(Name(font), size as f32);
            c.next_line(pt(layout.margin), y_up(baseline));
            c.show(Str(&win_ansi(&fit_text(text, size, max_w))));
            c.end_text();
        };
        line(options.title.trim(), layout.title_baseline, b"F2", layout.title_pt, 0.1);
        line(options.subtitle.trim(), layout.subtitle_baseline, b"F1", layout.subtitle_pt, 0.35);
        line(&layout.scan_text, layout.scan_baseline, b"F1", layout.subtitle_pt, 0.35);
        c.set_stroke_gray(0.8);
        c.set_line_width(0.5);
        c.set_line_cap(LineCapStyle::ButtCap);
        c.move_to(pt(layout.margin), y_up(layout.rule_y));
        c.line_to(pt(layout.page_w - layout.margin), y_up(layout.rule_y));
        c.stroke();
    }

    // Film strip look: a dark strip behind every row, sprocket holes along the edges
    if let (SheetStyle::Strip, Some(spec)) = (layout.style, &layout.strip_spec) {
        for strip in &layout.strips {
            c.set_fill_gray(0.1);
            c.rect(pt(strip.x), y_up(strip.y + strip.h), pt(strip.w), pt(strip.h));
            c.fill_nonzero();
            if spec.perforated {
                c.set_fill_gray(1.0);
                for k in 0..(strip.frames as f64 * HOLES_PER_FRAME) as usize {
                    let x = strip.x + (k as f64 + 0.5) * spec.hole_pitch - spec.hole_w / 2.0;
                    for hole_y in [spec.top_hole_y, spec.bottom_hole_y] {
                        let y = strip.y + hole_y;
                        rounded_rect(&mut c, pt(x), y_up(y + spec.hole_h), pt(spec.hole_w), pt(spec.hole_h), pt(spec.hole_h * 0.25));
                        c.fill_nonzero();
                    }
                }
            }
        }
    }

    let digits = names.len().to_string().len().max(2);
    let is_strip = layout.style == SheetStyle::Strip;
    for (i, (cell, picture)) in layout.cells.iter().zip(pictures).enumerate() {
        // The box behind the picture (letterbox), the picture fitted inside it so portrait and landscape both stay visible
        c.set_fill_gray(if is_strip { 0.04 } else { 0.93 });
        c.rect(pt(cell.x), y_up(cell.y + layout.box_h), pt(layout.box_w), pt(layout.box_h));
        c.fill_nonzero();

        let scale = (layout.box_w / picture.width as f64).min(layout.box_h / picture.height as f64);
        let (w, h) = (picture.width as f64 * scale, picture.height as f64 * scale);
        let (x, y) = (cell.x + (layout.box_w - w) / 2.0, cell.y + (layout.box_h - h) / 2.0);
        c.save_state();
        c.transform([pt(w), 0.0, 0.0, pt(h), pt(x), y_up(y + h)]);
        c.x_object(Name(image_names[i].as_bytes()));
        c.restore_state();

        if let (true, Some(spec)) = (is_strip, &layout.strip_spec) {
            // Edge print like on real film: the frame number at the start, "12A" at the end
            let baseline = y_up(cell.y + layout.box_h + spec.text_offset);
            let number = format!("{}", i + 1);
            let end = format!("{number}A");
            c.set_fill_rgb(0.93, 0.68, 0.25);
            c.begin_text();
            c.set_font(Name(b"F1"), spec.text_pt as f32);
            c.next_line(pt(cell.x), baseline);
            c.show(Str(number.as_bytes()));
            c.end_text();
            let right = (cell.x + layout.box_w) * MM_TO_PT - text_width_pt(&end, spec.text_pt);
            c.begin_text();
            c.set_font(Name(b"F1"), spec.text_pt as f32);
            c.next_line(right as f32, baseline);
            c.show(Str(end.as_bytes()));
            c.end_text();
        } else {
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
            style: SheetStyle::Grid, landscape: false, columns: None, show_names: false,
            title: "Roll 12".into(), subtitle: "Kodak Portra 400 · Pentax 17".into(),
            scanned_at: String::new(),
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
        assert!(layout.cells[0].y >= 32.0);   // below the header
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

    fn strip_options() -> SheetOptions {
        SheetOptions { style: SheetStyle::Strip, ..options() }
    }

    #[test]
    fn film_strips_are_rows_with_frames_inside() {
        for landscape in [false, true] {
            for n in [1, 5, 6, 7, 12, 36, 72] {
                let mut o = strip_options();
                o.landscape = landscape;
                let l = layout(&vec![1.5; n], &o);
                let spec = l.strip_spec.as_ref().unwrap();
                assert!(spec.perforated);
                assert_eq!(l.cells.len(), n);
                assert_eq!(l.strips.iter().map(|s| s.frames).sum::<usize>(), n);
                for strip in &l.strips {
                    assert!(strip.x >= l.margin - 0.001 && strip.x + strip.w <= l.page_w - l.margin + 0.001, "strip sticks out sideways");
                    assert!(strip.y + strip.h <= l.page_h - l.margin + 0.001, "strip sticks out at the bottom ({n} frames, landscape {landscape})");
                }
                // Every picture sits inside "its" strip and no two pictures overlap
                let mut index = 0;
                for strip in &l.strips {
                    for _ in 0..strip.frames {
                        let c = &l.cells[index];
                        assert!(c.x >= strip.x && c.x + l.box_w <= strip.x + strip.w + 0.001);
                        assert!(c.y >= strip.y && c.y + l.box_h <= strip.y + strip.h);
                        index += 1;
                    }
                }
                for (i, a) in l.cells.iter().enumerate() {
                    for b in &l.cells[i + 1..] {
                        assert!((a.x - b.x).abs() >= l.box_w - 0.001 || (a.y - b.y).abs() >= l.box_h - 0.001, "pictures overlap");
                    }
                }
            }
        }
    }

    #[test]
    fn film_strip_of_36_has_six_strips_and_medium_format_has_no_holes() {
        let l = layout(&[1.5; 36], &strip_options());
        assert_eq!((l.cols, l.rows, l.strips.len()), (6, 6, 6));
        let spec = l.strip_spec.unwrap();
        assert!(spec.hole_w > 0.0 && spec.hole_h < spec.top_hole_y * 4.0 + spec.hole_h);
        assert!(spec.bottom_hole_y > spec.top_hole_y);

        let square = layout(&[1.0; 12], &strip_options());
        assert!(!square.strip_spec.unwrap().perforated);
    }

    #[test]
    fn no_header_means_more_room() {
        let mut o = options();
        o.title = " ".into();
        o.subtitle = "".into();
        let l = layout(&[1.5; 36], &o);
        assert!(!l.has_header);
        assert!(l.cells[0].y < 32.0);
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
        o.landscape = true;
        o.show_names = false;
        save_in(&dir, None, &o, &dir.join("landscape.pdf"), &|_| {}).unwrap();
        o.landscape = false;
        o.style = SheetStyle::Strip;
        save_in(&dir, None, &o, &dir.join("strip.pdf"), &|_| {}).unwrap();
        o.landscape = true;
        save_in(&dir, None, &o, &dir.join("strip_landscape.pdf"), &|_| {}).unwrap();
        for name in ["portrait.pdf", "landscape.pdf", "strip.pdf", "strip_landscape.pdf"] {
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
