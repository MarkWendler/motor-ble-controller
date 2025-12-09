# Final Firmware Integration Guide

## Telemetry Message Format

The application now supports the final firmware telemetry format:

```
Motor: <status>  Speed: <speed> Anomaly: <percentage>%\n
```

### Message Specification

| Field | Type | Range | Example |
| --- | --- | --- | --- |
| **Status** | String | "Running", "Stop", "Error" | Motor: Running |
| **Speed** | Float | 0.0 - 25.0 rad/sec | Speed: 15.50 |
| **Anomaly** | Integer | 0 - 100 % | Anomaly: 5% |

### Example Messages

```
Motor: Running  Speed: 15.50 Anomaly: 5%
Motor: Stop  Speed: 0.00 Anomaly: 0%
Motor: Error  Speed: 0.00 Anomaly: 95%
Motor: Running  Speed: 10.25 Anomaly: 25%
```

### Firmware Implementation (C)

```c
#include <stdio.h>

typedef struct {
    const char* status;  // "Running", "Stop", "Error"
    float speed;         // rad/sec
    int anomaly;         // 0-100%
} motor_telemetry_t;

void send_telemetry(motor_telemetry_t* telemetry) {
    char feedback[50];
    snprintf(feedback, sizeof(feedback), 
             "Motor: %s  Speed: %00.2f Anomaly: %d%%\n", 
             telemetry->status, telemetry->speed, telemetry->anomaly);
    
    // Send via UART/SPP
    uart_send((uint8_t*)feedback, strlen(feedback));
}

// Example usage
void main() {
    motor_telemetry_t telemetry = {
        .status = "Running",
        .speed = 15.50,
        .anomaly = 5
    };
    
    send_telemetry(&telemetry);
}
```

---

## Motor Control Commands

### Speed Control

| Command | Effect | Speed |
| --- | --- | --- |
| **M0** | Stop motor | 0 rad/sec |
| **M10** | Low speed | 10 rad/sec (~95 RPM) |
| **M20** | High speed | 20 rad/sec (~191 RPM) |

### Auto-Shutoff Control

| Command | Effect |
| --- | --- |
| **AOFF1** | Enable auto-shutoff feature |
| **AOFF0** | Disable auto-shutoff feature |

### Firmware Implementation (C)

```c
#include <string.h>

void process_command(const char* command) {
    if (strcmp(command, "M0") == 0) {
        // Stop motor
        motor_stop();
    } else if (strcmp(command, "M10") == 0) {
        // Set speed to 10 rad/sec
        motor_set_speed(10.0);
    } else if (strcmp(command, "M20") == 0) {
        // Set speed to 20 rad/sec
        motor_set_speed(20.0);
    } else if (strcmp(command, "AOFF1") == 0) {
        // Enable auto-shutoff
        auto_shutoff_enable();
    } else if (strcmp(command, "AOFF0") == 0) {
        // Disable auto-shutoff
        auto_shutoff_disable();
    }
}

// UART receive handler
void uart_rx_handler(uint8_t* data, int length) {
    static char command_buffer[32];
    static int buffer_pos = 0;
    
    for (int i = 0; i < length; i++) {
        uint8_t byte = data[i];
        
        if (byte == '\n') {
            // Command complete
            command_buffer[buffer_pos] = '\0';
            process_command(command_buffer);
            buffer_pos = 0;
        } else if (buffer_pos < sizeof(command_buffer) - 1) {
            command_buffer[buffer_pos++] = byte;
        }
    }
}
```

---

## Web Bluetooth SPP Service Configuration

### Service UUIDs

| Component | UUID |
| --- | --- |
| **Service UUID** | 4880c12c-fdcb-4077-8920-a450d7f9b907 |
| **Characteristic UUID** | fec26ec4-6d71-4442-9f81-55bc21d658d6 |

### Characteristic Properties

- **Read:** Enabled (for reading current state)
- **Write:** Enabled (for sending commands)
- **Notify:** Enabled (for receiving telemetry)

### Firmware Configuration Example

```c
// Define UUIDs
const uuid_128_t spp_service_uuid = {
    .data = { 0x07, 0xb9, 0xf9, 0xd7, 0x50, 0xa4, 0x20, 0x89, 
              0x77, 0x40, 0xcb, 0xfd, 0x2c, 0xc1, 0x80, 0x48 }
};

const uuid_128_t spp_data_characteristic_uuid = {
    .data = { 0xd6, 0x58, 0xd6, 0x21, 0xbc, 0x55, 0x81, 0x9f, 
              0x42, 0x44, 0x71, 0x6d, 0xc4, 0x6e, 0xc2, 0xfe }
};

// Initialize GATT service
void gatt_init() {
    // Create service
    sl_status_t status = sl_bt_gatt_server_add_service(&spp_service_uuid);
    
    // Add characteristic with Read, Write, Notify properties
    status = sl_bt_gatt_server_add_characteristic(
        &spp_data_characteristic_uuid,
        sl_bt_gatt_server_user_read_request |
        sl_bt_gatt_server_user_write_request |
        sl_bt_gatt_characteristic_notify
    );
}
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Web Browser / Electron App                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  FanController Component                             │   │
│  │  - Control Buttons (Stop, Low, High)                 │   │
│  │  - Auto-Shutoff Toggle                               │   │
│  │  - Telemetry Display                                 │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────┬──────────────────────────────────────┘
                         │ Web Bluetooth SPP
                         │ (4880c12c-fdcb-4077-8920-a450d7f9b907)
                         │
┌────────────────────────┴──────────────────────────────────────┐
│                  Silicon Labs MG24 MCU                         │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  BLE Stack (SPP Service)                             │    │
│  │  - Advertises service UUID                           │    │
│  │  - Handles Read/Write/Notify operations              │    │
│  └──────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Command Processing                                  │    │
│  │  - M0, M10, M20 (Motor speed control)                │    │
│  │  - AOFF0, AOFF1 (Auto-shutoff control)               │    │
│  └──────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Motor Control & Telemetry                           │    │
│  │  - PWM control                                       │    │
│  │  - Speed measurement                                 │    │
│  │  - Anomaly detection (AI/ML)                         │    │
│  │  - Telemetry formatting & transmission               │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                         │ Telemetry Messages
                         │ "Motor: Running  Speed: 15.50 Anomaly: 5%"
                         │
┌────────────────────────┴──────────────────────────────────────┐
│                    Web Browser / Electron App                  │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Telemetry Parser (telemetry-parser.ts)              │    │
│  │  - Parses incoming messages                          │    │
│  │  - Validates format                                  │    │
│  │  - Converts rad/sec to RPM                           │    │
│  └──────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  UI Update                                           │    │
│  │  - Display motor status                              │    │
│  │  - Display speed (RPM & rad/sec)                     │    │
│  │  - Display anomaly percentage                        │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## Testing Checklist

### Firmware Testing

- [ ] Motor responds to M0 command (stops)
- [ ] Motor responds to M10 command (runs at ~10 rad/sec)
- [ ] Motor responds to M20 command (runs at ~20 rad/sec)
- [ ] Telemetry messages are sent every ~500ms (2Hz)
- [ ] Telemetry format matches specification exactly
- [ ] Auto-shutoff responds to AOFF1 and AOFF0 commands
- [ ] Anomaly detection percentage is calculated correctly

### App Testing

- [ ] Web Bluetooth device picker appears when "Connect Device" clicked
- [ ] Motor board appears in device list
- [ ] Connection succeeds and status shows "Connected"
- [ ] Telemetry messages are parsed correctly
- [ ] Motor status displays correctly (Running/Stop/Error)
- [ ] Speed displays in both RPM and rad/sec
- [ ] Anomaly percentage displays correctly
- [ ] Stop button sends M0 and motor stops
- [ ] Low button sends M10 and motor runs at ~95 RPM
- [ ] High button sends M20 and motor runs at ~191 RPM
- [ ] Auto-shutoff toggle sends AOFF1 when enabled
- [ ] Auto-shutoff toggle sends AOFF0 when disabled
- [ ] Disconnect button closes connection properly

---

## Troubleshooting

### Telemetry Not Appearing in App

**Check:**
1. Firmware is sending messages with correct format
2. Messages end with `\n` (newline)
3. Speed value is a valid float (e.g., "15.50")
4. Anomaly value is an integer 0-100

**Example valid message:**
```
Motor: Running  Speed: 15.50 Anomaly: 5%\n
```

### Commands Not Received by Firmware

**Check:**
1. App is connected (status shows "Connected")
2. Command is sent with newline: `sendCommand("M10\n")`
3. Firmware UART handler is processing incoming data
4. Characteristic has Write property enabled

### App Crashes When Parsing Telemetry

**Check:**
1. Telemetry format matches exactly (spacing, capitalization)
2. Status is one of: "Running", "Stop", "Error"
3. Speed is a valid float number
4. Anomaly is an integer 0-100

---

## Performance Metrics

| Metric | Target | Actual |
| --- | --- | --- |
| **Telemetry Frequency** | 2 Hz (500ms) | - |
| **Message Size** | <50 bytes | ~35 bytes |
| **Parse Latency** | <10ms | - |
| **Command Latency** | <100ms | - |
| **Anomaly Update** | Real-time | - |

---

## Version History

| Version | Date | Changes |
| --- | --- | --- |
| 1.0 | Dec 2024 | Initial firmware integration with final telemetry format |

---

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Verify firmware implementation matches the C examples
3. Ensure telemetry format is exactly as specified
4. Test with the app's browser console open (F12) to see parse errors

---

**Last Updated:** December 2024
**Firmware Format Version:** 1.0
**App Version:** 1.0.0
