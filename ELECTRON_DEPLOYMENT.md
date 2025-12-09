# Electron App Deployment & Testing Guide

## Web Bluetooth Support Summary

### Platform Compatibility

| Platform | Web Bluetooth | Status | Notes |
| --- | --- | --- | --- |
| **macOS 10.13+** | ✅ Full | Ready | Native Web Bluetooth support via Chromium |
| **Windows 7+** | ✅ Full | Ready | Web Bluetooth with `--enable-web-bluetooth` flag |
| **Linux** | ⚠️ Limited | Fallback | Native Bluetooth via @abandonware/noble (future) |

### Key Finding

**Web Bluetooth IS supported in Electron** on macOS and Windows. The application uses the same Web Bluetooth API as the web version, but through Electron's Chromium engine.

## Building the Electron App

### Prerequisites

- Node.js 18 or later
- pnpm package manager
- Bluetooth hardware (for testing)

### Development Build

```bash
# Install dependencies
pnpm install

# Start development mode (Vite + Electron)
pnpm dev:electron
```

This will:
1. Start the Vite dev server on `http://localhost:5173`
2. Launch Electron connected to the dev server
3. Open DevTools for debugging

### Production Build

```bash
# Build the app for your platform
pnpm build:electron
```

**Output locations:**
- **macOS:** `dist/Silicon Labs Fan Controller.dmg` and `dist/Silicon Labs Fan Controller-1.0.0.zip`
- **Windows:** `dist/Silicon Labs Fan Controller Setup 1.0.0.exe` and `dist/Silicon Labs Fan Controller 1.0.0.exe`
- **Linux:** `dist/Silicon Labs Fan Controller-1.0.0.AppImage` and `dist/fan-controller-demo_1.0.0_amd64.deb`

## Testing the Electron App

### Pre-Test Checklist

- [ ] Motor control board is powered on
- [ ] Motor control board is advertising the SPP service
- [ ] Bluetooth is enabled on your computer
- [ ] No other apps are using the motor control board

### Test Procedure

1. **Start the app:**
   ```bash
   pnpm dev:electron
   ```

2. **Verify Web Bluetooth is available:**
   - You should NOT see "Web Bluetooth Not Supported" message
   - The "Connect Device" button should be enabled

3. **Connect to device:**
   - Click "Connect Device"
   - Select your motor control board from the list
   - Wait for "Connected" status (green indicator)

4. **Test motor control:**
   - Click "Stop" button → Motor should stop
   - Click "Low" button → Motor should run at ~10 rad/sec (~95 RPM)
   - Click "High" button → Motor should run at ~20 rad/sec (~191 RPM)

5. **Verify telemetry:**
   - Motor status should update in real-time
   - Speed should display in both RPM and rad/sec
   - Anomaly detection indicator should show normal operation

6. **Test disconnect:**
   - Click "Disconnect" button
   - Status should show "Disconnected" (red indicator)

### Expected Behavior

| Action | Expected Result |
| --- | --- |
| Click "Connect Device" | Browser Bluetooth device picker appears |
| Select motor board | Status changes to "Connected" (green) |
| Click "Stop" | Motor stops, status shows "Stop", speed = 0 RPM |
| Click "Low" | Motor runs, status shows "Running", speed ≈ 95 RPM |
| Click "High" | Motor runs faster, status shows "Running", speed ≈ 191 RPM |
| Feedback arrives | Telemetry updates every ~500ms |
| Click "Disconnect" | Status changes to "Disconnected" (red) |

## Troubleshooting

### "Web Bluetooth Not Supported" Error

**Cause:** Bluetooth API not available in Electron

**Solutions:**
1. Verify you're running on macOS or Windows (Linux requires additional setup)
2. Ensure Electron was built with Web Bluetooth support
3. Check that the main process has `--enable-web-bluetooth` flag set
4. Try restarting the Electron app

**Check in DevTools:**
```javascript
// In DevTools console
typeof navigator.bluetooth
// Should return 'object', not 'undefined'
```

### Device Not Appearing in Scan

**Cause:** Motor board not advertising or Bluetooth disabled

**Solutions:**
1. Power cycle the motor control board
2. Verify Bluetooth is enabled on your computer
3. Check that the motor board firmware is running the SPP example
4. Try scanning again (close and reopen the device picker)
5. Check motor board logs for errors

### Commands Send But Motor Doesn't Respond

**Cause:** Connection established but commands not received

**Solutions:**
1. Verify the motor board is receiving data (check firmware logs)
2. Confirm command format is correct (M0, M10, M20)
3. Check that the characteristic UUID matches firmware configuration
4. Try disconnecting and reconnecting

### No Feedback Messages Received

**Cause:** Notifications not enabled or feedback not being sent

**Solutions:**
1. Verify motor board is sending feedback every 500ms
2. Check feedback format matches exactly: `Motor: <STATUS>  Speed: <VALUE>\n`
3. Ensure the characteristic has NOTIFY property enabled
4. Check browser console for parsing errors

## Platform-Specific Notes

### macOS

- **Minimum version:** macOS 10.13 (High Sierra)
- **Code signing:** Required for distribution outside app store
- **Notarization:** Required for macOS 10.15+ (Catalina and later)
- **Distribution:** Use `.dmg` or `.zip` for end users

### Windows

- **Minimum version:** Windows 7
- **Admin privileges:** Installer requires admin rights
- **Portable version:** `.exe` portable doesn't require installation
- **Distribution:** Use `.exe` installer or portable version

### Linux

- **Minimum glibc:** 2.28 or later
- **AppImage:** Self-contained, works on most distributions
- **Deb package:** For Debian-based systems
- **Web Bluetooth:** Not available; future support via @abandonware/noble

## Performance Metrics

| Metric | Value |
| --- | --- |
| **Startup time** | ~2-3 seconds |
| **Memory usage** | ~150-200 MB idle |
| **CPU usage** | <5% idle |
| **Bluetooth scan time** | ~3-5 seconds |
| **Connection time** | ~1-2 seconds |
| **Feedback latency** | ~50-100 ms |

## Distribution

### For CES Demo

1. Build the app:
   ```bash
   pnpm build:electron
   ```

2. Choose the appropriate installer for your demo platform:
   - **macOS:** `dist/Silicon Labs Fan Controller.dmg`
   - **Windows:** `dist/Silicon Labs Fan Controller Setup 1.0.0.exe`
   - **Linux:** `dist/Silicon Labs Fan Controller-1.0.0.AppImage`

3. Test the installer on a clean machine before the demo

### For End Users

**macOS:**
- Distribute `.dmg` file
- Users double-click to mount and drag app to Applications folder

**Windows:**
- Distribute `.exe` installer
- Users run installer and follow prompts
- Or distribute portable `.exe` for no installation needed

**Linux:**
- Distribute `.AppImage` for universal compatibility
- Or distribute `.deb` for Debian-based systems

## Continuous Deployment

For automated builds and distribution:

1. Set up GitHub Actions workflow
2. Build on push to main branch
3. Create GitHub release with installers
4. Users download from releases page

Example workflow file: `.github/workflows/build.yml`

## Support & Troubleshooting

### Logs

Check Electron logs for debugging:
- **macOS:** `~/Library/Logs/Silicon Labs Fan Controller/`
- **Windows:** `%APPDATA%\Silicon Labs Fan Controller\logs\`
- **Linux:** `~/.config/Silicon Labs Fan Controller/logs/`

### Debug Mode

Enable debug logging:
```bash
DEBUG=* pnpm dev:electron
```

### Report Issues

When reporting issues, include:
1. Platform and OS version
2. Electron app version
3. Motor control board firmware version
4. Steps to reproduce
5. Console output and logs
6. Screenshots/videos if applicable

## Version History

| Version | Date | Changes |
| --- | --- | --- |
| 1.0.0 | Dec 2024 | Initial Electron release |

## Future Enhancements

- [ ] Native Bluetooth support for Linux via @abandonware/noble
- [ ] Auto-update functionality
- [ ] Settings persistence
- [ ] Crash reporting
- [ ] Performance monitoring
- [ ] Multi-device support

---

**Last Updated:** December 2024
**Electron Version:** 39.2.4
**Node Version:** 18+
