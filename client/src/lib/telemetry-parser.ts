/**
 * Telemetry Parser
 *
 * Parses telemetry messages from Silicon Labs motor control boards.
 *
 * Message format:
 * "Motor: <status>  Speed: <speed> Anomaly: <NORMAL|SLOWED|BLOCKED>\n"
 *
 * Legacy firmware may still send percentage values (0/60/90); those are mapped
 * to the same three states for backward compatibility.
 *
 * BLE SPP notifies are often chunked (~20 bytes). Firmware may also abort a
 * multi-chunk send when a new command arrives, so the stream parser must
 * recover partial / interleaved fragments — not only clean newline lines.
 */

export type AnomalyState = 'NORMAL' | 'SLOWED' | 'BLOCKED';

export interface MotorTelemetry {
  status: 'Running' | 'Stop' | 'Error';
  speed: number; // rad/sec (signed from firmware; UI uses magnitude for RPM)
  rpm: number; // calculated from |speed|
  anomaly: AnomalyState;
  timestamp: number;
}

/** Complete telemetry frame with discrete anomaly state. */
const TELEMETRY_STATE_FRAME_RE =
  /Motor:\s*(Running|Stop|Error)\s+Speed:\s*([-+]?\d+(?:\.\d+)?)\s+Anomaly:\s*(NORMAL|SLOWED|BLOCKED)/i;

/** Legacy percentage-based frames (pre–three-state BLE format). */
const TELEMETRY_PERCENT_FRAME_RE =
  /Motor:\s*(Running|Stop|Error)\s+Speed:\s*([-+]?\d+(?:\.\d+)?)\s+Anomaly:\s*(\d+)\s*%(?:\s+mode:\s*(imu|audio))?/i;

export function percentToAnomalyState(percent: number): AnomalyState {
  if (percent >= 80) {
    return 'BLOCKED';
  }
  if (percent >= 40) {
    return 'SLOWED';
  }
  return 'NORMAL';
}

function normalizeAnomalyState(raw: string): AnomalyState | null {
  const upper = raw.trim().toUpperCase();
  if (upper === 'NORMAL' || upper === 'SLOWED' || upper === 'BLOCKED') {
    return upper;
  }
  return null;
}

function buildTelemetry(
  status: 'Running' | 'Stop' | 'Error',
  speed: number,
  anomaly: AnomalyState
): MotorTelemetry | null {
  if (!['Running', 'Stop', 'Error'].includes(status)) {
    console.warn('[Telemetry] Invalid status:', status);
    return null;
  }

  // Firmware reports signed rad/s; reject only out-of-range magnitudes.
  if (isNaN(speed) || Math.abs(speed) > 300) {
    console.warn('[Telemetry] Invalid speed:', speed);
    return null;
  }

  const rpm = (Math.abs(speed) * 60) / (2 * Math.PI);

  return {
    status,
    speed,
    rpm,
    anomaly,
    timestamp: Date.now(),
  };
}

/**
 * Parse telemetry message from firmware.
 */
export function parseTelemetry(message: string): MotorTelemetry | null {
  try {
    const line = message.trim();

    const stateMatch = line.match(TELEMETRY_STATE_FRAME_RE);
    if (stateMatch) {
      const status = stateMatch[1] as 'Running' | 'Stop' | 'Error';
      const speed = parseFloat(stateMatch[2]);
      const anomaly = normalizeAnomalyState(stateMatch[3]);
      if (!anomaly) {
        return null;
      }
      return buildTelemetry(status, speed, anomaly);
    }

    const percentMatch = line.match(TELEMETRY_PERCENT_FRAME_RE);
    if (percentMatch) {
      const status = percentMatch[1] as 'Running' | 'Stop' | 'Error';
      const speed = parseFloat(percentMatch[2]);
      const anomalyPercentage = parseInt(percentMatch[3], 10);
      if (isNaN(anomalyPercentage) || anomalyPercentage < 0 || anomalyPercentage > 100) {
        console.warn('[Telemetry] Invalid anomaly percentage:', anomalyPercentage);
        return null;
      }
      return buildTelemetry(status, speed, percentToAnomalyState(anomalyPercentage));
    }

    console.warn('[Telemetry] Message does not match expected format:', line);
    return null;
  } catch (error) {
    console.error('[Telemetry] Parse error:', error);
    return null;
  }
}

/**
 * Streaming telemetry parser for handling chunked Bluetooth notifications.
 */
export class TelemetryStreamParser {
  private buffer: string = '';

  feed(data: string | Uint8Array | DataView | ArrayBuffer): MotorTelemetry[] {
    const frames: MotorTelemetry[] = [];
    const str = decodeBlePayload(data).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    this.buffer += str;

    const patterns = [TELEMETRY_STATE_FRAME_RE, TELEMETRY_PERCENT_FRAME_RE];
    let lastEnd = 0;

    for (const pattern of patterns) {
      const re = new RegExp(pattern.source, 'gi');
      let match: RegExpExecArray | null;

      while ((match = re.exec(this.buffer)) !== null) {
        const telemetry = parseTelemetry(match[0]);
        if (telemetry) {
          frames.push(telemetry);
        }
        lastEnd = Math.max(lastEnd, match.index + match[0].length);
      }
    }

    if (lastEnd > 0) {
      this.buffer = this.buffer.slice(lastEnd);
    }

    const motorIdx = this.buffer.indexOf('Motor:');
    if (motorIdx > 0) {
      this.buffer = this.buffer.slice(motorIdx);
    } else if (motorIdx < 0 && this.buffer.length > 64) {
      this.buffer = this.buffer.slice(-16);
    } else if (this.buffer.length > 512) {
      this.buffer = this.buffer.slice(-256);
    }

    return frames;
  }

  reset(): void {
    this.buffer = '';
  }

  getBuffer(): string {
    return this.buffer;
  }
}

function decodeBlePayload(data: string | Uint8Array | DataView | ArrayBuffer): string {
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof Uint8Array) {
    return new TextDecoder().decode(data);
  }
  if (data instanceof DataView) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  return new TextDecoder().decode(new Uint8Array(data));
}

export function createTestTelemetry(
  status: 'Running' | 'Stop' | 'Error' = 'Stop',
  speed: number = 0,
  anomaly: AnomalyState = 'NORMAL'
): string {
  return `Motor: ${status}  Speed: ${speed.toFixed(2)} Anomaly: ${anomaly}\n`;
}

export function isValidTelemetryFormat(message: string): boolean {
  const line = message.trim();
  return TELEMETRY_STATE_FRAME_RE.test(line) || TELEMETRY_PERCENT_FRAME_RE.test(line);
}

export function anomalyLabel(anomaly: AnomalyState): string {
  switch (anomaly) {
    case 'SLOWED':
      return 'Slowed fan';
    case 'BLOCKED':
      return 'Blocked fan';
    default:
      return 'Normal operation';
  }
}
