# FilmRoll Manager

by @MicheleHimself · v0.1.0

Prepares film scans from the lab for your photo library, in four steps:

1. **Select Folder** – choose or drag in the folder with your scans
2. **Frame Order** – reverse the order if the lab scanned the roll backwards
3. **Metadata** – embed date/time (+3 s per frame), camera, lens and film
4. **Rename** – rename all files with a template, e.g. `2026-09-27_IMG-01_Kodak-Gold-200.jpg`

Runs on macOS, Windows and Linux. No external tools required.

## Requirements

- [Rust](https://rustup.rs)
- [Node.js](https://nodejs.org)
- macOS: Xcode or the Xcode Command Line Tools
- Windows: Microsoft C++ Build Tools and WebView2 (preinstalled on Windows 11)

## Commands

```bash
npm install          # once, installs the Tauri CLI
npm run dev          # start the app in development mode
npm run build        # build an installable app
cd src-tauri && cargo test   # run the file-processing tests
```

After `npm run build`, the app is in `src-tauri/target/release/bundle/`
(`.dmg` on macOS, `.msi`/`.exe` on Windows, `.deb`/`.AppImage` on Linux).

## Where things live

| File | Purpose |
|---|---|
| `src/index.html`, `src/styles.css` | Layout and design (light + dark mode) |
| `src/main.js` | UI logic, steps, template editor |
| `src-tauri/src/processor.rs` | All file operations: reverse, metadata, rename |
| `src-tauri/tauri.conf.json` | App name, version, window size |

## Metadata written

| Field | Where |
|---|---|
| Shoot date and time | EXIF DateTimeOriginal, CreateDate, ModifyDate |
| Camera | EXIF Model |
| Lens | EXIF LensModel |
| Film | XMP `xmp:Label` (JPEG) or EXIF ImageDescription (PNG/TIFF) |
