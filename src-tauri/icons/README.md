App icon: the illustration is `app-icon-source.png` (1254 x 1254, full square). To make all sizes, put it into an SVG that cuts the macOS shape (824 px rounded square with radius 185 on a 1024 px transparent canvas, as in Apple's icon grid), then let Tauri render it:

    npx tauri icon icon.svg -o /tmp/icons

and copy the desktop files (32x32, 64x64, 128x128, 128x128@2x, Square*Logo, StoreLogo, icon.icns, icon.ico, icon.png) into this folder. Do not copy the `android` and `ios` folders.
