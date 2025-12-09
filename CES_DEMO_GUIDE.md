# Silicon Labs MG24 Motor Control Demo - CES Quick Guide

## 🎯 Demo Objective
Showcase the Silicon Labs MG24 microcontroller integrating three key technologies in a single chip:
1. **Bluetooth Connectivity** - Web Bluetooth SPP communication
2. **Motor Control** - PWM-based speed regulation
3. **Anomaly Detection** - AI/ML edge processing

---

## ⚡ Quick Start (2-3 minutes)

### Pre-Demo Setup
- [ ] Motor control board is powered and running
- [ ] Open the web app in Chrome/Edge on the display device
- [ ] Verify Bluetooth is enabled on the host device
- [ ] Test connection once before demo starts

### Demo Steps

**Step 1: Introduction (30 seconds)**
```
"This is the Silicon Labs MG24 microcontroller. It's a powerful platform 
that brings together wireless connectivity, motor control, and edge AI 
in a single chip. Today we're demonstrating a smart fan controller."
```

**Step 2: Connect Device (20 seconds)**
1. Click **"Connect Device"** button (left panel)
2. Select your motor control board from the list
3. Wait for status to show **"Connected"** (green indicator)

**Step 3: Demonstrate Control Modes (60 seconds)**

*Show Stop Mode:*
- Click **"⏹ Stop"** button
- Point to telemetry: "Motor status shows Stop, speed is 0 RPM"
- Mention: "This sends the M0 command to the motor control board"

*Show Low Speed:*
- Click **"🌀 Low (10 rad/s)"** button
- Point to telemetry: "Motor is now Running at ~95 RPM (10 rad/sec)"
- Mention: "This sends M10 command, motor accelerates smoothly"

*Show High Speed:*
- Click **"⚡ High (20 rad/s)"** button
- Point to telemetry: "Motor at full speed ~191 RPM (20 rad/sec)"
- Mention: "This sends M20 command, full power operation"

**Step 4: Highlight Key Features (30 seconds)**

*Point to Right Panel:*
- "Real-time telemetry updates every 500ms"
- "Speed displayed in both RPM and rad/sec for different use cases"
- "The green LED shows normal operation"

*Point to Anomaly Detection:*
- "The MG24 runs AI/ML models at the edge"
- "Anomaly detection monitors motor health and performance"
- "If something goes wrong, this indicator turns amber"

*Point to Connection Status:*
- "Green indicator shows active Bluetooth connection"
- "All communication happens wirelessly via Web Bluetooth SPP"

**Step 5: Technical Highlight (30 seconds)**
```
"What makes this impressive is that all three technologies run 
on a single MG24 chip:
- Bluetooth 5.2 for wireless connectivity
- Hardware PWM for precise motor control
- ML accelerator for real-time anomaly detection

This is the future of IoT home appliances - smart, connected, 
and intelligent, all in one compact package."
```

---

## 🔧 Troubleshooting at the Booth

| Problem | Quick Fix |
| --- | --- |
| "Web Bluetooth Not Supported" | Switch to Chrome or Edge browser |
| Device won't connect | Power cycle the motor board, try again |
| Commands not working | Check Bluetooth connection status (should be green) |
| No speed feedback | Verify motor board is sending data (check console) |
| Anomaly keeps triggering | Motor speed may be out of range - check firmware |

---

## 📱 Display Setup

### Recommended Setup
- **Display:** 24"+ monitor or tablet (landscape orientation)
- **Browser:** Chrome or Edge (full screen)
- **Resolution:** 1920x1080 or higher for best appearance
- **Connection:** Stable Bluetooth 5.0+ connection

### Layout Tips
- Position motor board visible next to display
- Keep display at eye level for viewers
- Use a wireless presenter if available for smooth transitions

---

## 💡 Talking Points

### For Technical Audiences
- "The MG24 features a dual-core ARM Cortex-M33 with ML acceleration"
- "Web Bluetooth SPP provides a modern alternative to traditional serial connections"
- "Edge AI enables real-time anomaly detection without cloud connectivity"
- "PWM control allows precise motor speed regulation with minimal latency"

### For Business Audiences
- "This demo shows how IoT home appliances can be smarter and more connected"
- "Web-based control means no app installation needed - just open a browser"
- "Edge processing keeps sensitive data local and reduces cloud dependency"
- "The MG24 platform reduces development time and time-to-market"

### For General Audiences
- "This is a smart fan controller that you can operate from any web browser"
- "It uses Bluetooth to communicate wirelessly with your device"
- "The system is intelligent - it can detect problems automatically"
- "All the smart features run locally on the chip, no internet required"

---

## 🎬 Demo Video Script (If Needed)

**30-Second Version:**
```
"Meet the Silicon Labs MG24 - a microcontroller that brings together 
wireless connectivity, motor control, and edge AI. Here we're demonstrating 
a smart fan controller. Watch as we connect via Bluetooth and control the 
motor speed with just a few clicks. The system monitors performance in 
real-time and can detect anomalies automatically. All of this intelligence 
runs on a single chip, making it perfect for the next generation of 
connected home appliances."
```

---

## 📊 Key Specifications to Mention

| Aspect | Detail |
| --- | --- |
| **Microcontroller** | Silicon Labs MG24 (Gecko) |
| **Wireless** | Bluetooth 5.2 with Web Bluetooth API |
| **Motor Control** | PWM-based, 0-20 rad/sec (0-191 RPM) |
| **Anomaly Detection** | ML-accelerated edge processing |
| **Interface** | Web-based (Chrome, Edge, Opera) |
| **Communication** | Serial Port Profile (SPP) |
| **Update Rate** | 2 Hz (500ms feedback) |
| **Power** | USB powered demo board |

---

## ✅ Post-Demo Checklist

- [ ] Disconnect Bluetooth device
- [ ] Close browser or refresh page
- [ ] Power down motor board
- [ ] Collect visitor feedback
- [ ] Note any issues for follow-up

---

## 📞 Support Contact

If issues arise during the demo:
1. Check browser console (F12) for error messages
2. Verify motor board firmware is correct SPP example
3. Try refreshing the page and reconnecting
4. Power cycle the motor board if needed

---

## 🎓 Additional Resources

- **Silicon Labs MG24 Datasheet:** [Link to datasheet]
- **Web Bluetooth Specification:** [MDN Web Docs]
- **SPP Protocol Documentation:** [Bluetooth SIG]
- **Motor Control Best Practices:** [Silicon Labs Application Notes]

---

**Remember:** This demo showcases the integration of three powerful technologies on a single chip. Focus on the "wow factor" of wireless control, real-time feedback, and intelligent anomaly detection!

Good luck at CES! 🚀
