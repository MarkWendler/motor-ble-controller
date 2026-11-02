import type { DeviceTransport } from './transport/types';

/** Si917 HTTP is single-client; keep poll gentle. */
const DEFAULT_POLL_MS = 400;
const POLL_TIMEOUT_MS = 2500;
/** Tolerate brief glitches before declaring the Wi-Fi link lost. */
const MAX_POLL_FAILURES = 8;

/**
 * HTTP transport talking to the PM firmware Wi-Fi dataplane on the LAN.
 *
 *   GET  http://<ip>/telemetry  → Motor: ...
 *   GET  http://<ip>/cmd?cmd=M50
 *   GET  http://<ip>/status     → WIFI: ...
 */
export class WifiHttpTransport implements DeviceTransport {
  readonly kind = 'wifi' as const;
  readonly baseUrl: string;

  private pollTimer: number | null = null;
  private onData: ((chunk: string) => void) | null = null;
  private onDisconnect: (() => void) | null = null;
  private stopped = false;
  private failCount = 0;
  private inFlight = false;

  constructor(ip: string, port = 80) {
    this.baseUrl = `http://${ip}${port === 80 ? '' : `:${port}`}`;
  }

  static async probe(ip: string, timeoutMs = 3000): Promise<WifiHttpTransport> {
    const transport = new WifiHttpTransport(ip);
    let lastErr: unknown;

    /* HTTP may still be starting after `wifi http start` / BLE disconnect. */
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => window.setTimeout(r, 400));
      }
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const statusRes = await fetch(`${transport.baseUrl}/status`, {
          signal: ctrl.signal,
          cache: 'no-store',
        });
        if (!statusRes.ok) {
          throw new Error(`Device not reachable at ${ip} (HTTP ${statusRes.status})`);
        }
        await statusRes.text();

        const telemCtrl = new AbortController();
        const telemTimer = window.setTimeout(() => telemCtrl.abort(), timeoutMs);
        try {
          const telemRes = await fetch(`${transport.baseUrl}/telemetry`, {
            signal: telemCtrl.signal,
            cache: 'no-store',
          });
          if (!telemRes.ok) {
            throw new Error(`Device at ${ip} responded but telemetry is unavailable`);
          }
          await telemRes.text();
        } finally {
          window.clearTimeout(telemTimer);
        }

        return transport;
      } catch (err) {
        lastErr = err;
        const retryable =
          (err instanceof DOMException && err.name === 'AbortError') ||
          err instanceof TypeError ||
          (err instanceof Error && /not reachable|unavailable|Timed out/i.test(err.message));
        if (!retryable || attempt === 3) {
          break;
        }
      } finally {
        window.clearTimeout(timer);
      }
    }

    if (lastErr instanceof DOMException && lastErr.name === 'AbortError') {
      throw new Error(`Timed out reaching device at ${ip} — check same LAN / IP`);
    }
    if (lastErr instanceof TypeError) {
      throw new Error(
        `Cannot reach ${ip} on the local network (blocked or offline). Confirm the device is on Wi-Fi and this PC is on the same LAN.`
      );
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  start(onData: (chunk: string) => void, onDisconnect?: () => void, pollMs = DEFAULT_POLL_MS): void {
    this.onData = onData;
    this.onDisconnect = onDisconnect ?? null;
    this.stopped = false;
    this.failCount = 0;
    this.inFlight = false;

    const tick = async () => {
      if (this.stopped) return;
      if (this.inFlight) {
        this.pollTimer = window.setTimeout(tick, pollMs);
        return;
      }

      this.inFlight = true;
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), POLL_TIMEOUT_MS);
      try {
        const res = await fetch(`${this.baseUrl}/telemetry`, {
          signal: ctrl.signal,
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        this.failCount = 0;
        if (text) this.onData?.(text.endsWith('\n') ? text : `${text}\n`);
      } catch {
        this.failCount += 1;
        if (this.failCount >= MAX_POLL_FAILURES && !this.stopped) {
          this.stopped = true;
          this.onDisconnect?.();
          return;
        }
      } finally {
        window.clearTimeout(timer);
        this.inFlight = false;
      }

      if (!this.stopped) {
        this.pollTimer = window.setTimeout(tick, pollMs);
      }
    };
    void tick();
  }

  async send(line: string): Promise<void> {
    const cmd = line.replace(/[\r\n]+$/g, '');
    const url = `${this.baseUrl}/cmd?cmd=${encodeURIComponent(cmd)}`;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), POLL_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`Wi-Fi command failed (HTTP ${res.status})`);
      }
      const text = await res.text();
      if (text) this.onData?.(text.endsWith('\n') ? text : `${text}\n`);
    } finally {
      window.clearTimeout(timer);
    }
  }

  /** Stop polling without tearing down handlers (Wi-Fi→BLE handoff). */
  pause(): void {
    this.stopped = true;
    if (this.pollTimer !== null) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Resume polling after a failed BLE switch. */
  resume(pollMs = DEFAULT_POLL_MS): void {
    if (!this.onData) return;
    if (!this.stopped && this.pollTimer !== null) return;
    this.start(this.onData, this.onDisconnect ?? undefined, pollMs);
  }

  /**
   * Stop HTTP polling. When `leaveAp` is true, also ask the Si917 to leave the
   * AP and clear NVM credentials (`wifi disconnect`) before the link dies.
   *
   * Use leaveAp only for user Disconnect — not for Wi-Fi→BLE handoff (STA stays up).
   */
  async disconnect(options?: { leaveAp?: boolean }): Promise<void> {
    /* Stop /telemetry first — firmware HTTP is single-client. */
    this.stopped = true;
    if (this.pollTimer !== null) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    if (options?.leaveAp) {
      try {
        /*
         * Firmware queues leave + NVM clear and replies WIFI: DISCONNECTING.
         * The socket may die mid-response once the STA drops — ignore that.
         */
        await this.send('wifi disconnect');
      } catch {
        /* Expected if the AP drop closes the HTTP connection mid-flight. */
      }
    }
  }
}
