App icon: edit `app-icon.svg` (dark rounded square, film frame in the brand colour #FFAE00), then regenerate all sizes from the project folder:

    npx tauri icon src-tauri/icons/app-icon.svg -o /tmp/icons

and copy the desktop files (32x32, 64x64, 128x128, 128x128@2x, Square*Logo, StoreLogo, icon.icns, icon.ico, icon.png) into this folder. Do not copy the `android` and `ios` folders.
