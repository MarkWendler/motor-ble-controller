/**
 * Telemetry Parser
 * 
 * Parses telemetry messages from Silicon Labs MG24 motor control board.
 * 
 * Message format:
 * "Motor: <status>  Speed: <speed> Anomaly: <percentage>%\n"
 * 
 * Example:
 * "Motor: Running  Speed: 15.50 Anomaly: 5%"
 * "Motor: Stop  Speed: 0.00 Anomaly: 0%"
 * "Motor: Error  Speed: 0.00 Anomaly: 95%"
 */

export interface MotorTelemetry {
  status: 'Running' | 'Stop' | 'Error';
  speed: number; // rad/sec
  rpm: number; // calculated from speed
  anomalyPercentage: number; // 0-100%
  anomalyDetected: boolean; // true if anomaly > 50%
  timestamp: number;
}

/**
 * Parse telemetry message from firmware
 * Format: "Motor: <status>  Speed: <speed> Anomaly: <percentage>%"
 * 
 * @param message - Raw telemetry message string
 * @returns Parsed telemetry data or null if invalid
 */
export function parseTelemetry(message: string): MotorTelemetry | null {
  try {
    // Trim whitespace
    const line = message.trim();

    // Match pattern: Motor: <status>  Speed: <speed> Anomaly: <percentage>%
    const regex = /Motor:\s*(\w+)\s+Speed:\s*([\d.]+)\s+Anomaly:\s*(\d+)%/i;
    const match = line.match(regex);

    if (!match) {
      console.warn('[Telemetry] Message does not match expected format:', line);
      return null;
    }

    const status = match[1] as 'Running' | 'Stop' | 'Error';
    const speed = parseFloat(match[2]);
    const anomalyPercentage = parseInt(match[3], 10);

    // Validate status
    if (!['Running', 'Stop', 'Error'].includes(status)) {
      console.warn('[Telemetry] Invalid status:', status);
      return null;
    }

    // Validate speed
    if (isNaN(speed) || speed < 0 || speed > 25) {
      console.warn('[Telemetry] Invalid speed:', speed);
      return null;
    }

    // Validate anomaly percentage
    if (isNaN(anomalyPercentage) || anomalyPercentage < 0 || anomalyPercentage > 100) {
      console.warn('[Telemetry] Invalid anomaly percentage:', anomalyPercentage);
      return null;
    }

    // Convert rad/sec to RPM: RPM = (rad/sec * 60) / (2π)
    const rpm = (speed * 60) / (2 * Math.PI);

    // Detect anomaly (true if percentage > 50%)
    const anomalyDetected = anomalyPercentage > 50;

    return {
      status,
      speed,
      rpm,
      anomalyPercentage,
      anomalyDetected,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error('[Telemetry] Parse error:', error);
    return null;
  }
}

/**
 * Streaming telemetry parser for handling data from Bluetooth
 * Buffers incomplete messages and yields complete messages
 */
export class TelemetryStreamParser {
  private buffer: string = '';

  /**
   * Feed data into the parser
   * @param data - Incoming data as string or Uint8Array
   * @returns Array of parsed telemetry frames
   */
  feed(data: string | Uint8Array): MotorTelemetry[] {
    const frames: MotorTelemetry[] = [];

    // Convert Uint8Array to string if needed
    const str = typeof data === 'string' ? data : new TextDecoder().decode(data);

    // Append to buffer
    this.buffer += str;

    // Split by newline and process complete messages
    const lines = this.buffer.split('\n');

    // Keep the last incomplete line in the buffer
    this.buffer = lines[lines.length - 1];

    // Process all complete lines
    for (let i = 0; i < lines.length - 1; i++) {
      const telemetry = parseTelemetry(lines[i]);
      if (telemetry) {
        frames.push(telemetry);
      }
    }

    return frames;
  }

  /**
   * Reset the parser state
   */
  reset(): void {
    this.buffer = '';
  }

  /**
   * Get any remaining buffered data
   */
  getBuffer(): string {
    return this.buffer;
  }
}

/**
 * Create a test telemetry message for development
 * @param status - Motor status
 * @param speed - Speed in rad/sec
 * @param anomalyPercentage - Anomaly percentage
 * @returns Formatted telemetry message
 */
export function createTestTelemetry(
  status: 'Running' | 'Stop' | 'Error' = 'Stop',
  speed: number = 0,
  anomalyPercentage: number = 0
): string {
  return `Motor: ${status}  Speed: ${speed.toFixed(2)} Anomaly: ${anomalyPercentage}%\n`;
}

/**
 * Validate telemetry message format
 * @param message - Message to validate
 * @returns true if message matches expected format
 */
export function isValidTelemetryFormat(message: string): boolean {
  const regex = /Motor:\s*(\w+)\s+Speed:\s*([\d.]+)\s+Anomaly:\s*(\d+)%/i;
  return regex.test(message.trim());
}
