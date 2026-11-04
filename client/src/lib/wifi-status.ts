export type WifiDeviceStatus =
  | { state: 'down'; stored?: boolean; err?: string }
  | { state: 'joining'; ssid?: string }
  | { state: 'up'; ip: string; ssid?: string };

/**
 * Parse firmware WIFI: status lines from BLE notify / HTTP /status.
 * Examples:
 *   WIFI: DOWN
 *   WIFI: DOWN stored=1 err=0x...
 *   WIFI: JOINING ssid=MyAP
 *   WIFI: UP ip=192.168.1.10 ssid=MyAP
 */
export function parseWifiStatusLine(text: string): WifiDeviceStatus | null {
  const line = text.trim();
  if (!line.startsWith('WIFI:')) return null;

  if (/\bUP\b/.test(line)) {
    const ip = line.match(/ip=([0-9.]+)/)?.[1] ?? '';
    const ssid = line.match(/ssid=([^\s]+)/)?.[1];
    /* Require a real IPv4 — empty/0.0.0.0 is not usable for HTTP telemetry. */
    if (!ip || ip === '0.0.0.0') {
      return { state: 'joining', ssid };
    }
    return { state: 'up', ip, ssid };
  }
  if (/\bJOINING\b/.test(line) || /\bDISCONNECTING\b/.test(line)) {
    const ssid = line.match(/ssid=([^\s]+)/)?.[1];
    return { state: 'joining', ssid };
  }
  if (/\bDOWN\b/.test(line) || /\bERR\b/.test(line)) {
    return {
      state: 'down',
      stored: /stored=1/.test(line),
      err: line.match(/err=(\S+)/)?.[1] ?? (/\bERR\b/.test(line) ? line.slice(6).trim() : undefined),
    };
  }
  /* Incomplete / unrecognized WIFI: fragment — do not treat as a status reply. */
  return null;
}
