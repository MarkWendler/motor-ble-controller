@echo off
REM Open the Motor BLE Controller in Chrome on Windows with Web Bluetooth enabled.
REM Use this when the Vite server runs on a remote Linux host and port 3000
REM is forwarded to this Windows machine (Cursor / VS Code Remote SSH does this).

set PORT=3000
set URL=http://localhost:%PORT%/motor-ble-controller/
set PROFILE_DIR=%LOCALAPPDATA%\motor-ble-controller-chrome

echo Opening Web Bluetooth app in Chrome on this Windows machine
echo URL: %URL%
echo Profile: %PROFILE_DIR%
echo.
echo Make sure the Vite server is running on the remote host first:
echo   node_modules/.bin/vite --host --port 3000
echo   (or: npx vite --host --port 3000)
echo.

start "" chrome.exe ^
  --enable-experimental-web-platform-features ^
  --enable-features=WebBluetooth ^
  --user-data-dir="%PROFILE_DIR%" ^
  --new-window ^
  "%URL%"
