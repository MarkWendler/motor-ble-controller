# Silicon Labs MG24 Web Bluetooth Fan Controller Demo

A modern, technical web application demonstrating the integration of three core technologies on the Silicon Labs MG24 microcontroller:

- **Bluetooth Connectivity** (Web Bluetooth SPP)
- **Motor Control** (PWM-based speed regulation)
- **Anomaly Detection** (AI/ML edge processing)

This demo is designed for exhibition environments, showcasing how the xG24 platform enables seamless IoT home appliance control through a web-based interface.

## Features

### Three-Mode Motor Control
- **Stop Mode (M0):** Stops the motor completely
- **Low Mode (M10):** Runs motor at 10 rad/sec (~95 RPM)
- **High Mode (M20):** Runs motor at 20 rad/sec (~191 RPM)

### Real-Time Telemetry Display
- **Motor Status:** Running, Stop, or Error states with LED indicator
- **Speed Display:** Shows both RPM and rad/sec in real-time
- **Anomaly Detection:** AI/ML-based anomaly detection with visual indicator
- **Connection Status:** Live Bluetooth connection indicator

### Modern Technical Design
- Clean, professional interface optimized for exhibition viewing
- Responsive layout that works on tablets and displays
- Smooth animations and interactive feedback

## Technical Stack

- **Frontend:** React 19 + TypeScript + Tailwind CSS 4
- **Communication:** Web Bluetooth API (SPP - Serial Port Profile)
- **Hosting:** GitHub Pages or any static web server
- **Browser Support:** Chrome, Edge, Opera (requires Web Bluetooth support)

## Hardware Requirements

- Silicon Labs MG24 development board or Arduino nano Matter  with motor control firmware
- Motor control board running SPP firmware example
- Device with Bluetooth 5.0+ and Web Bluetooth API support
- USB power for the motor control board

## Getting Started

### Development Setup

1. **Install dependencies:**
   ```bash
   cd fan-controller-demo
   pnpm install
   ```

2. **Start development server:**
   ```bash
   pnpm dev
   ```
   The application will be available at `http://localhost:3000`

3. **Build for production:**
   ```bash
   pnpm build
   ```

### Using the Demo

1. **Connect to Device:**
   - Click the "Connect Device" button in the left panel
   - Select your Silicon Labs motor control board from the browser's Bluetooth device list
   - Wait for connection confirmation (status will show "Connected")

2. **Control the Motor:**
   - Click **Stop** to halt the motor (sends M0)
   - Click **Low** to run at 10 rad/sec (sends M10)
   - Click **High** to run at 20 rad/sec (sends M20)

3. **Monitor Feedback:**
   - Real-time motor status updates from the device
   - Speed display in both RPM and rad/sec
   - Anomaly detection indicator shows system health
   - LED indicators provide visual feedback

4. **Disconnect:**
   - Click "Disconnect" to safely close the Bluetooth connection

## Communication Protocol

### Command Format
Commands are sent to the motor control board as simple text strings:
- `M0` - Stop motor
- `M10` - Set speed to 10 rad/sec
- `M20` - Set speed to 20 rad/sec

Each command is terminated with a newline character (`\n`).

### Feedback Format
The motor control board sends feedback approximately every 500ms (2 Hz) in the following format:
```
Motor: <status>  Speed: <speed_value>
```

**Example:**
```
Motor: Running  Speed: 19.87
Motor: Stop  Speed: 0.00
Motor: Error  Speed: 0.00
```

**Status Values:**
- `Running` - Motor is actively spinning
- `Stop` - Motor is stopped
- `Error` - Motor encountered an error condition

**Speed Value:**
- Floating-point number representing current speed in rad/sec
- Range: 0.00 to 25.00 (with tolerance)

## Anomaly Detection

The application includes built-in anomaly detection that monitors:
- **Status/Mode Mismatch:** Motor status doesn't match the requested mode
- **Speed Out of Range:** Actual speed exceeds expected range for the mode
- **Error State:** Motor reports error condition

When an anomaly is detected, the Anomaly Detection indicator turns amber and pulses to alert the operator.

## Browser Compatibility

| Browser | Support | Notes |
| --- | --- | --- |
| Chrome | ✅ Full | Recommended for CES demo |
| Edge | ✅ Full | Chromium-based, fully supported |
| Opera | ✅ Full | Chromium-based, fully supported |
| Firefox | ❌ None | Web Bluetooth not implemented |
| Safari | ⚠️ Partial | Limited support, not recommended |

**Note:** Web Bluetooth requires HTTPS on production deployments (localhost is exempt during development).

## Exhibition Setup Guide

### Pre-Demo Checklist
1. ✅ Verify motor control board is powered and running SPP firmware
2. ✅ Test Web Bluetooth connection in Chrome/Edge
3. ✅ Confirm all three control modes (Stop, Low, High) send commands correctly
4. ✅ Verify feedback messages are received and displayed
5. ✅ Check anomaly detection triggers appropriately
6. ✅ Test on the display device (tablet/monitor) that will be used at CES

### Demo Flow (2-3 minutes)
1. **Introduction (30s):** "This is the Silicon Labs MG24 microcontroller, integrating Bluetooth, Motor Control, and AI/ML anomaly detection."
2. **Connect (20s):** Click "Connect Device" and select the motor board
3. **Demonstrate Modes (60s):**
   - Click Stop → Show motor stopping
   - Click Low → Show motor running at 10 rad/sec
   - Click High → Show motor at full 20 rad/sec
4. **Highlight Features (30s):**
   - Point out real-time telemetry display
   - Explain anomaly detection indicator
   - Show Bluetooth connectivity status
5. **Technical Discussion (30s):** Discuss integration of three technologies on single MCU

### Troubleshooting at CES

| Issue | Solution |
| --- | --- |
| "Web Bluetooth Not Supported" | Ensure using Chrome/Edge, not Firefox or Safari |
| Device not appearing in scan | Check motor board is powered and in pairing mode |
| Commands not sending | Verify Bluetooth connection is active (green indicator) |
| No feedback received | Check motor board firmware is running SPP example |
| Anomaly keeps triggering | Verify motor board is responding with correct speed values |

## Technical Implementation Details

### Web Bluetooth SPP Connection
The application uses the Web Bluetooth API to establish a connection to the SPP (Serial Port Profile) service:
- **Service UUID:** `4880c12c-fdcb-4077-8920-a450d7f9b907` (Custom SPP Service)
- **Characteristic UUID:** `fec26ec4-6d71-4442-9f81-55bc21d658d6` (Custom SPP Data)

### Message Parsing
Incoming feedback is buffered and parsed line-by-line using regex patterns to extract:
- Motor status (Running/Stop/Error)
- Current speed in rad/sec

Speed is then converted to RPM using the formula:
```
RPM = (rad/sec × 60) / (2π)
```

### State Management
The application maintains real-time state for:
- Connection status
- Current motor mode (Stop/Low/High)
- Motor status and speed
- Anomaly detection state
- Last update timestamp

## Color Scheme

The modern technical design uses:
- **Deep Slate Blue** (`oklch(0.35 0.12 260)`) - Primary color, trust and technology
- **Vibrant Cyan** (`oklch(0.65 0.2 200)`) - Accent color, energy and connectivity
- **Emerald Green** (`oklch(0.6 0.15 140)`) - Success state, motor running
- **Amber** (`oklch(0.7 0.15 60)`) - Warning state, caution
- **Coral Red** (`oklch(0.6 0.2 20)`) - Error state, critical issues

## Typography

- **Headlines:** Poppins 700 (bold, modern)
- **Body Text:** Inter 400 (clean, readable)
- **Technical Values:** Roboto Mono 500 (monospace for precision)

## Deployment

### Static Hosting (GitHub Pages, Netlify, Vercel)
1. Build the project: `pnpm build`
2. Deploy the `dist` folder to your hosting service
3. Ensure HTTPS is enabled (required for Web Bluetooth in production)

### Local Development
```bash
pnpm dev
```
Access at `http://localhost:3000` (HTTP is allowed for localhost)

## Project Structure

```
fan-controller-demo/
├── client/
│   ├── public/
│   │   └── images/
│   │       ├── hero-circuit-bg.png
│   │       └── motor-control-hero.png
│   ├── src/
│   │   ├── pages/
│   │   │   ├── FanController.tsx    (Main demo interface)
│   │   │   └── NotFound.tsx
│   │   ├── components/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css                (Design tokens and styles)
│   └── index.html
├── server/
│   └── index.ts                     (Express server for production)
├── package.json
└── README.md
```

## Future Enhancements

Potential features for future versions:
- Historical data logging and visualization
- Advanced anomaly detection with ML models
- Multi-device support (control multiple motors)
- Mobile app version
- Voice control integration
- Real-time performance metrics dashboard

## Support & Troubleshooting

### Common Issues

**Q: "Your browser can't use Web Bluetooth"**
A: Your browser doesn't support Web Bluetooth API. Use Chrome, Edge, or Opera instead.

**Q: Connection fails immediately**
A: Ensure the motor control board is powered, running SPP firmware, and in pairing mode.

**Q: Commands send but motor doesn't respond**
A: Verify the motor board firmware is correctly programmed with the SPP example.

**Q: Feedback not updating**
A: Check that the motor board is sending feedback in the correct format: `Motor: <status>  Speed: <value>`

## License

© 2025 Silicon Labs. All rights reserved.

## Version

**v1.0.0** - Initial release for CES 2025 demo

---

For more information about Silicon Labs MG24, visit: [silicon-labs.com](https://www.silicon-labs.com)
