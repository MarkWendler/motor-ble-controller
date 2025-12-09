# Electron Desktop App Setup Guide

## Overview

This document explains the Electron desktop application setup for the Silicon Labs Web Bluetooth Fan Controller Demo.

## Web Bluetooth Support in Electron

### Platform Support Status

| Platform | Web Bluetooth | Status | Notes |
| --- | --- | --- | --- |
| **macOS** | ✅ Full Support | Ready | Web Bluetooth API works natively |
| **Windows** | ⚠️ Partial | Supported | Requires `--enable-web-bluetooth` flag |
| **Linux** | ❌ Limited | Fallback | Web Bluetooth not available; uses native Bluetooth |

### How It Works

1. **macOS & Windows:** The Electron app uses the Web Bluetooth API (same as the web version) via the Chromium engine
2. **Linux:** Falls back to native Bluetooth via Node.js (future implementation)

## Project Structure

```
fan-controller-demo/
├── electron/
│   ├── main.ts          # Electron main process
│   └── preload.ts       # Preload script for secure IPC
├── client/
│   ├── src/
│   │   └── pages/FanController.tsx
│   └── public/
├── dist/                # Built React app
├── dist-electron/       # Compiled Electron files
├── package.json         # Build configuration
└── vite.config.ts
```

## Development

### Start Development Mode

```bash
pnpm dev:electron
```

This command:
1. Starts the Vite dev server on `http://localhost:5173`
2. Waits for the server to be ready
3. Launches Electron pointing to the dev server
4. Opens DevTools automatically

### Build for Production

```bash
pnpm build:electron
```

This command:
1. Builds the React app with Vite
2. Compiles Electron TypeScript files
3. Packages the app using electron-builder

## Electron Configuration Details

### Main Process (`electron/main.ts`)

The main process:
- Creates the application window
- Loads the React app (dev server or production build)
- Enables Web Bluetooth with `--enable-web-bluetooth` flag
- Provides IPC handlers for platform detection

### Preload Script (`electron/preload.ts`)

The preload script:
- Exposes safe APIs to the renderer process
- Uses `contextBridge` for secure communication
- Provides `window.electronAPI` object with:
  - `getPlatform()` - Returns current platform (darwin, win32, linux)
  - `requestDevice()` - Placeholder for future native Bluetooth support

### Security Features

- Context isolation enabled (`contextIsolation: true`)
- Node integration disabled (`nodeIntegration: false`)
- Sandbox enabled (`sandbox: true`)
- No remote module access

## Building Installers

### macOS

```bash
pnpm build:electron
```

Creates:
- `.dmg` - Disk image for distribution
- `.zip` - Compressed archive

### Windows

```bash
pnpm build:electron
```

Creates:
- `.exe` - NSIS installer
- `.exe` - Portable executable

### Linux

```bash
pnpm build:electron
```

Creates:
- `.AppImage` - Universal Linux app
- `.deb` - Debian package

## Troubleshooting

### Web Bluetooth Not Working

**Issue:** "Web Bluetooth Not Supported" message appears

**Solutions:**
1. Verify you're on macOS, Windows, or Linux with Bluetooth hardware
2. Ensure Bluetooth is enabled on your system
3. Check that the motor control board is powered and advertising
4. Try restarting the Electron app

### Electron Won't Start

**Issue:** Electron process exits immediately

**Solutions:**
1. Ensure Vite dev server is running: `pnpm dev`
2. Check that port 5173 is available
3. Run `pnpm check` to verify TypeScript compilation
4. Check the console for error messages

### Build Fails

**Issue:** `pnpm build:electron` fails

**Solutions:**
1. Clear build artifacts: `rm -rf dist dist-electron`
2. Reinstall dependencies: `pnpm install`
3. Verify Node.js version is 18+: `node --version`
4. Check disk space (electron-builder requires ~1GB)

## Platform-Specific Notes

### macOS

- Requires macOS 10.13 or later
- Code signing recommended for distribution
- Notarization required for macOS 10.15+

### Windows

- Requires Windows 7 or later
- Installer requires admin privileges
- Portable version doesn't require installation

### Linux

- Requires glibc 2.28 or later
- AppImage is self-contained and portable
- Deb package requires installation

## Environment Variables

No special environment variables required for basic operation.

For advanced configuration:
- `VITE_APP_TITLE` - Application title (default: "Silicon Labs Fan Controller")
- `NODE_ENV` - Set to `production` for production builds

## Performance Considerations

- Electron app uses ~150MB RAM at idle
- Web Bluetooth scanning uses minimal CPU
- Motor feedback updates at 2Hz (500ms intervals)

## Distribution

### For CES Demo

1. Build the app: `pnpm build:electron`
2. Distribute the installer for your platform:
   - macOS: `dist/Silicon Labs Fan Controller.dmg`
   - Windows: `dist/Silicon Labs Fan Controller Setup 1.0.0.exe`
   - Linux: `dist/Silicon Labs Fan Controller-1.0.0.AppImage`

### For End Users

The Electron app can be distributed via:
- Direct download from your website
- GitHub releases
- App stores (with additional setup)

## Future Enhancements

- Native Bluetooth support for Linux via `@abandonware/noble`
- Auto-update functionality via electron-updater
- Persistent settings storage
- Crash reporting and analytics
- Native menu integration

## Support

For issues with the Electron build:
1. Check this guide's troubleshooting section
2. Review Electron documentation: https://www.electronjs.org/docs
3. Check Web Bluetooth compatibility: https://caniuse.com/web-bluetooth
4. Consult Silicon Labs support for hardware issues

---

**Version:** 1.0
**Last Updated:** December 2024
**Electron Version:** 39.2.4
**Node Version:** 18+
