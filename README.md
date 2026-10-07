# FilmRoll Manager

by [@MicheleHimself](https://www.instagram.com/michelehimself/)

Gets film scans from the lab ready for your photo library: look at the whole roll,
fix the order, add camera, lens, film and date, rate and rename the files, and print
a contact sheet. Free to use.

**Your pictures never leave your computer.** There are no uploads and no tracking.
The only network request the app can make is an optional check for a newer version
(Settings → Updates, off by default); it asks GitHub for a version number and sends
no pictures, file names or personal data.

## What it does

- **File list** of a folder (JPG, PNG, TIFF) with thumbnails, large preview on Space,
  editable camera, lens, film and date, and a star rating (1–5).
- **Rotate** pictures (only the EXIF orientation changes, never the image data).
- **Reverse Roll Order** if the lab scanned the roll backwards.
- **Bulk Edit Metadata**: date and time (+3 s per frame, so the order survives in Apple
  Photos and Google Photos), camera, lens, film (the ISO is read from the film name).
- **Bulk Rename** with a template, for example `2026-09-27_IMG-01_Kodak-Gold-200.jpg`.
- **Contact sheet** as a one-page A4 PDF, optionally with room for a hole punch.
- Films list with favorites and your own films, and your own cameras and lenses.
- Light and dark mode.

Only metadata is changed, and the output passes `exiftool -validate`.
**Please work on a copy of your scans, not on the originals.**

## Install (macOS, Apple Silicon)

1. Download the `.dmg` from the
   [latest release](https://github.com/michelehimself/filmroll-manager/releases/latest)
   and drag the app into Applications.
2. The first time, right-click the app and choose **Open** (the app is not signed
   with an Apple developer account). If macOS still refuses, run this once in Terminal:

   ```bash
   xattr -dr com.apple.quarantine "/Applications/FilmRoll Manager.app"
   ```

After that the app can update itself under Settings → Updates.

## Build from source

You need [Rust](https://rustup.rs), [Node.js](https://nodejs.org) and, on macOS, the
Xcode Command Line Tools.

```bash
npm install
npm run dev                    # run the app (shows a DEV chip in the title bar)
npm run build:local            # build an installer without update files
cd src-tauri && cargo test     # run the file-processing tests
```

## Licence

Copyright (c) 2026 @MicheleHimself. All rights reserved. The code is public so you can
see how the app works; it may not be copied, modified or redistributed. See
[LICENSE](LICENSE). Manufacturer names and logos are registered trademarks of their
owners and are shown only to identify film stocks, without any affiliation or
endorsement.
