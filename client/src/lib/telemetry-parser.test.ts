import { describe, expect, it } from 'vitest';
import {
  ANOMALY_BLOCKED_SCORE,
  ANOMALY_SLOWED_SCORE,
  TelemetryStreamParser,
  isAnomalyDetectionActive,
  parseTelemetry,
  percentToAnomalyState,
} from './telemetry-parser';

describe('percentage frames', () => {
  it('keeps the numeric anomaly score the firmware reports', () => {
    const frame = parseTelemetry('Motor: Running  Speed: 29.81 Anomaly: 72%');

    expect(frame?.anomalyScore).toBe(72);
    expect(frame?.anomaly).toBe('SLOWED');
  });

  it('keeps a zero score rather than treating it as absent', () => {
    const frame = parseTelemetry('Motor: Running  Speed: 30.00 Anomaly: 0%');

    expect(frame?.anomalyScore).toBe(0);
    expect(frame?.anomaly).toBe('NORMAL');
  });

  it('reads the score from frames that also carry a detection mode', () => {
    const frame = parseTelemetry('Motor: Running  Speed: 49.50 Anomaly: 95% mode: audio');

    expect(frame?.anomalyScore).toBe(95);
    expect(frame?.anomaly).toBe('BLOCKED');
  });

  it('rejects a score outside 0-100', () => {
    expect(parseTelemetry('Motor: Running  Speed: 30.00 Anomaly: 140%')).toBeNull();
  });
});

describe('three-state frames', () => {
  it('reports no score, because the format carries no number', () => {
    const frame = parseTelemetry('Motor: Running  Speed: 50.00 Anomaly: BLOCKED');

    expect(frame?.anomaly).toBe('BLOCKED');
    expect(frame?.anomalyScore).toBeNull();
  });
});

describe('percentToAnomalyState', () => {
  it('maps each band at its boundary', () => {
    expect(percentToAnomalyState(ANOMALY_SLOWED_SCORE - 1)).toBe('NORMAL');
    expect(percentToAnomalyState(ANOMALY_SLOWED_SCORE)).toBe('SLOWED');
    expect(percentToAnomalyState(ANOMALY_BLOCKED_SCORE - 1)).toBe('SLOWED');
    expect(percentToAnomalyState(ANOMALY_BLOCKED_SCORE)).toBe('BLOCKED');
  });
});

describe('detection mode', () => {
  it('reads the mode from a percentage frame', () => {
    expect(parseTelemetry('Motor: Running  Speed: 30.00 Anomaly: 12% mode: imu')?.detectionMode)
      .toBe('imu');
    expect(parseTelemetry('Motor: Running  Speed: 30.00 Anomaly: 12% mode: audio')?.detectionMode)
      .toBe('audio');
  });

  it('reads the mode from a three-state frame', () => {
    expect(parseTelemetry('Motor: Running  Speed: 30.00 Anomaly: NORMAL mode: audio')?.detectionMode)
      .toBe('audio');
  });

  it('reports no mode when the frame omits the suffix', () => {
    expect(parseTelemetry('Motor: Running  Speed: 30.00 Anomaly: 12%')?.detectionMode).toBeNull();
  });

  it('treats scoring as active unless the board is on audio', () => {
    expect(isAnomalyDetectionActive('imu')).toBe(true);
    expect(isAnomalyDetectionActive('audio')).toBe(false);
    // Firmware that never names a mode only ever scores IMU.
    expect(isAnomalyDetectionActive(null)).toBe(true);
  });
});

describe('raw frame text', () => {
  it('keeps the percentage and mode exactly as received', () => {
    const line = 'Motor: Running  Speed: 29.81 Anomaly: 72% mode: audio';

    expect(parseTelemetry(line)?.raw).toBe(line);
  });

  it('keeps the raw text of a frame reassembled from chunks', () => {
    const parser = new TelemetryStreamParser();
    parser.feed('Motor: Running  Speed: 30.00 Anom');
    const frames = parser.feed('aly: 64% mode: imu\n');

    expect(frames[0].raw).toBe('Motor: Running  Speed: 30.00 Anomaly: 64% mode: imu');
  });
});

describe('TelemetryStreamParser', () => {
  it('recovers the score from notifications split mid-frame', () => {
    const parser = new TelemetryStreamParser();

    expect(parser.feed('Motor: Running  Speed: 30.')).toEqual([]);
    const frames = parser.feed('12 Anomaly: 55%\n');

    expect(frames).toHaveLength(1);
    expect(frames[0].anomalyScore).toBe(55);
    expect(frames[0].speed).toBeCloseTo(30.12);
  });

  it('handles a board that switches between the two formats', () => {
    const parser = new TelemetryStreamParser();
    const frames = [
      ...parser.feed('Motor: Running  Speed: 30.00 Anomaly: 12%\n'),
      ...parser.feed('Motor: Running  Speed: 50.00 Anomaly: SLOWED\n'),
    ];

    expect(frames.map((frame) => frame.anomalyScore)).toEqual([12, null]);
  });
});
