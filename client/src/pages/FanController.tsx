import { useState, useRef, useEffect, useCallback } from 'react';
import { Bluetooth, AlertCircle, CheckCircle2, Zap, Power, Wifi } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DebugConsole, type DebugMessage } from '@/components/DebugConsole';
import { BLE_PROFILES, BLE_SERVICE_UUIDS } from '@/lib/ble-profiles';
import { writeBleCharacteristicChunked } from '@/lib/ble-write';
import { TelemetryStreamParser, type MotorTelemetry, anomalyLabel } from '@/lib/telemetry-parser';
import type { TransportKind } from '@/lib/transport/types';
import { WifiHttpTransport } from '@/lib/wifi-transport';
import { parseWifiStatusLine, type WifiDeviceStatus } from '@/lib/wifi-status';
import { loadStoredWifiNetworks, saveWifiNetwork, loadStoredDeviceIps, saveDeviceIp, clearAllStoredWifi } from '@/lib/wifi-credentials';

// Web Bluetooth API type definitions
declare global {
  interface Navigator {
    bluetooth: Bluetooth;
  }
  interface Bluetooth {
    requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>;
  }
  interface RequestDeviceOptions {
    filters?: BluetoothLEScanFilter[];
    optionalServices?: (string | number)[];
  }
  interface BluetoothLEScanFilter {
    services?: (string | number)[];
  }
  interface BluetoothDevice {
    gatt?: BluetoothRemoteGATTServer;
    addEventListener(type: 'gattserverdisconnected', listener: () => void): void;
    removeEventListener(type: 'gattserverdisconnected', listener: () => void): void;
  }
  interface BluetoothRemoteGATTServer {
    connected: boolean;
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
    getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
  }
  interface BluetoothRemoteGATTService {
    getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
  }
  interface BluetoothRemoteGATTCharacteristic {
    properties?: {
      read?: boolean;
      write?: boolean;
      writeWithoutResponse?: boolean;
      notify?: boolean;
    };
    value?: DataView;
    readable?: ReadableStream<Uint8Array>;
    startNotifications(): Promise<void>;
    stopNotifications(): Promise<void>;
    writeValue(value: BufferSource): Promise<void>;
    writeValueWithoutResponse?(value: BufferSource): Promise<void>;
    addEventListener(type: string, listener: EventListener): void;
  }
}

type MotorMode = 'stop' | 'default' | 'fast' | 'custom';

/** Firmware accepts motor speed refs in -300..300 rad/s (legacy BLE: M<n>, M0 = stop; negative = reverse). */
const MOTOR_SPEED_MIN_RAD_S = -300;
const MOTOR_SPEED_MAX_RAD_S = 300;

/** How long transient error banners stay visible before auto-dismiss. */
const ERROR_DISMISS_MS = 5000;

/**
 * FanController Component
 *
 * Web Bluetooth SPP interface for Silicon Labs SiWG917 motor control demo
 * Demonstrates integration of:
 * - Bluetooth Connectivity (Web Bluetooth SPP)
 * - Motor Control (speed reference commands)
 * - Anomaly Detection (AI/ML edge processing)
 */
export default function FanController() {
  const [connected, setConnected] = useState(false);
  const [transport, setTransport] = useState<TransportKind>('ble');
  /** null = not probed yet; false = old FW or Wi-Fi compiled out */
  const [wifiSupported, setWifiSupported] = useState<boolean | null>(null);
  /** Device Wi-Fi STA still associated (may remain up while UI uses BLE). */
  const [deviceWifiUp, setDeviceWifiUp] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [wifiDialogOpen, setWifiDialogOpen] = useState(false);
  /** direct = connect to device already on LAN; provision = BLE-mediated join */
  const [wifiDialogMode, setWifiDialogMode] = useState<'direct' | 'provision'>('direct');
  const [wifiIp, setWifiIp] = useState(() => loadStoredDeviceIps()[0] ?? '');
  const [storedDeviceIps, setStoredDeviceIps] = useState(() => loadStoredDeviceIps());
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [wifiUseStored, setWifiUseStored] = useState(true);
  const [storedNetworks, setStoredNetworks] = useState(() => loadStoredWifiNetworks());
  const [currentMode, setCurrentMode] = useState<MotorMode>('stop');
  const [motorState, setMotorState] = useState<MotorTelemetry>({
    status: 'Stop',
    speed: 0,
    rpm: 0,
    anomaly: 'NORMAL',
    timestamp: Date.now(),
  });
  const [connectionStatus, setConnectionStatus] = useState<string>('Disconnected');
  const [error, setError] = useState<string | null>(null);
  const [customSpeedInput, setCustomSpeedInput] = useState('100');
  const [debugMessages, setDebugMessages] = useState<DebugMessage[]>([]);
  /** True after at least one full telemetry frame arrived over BLE notifications. */
  const [telemetryLive, setTelemetryLive] = useState(false);

  const characteristicRef = useRef<any>(null);
  const deviceRef = useRef<BluetoothDevice | null>(null);
  const wifiTransportRef = useRef<WifiHttpTransport | null>(null);
  const transportRef = useRef<TransportKind>('ble');
  const telemetryParserRef = useRef<TelemetryStreamParser>(new TelemetryStreamParser());
  const debugMessageIdRef = useRef(0);
  const errorDismissTimerRef = useRef<number | null>(null);
  /** True while the user (or UI) is intentionally tearing down the link. */
  const intentionalDisconnectRef = useRef(false);
  const wifiStatusWaiterRef = useRef<{
    resolve: (line: string) => void;
    reject: (err: Error) => void;
    timer: number;
  } | null>(null);
  /** Assemble BLE notify fragments into complete lines before WIFI: parsing. */
  const bleRxLineBufRef = useRef('');

  useEffect(() => {
    transportRef.current = transport;
  }, [transport]);

  const clearError = useCallback(() => {
    if (errorDismissTimerRef.current !== null) {
      window.clearTimeout(errorDismissTimerRef.current);
      errorDismissTimerRef.current = null;
    }
    setError(null);
  }, []);

  const showError = useCallback((message: string, durationMs: number = ERROR_DISMISS_MS) => {
    if (errorDismissTimerRef.current !== null) {
      window.clearTimeout(errorDismissTimerRef.current);
    }
    setError(message);
    errorDismissTimerRef.current = window.setTimeout(() => {
      errorDismissTimerRef.current = null;
      clearError();
    }, durationMs);
  }, []);

  useEffect(() => {
    return () => {
      if (errorDismissTimerRef.current !== null) {
        window.clearTimeout(errorDismissTimerRef.current);
      }
    };
  }, []);
  /** Stable listener refs so handlers always see the latest logic. */
  const onGattDisconnectedRef = useRef<() => void>(() => {});
  const onCharacteristicChangeRef = useRef<(event: Event) => void>(() => {});
  const gattDisconnectedListener = useRef(() => {
    onGattDisconnectedRef.current();
  }).current;
  const characteristicChangeListener = useRef((event: Event) => {
    onCharacteristicChangeRef.current(event);
  }).current;

  /**
   * Add a message to the debug console
   */
  const addDebugMessage = (type: 'sent' | 'received', data: string, raw?: Uint8Array) => {
    const message: DebugMessage = {
      id: `msg-${debugMessageIdRef.current++}`,
      timestamp: Date.now(),
      type,
      data,
      raw,
    };
    setDebugMessages((prev) => [...prev.slice(-99), message]); // Keep last 100 messages
  };

  /**
   * Clear debug messages
   */
  const clearDebugMessages = () => {
    setDebugMessages([]);
    debugMessageIdRef.current = 0;
  };

  /**
   * Resolve the PM firmware GATT service.
   * Probe only the UUID that exists on the device — a missing UUID stalls BlueZ ~30s.
   */
  const resolveBleProfile = async (server: BluetoothRemoteGATTServer) => {
    const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          reject(new Error(`${label} timed out after ${ms}ms`));
        }, ms);
        promise.then(
          (value) => {
            window.clearTimeout(timer);
            resolve(value);
          },
          (err) => {
            window.clearTimeout(timer);
            reject(err);
          }
        );
      });

    const profile = BLE_PROFILES[0];
    setConnectionStatus('Discovering services…');
    const service = await withTimeout(
      server.getPrimaryService(profile.serviceUuid),
      5000,
      'SPP service'
    );
    const characteristic = await withTimeout(
      service.getCharacteristic(profile.characteristicUuid),
      5000,
      'SPP characteristic'
    );
    return { profile, characteristic };
  };

  /**
   * Reset UI / refs after the BLE link is gone.
   */
  const clearConnectionState = () => {
    deviceRef.current = null;
    characteristicRef.current = null;
    void wifiTransportRef.current?.disconnect();
    wifiTransportRef.current = null;
    telemetryParserRef.current.reset();
    bleRxLineBufRef.current = '';
    setConnected(false);
    setTransport('ble');
    setWifiSupported(null);
    setDeviceWifiUp(false);
    setConnectionStatus('Disconnected');
    setCurrentMode('stop');
    setTelemetryLive(false);
    setMotorState({
      status: 'Stop',
      speed: 0,
      rpm: 0,
      anomaly: 'NORMAL',
      timestamp: Date.now(),
    });
  };

  /**
   * Handle unexpected GATT disconnect (device out of range, firmware reset, etc.)
   */
  const handleGattDisconnected = () => {
    if (transportRef.current === 'wifi') {
      /* BLE dropped after a successful Wi-Fi switch — expected. */
      deviceRef.current = null;
      characteristicRef.current = null;
      return;
    }
    const wasIntentional = intentionalDisconnectRef.current;
    intentionalDisconnectRef.current = false;
    clearConnectionState();
    if (!wasIntentional) {
      showError('BLE connection lost. Reconnect to continue.');
    }
  };
  onGattDisconnectedRef.current = handleGattDisconnected;

  /**
   * Connect to Bluetooth device via Web Bluetooth API.
   * @returns true when GATT + notifications are ready.
   */
  const connectBluetooth = async (opts?: { fromWifi?: boolean }): Promise<boolean> => {
    const fromWifi = opts?.fromWifi === true;
    const keepWifiOnFailure = fromWifi || (transportRef.current === 'wifi' && wifiTransportRef.current != null);
    try {
      clearError();
      intentionalDisconnectRef.current = false;
      setConnectionStatus('Scanning...');

      // Discover devices advertising the PM SPP service (current or legacy adv UUID)
      const device = await navigator.bluetooth.requestDevice({
        filters: BLE_SERVICE_UUIDS.map((uuid) => ({ services: [uuid] })),
        optionalServices: BLE_SERVICE_UUIDS,
      });

      setConnectionStatus('Connecting...');

      // Connect to GATT server and detect which profile the device uses
      const server = await device.gatt!.connect();
      /*
       * Longer settle when Wi-Fi HTTP was just active — coex needs time before
       * CCCD / startNotifications or the link hits supervision timeout (0x4e08).
       */
      await new Promise((resolve) => window.setTimeout(resolve, fromWifi ? 400 : 50));
      const { characteristic } = await resolveBleProfile(server);

      deviceRef.current = device;
      device.addEventListener('gattserverdisconnected', gattDisconnectedListener);

      characteristicRef.current = characteristic;
      telemetryParserRef.current.reset();
      bleRxLineBufRef.current = '';
      setTelemetryLive(false);

      // Register before enabling CCCD so the immediate firmware snapshot is not missed.
      setConnectionStatus('Enabling notifications…');
      characteristic.addEventListener('characteristicvaluechanged', characteristicChangeListener);

      const enableNotify = async () => {
        const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
          new Promise<T>((resolve, reject) => {
            const timer = window.setTimeout(() => reject(new Error('startNotifications timed out')), ms);
            promise.then(
              (v) => {
                window.clearTimeout(timer);
                resolve(v);
              },
              (e) => {
                window.clearTimeout(timer);
                reject(e);
              }
            );
          });
        await withTimeout(characteristic.startNotifications(), fromWifi ? 8000 : 5000);
      };

      try {
        await enableNotify();
      } catch (firstErr) {
        if (!fromWifi) throw firstErr;
        /* One retry after coex settle — CCCD often fails on the first try over Wi-Fi. */
        await new Promise((r) => window.setTimeout(r, 300));
        await enableNotify();
      }

      /* Sync ref immediately — React setState is async and switchToBle checks the ref. */
      transportRef.current = 'ble';
      setConnected(true);
      setTransport('ble');
      setConnectionStatus('Connected via BLE');
      setCurrentMode('stop');
      setMotorState({
        status: 'Stop',
        speed: 0,
        rpm: 0,
        anomaly: 'NORMAL',
        timestamp: Date.now(),
      });
      if (fromWifi) {
        setWifiSupported(true);
      } else {
        /*
         * Defer capability probe until after CCCD settle. Immediate wifi status
         * ATT traffic right after connect correlates with coex disconnects.
         * Unknown command => Wi-Fi compiled out / old FW.
         */
        void (async () => {
          await new Promise((r) => window.setTimeout(r, 2000));
          if (!deviceRef.current?.gatt?.connected || transportRef.current !== 'ble') {
            return;
          }
          try {
            await queryWifiStatusOverBle(4000);
            if (deviceRef.current?.gatt?.connected && transportRef.current === 'ble') {
              setWifiSupported(true);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : '';
            if (
              msg === 'WIFI_UNSUPPORTED' ||
              /unknown command|does not support Wi-Fi/i.test(msg)
            ) {
              if (deviceRef.current?.gatt?.connected && transportRef.current === 'ble') {
                setWifiSupported(false);
              }
            }
            /* Timeout / link drop — leave wifiSupported as-is. */
          }
        })();
      }
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Connection failed';
      showError(errorMsg);
      /* Tear down a half-open GATT so the next attempt is clean. */
      try {
        const d = deviceRef.current;
        if (d?.gatt?.connected) {
          intentionalDisconnectRef.current = true;
          d.gatt.disconnect();
        }
      } catch {
        /* ignore */
      }
      deviceRef.current = null;
      characteristicRef.current = null;
      window.setTimeout(() => {
        intentionalDisconnectRef.current = false;
      }, 300);

      if (keepWifiOnFailure) {
        setConnectionStatus(
          wifiTransportRef.current
            ? `Connected via Wi-Fi (${wifiIp || 'LAN'})`
            : 'Connected via Wi-Fi'
        );
        setTransport('wifi');
        transportRef.current = 'wifi';
        setConnected(true);
      } else {
        setConnectionStatus('Disconnected');
        setConnected(false);
      }
      return false;
    }
  };

  /**
   * Apply parsed telemetry from BLE notifications to the Real-Time Telemetry panel.
   */
  const applyTelemetry = (telemetry: MotorTelemetry) => {
    setTelemetryLive(true);
    setMotorState(telemetry);

    const absSpeed = Math.abs(telemetry.speed);
    if (telemetry.status === 'Stop' || absSpeed < 1) {
      setCurrentMode('stop');
    } else if (Math.abs(absSpeed - 100) <= 5) {
      setCurrentMode('default');
    } else if (Math.abs(absSpeed - 250) <= 5) {
      setCurrentMode('fast');
    } else {
      setCurrentMode('custom');
    }
  };

  /**
   * Handle characteristic value changes (notifications).
   * Apply telemetry before debug logging so the panel updates first.
   */
  const ingestTransportText = (text: string) => {
    /* BLE SPP notifies are ~20-byte chunks — reassemble lines before WIFI: parse. */
    const combined = bleRxLineBufRef.current + text;
    const parts = combined.split(/\r?\n/);
    bleRxLineBufRef.current = parts.pop() ?? '';

    for (const rawLine of parts) {
      const line = rawLine.trim();
      if (!line) continue;

      const wifiStatus = parseWifiStatusLine(line);
      if (wifiStatus && wifiStatusWaiterRef.current) {
        wifiStatusWaiterRef.current.resolve(line);
        window.clearTimeout(wifiStatusWaiterRef.current.timer);
        wifiStatusWaiterRef.current = null;
        continue;
      }

      if (
        wifiStatusWaiterRef.current &&
        (/unknown command/i.test(line) || /^ble:\s*unknown/i.test(line))
      ) {
        const waiter = wifiStatusWaiterRef.current;
        wifiStatusWaiterRef.current = null;
        window.clearTimeout(waiter.timer);
        waiter.reject(new Error('WIFI_UNSUPPORTED'));
      }
    }

    const bytes = new TextEncoder().encode(text);
    const telemetryFrames = telemetryParserRef.current.feed(bytes);
    for (const telemetry of telemetryFrames) {
      applyTelemetry(telemetry);
    }
    if (telemetryFrames.length > 0) {
      for (const telemetry of telemetryFrames) {
        addDebugMessage(
          'received',
          `Motor: ${telemetry.status}  Speed: ${telemetry.speed.toFixed(2)} Anomaly: ${telemetry.anomaly}`
        );
      }
    } else if (text.trim() && !/Motor:/i.test(text)) {
      addDebugMessage('received', text.trim());
    }
  };
  const ingestTransportTextRef = useRef(ingestTransportText);
  ingestTransportTextRef.current = ingestTransportText;

  const handleCharacteristicChange = (event: Event) => {
    if (intentionalDisconnectRef.current) {
      return;
    }
    const characteristic = event.target as any;
    const value = characteristic.value as DataView | undefined;
    if (value) {
      // DataView may share a larger ArrayBuffer — slice the exact GATT payload.
      const rawData = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const dataStr = new TextDecoder().decode(rawData);
      ingestTransportTextRef.current(dataStr);
    }
  };
  onCharacteristicChangeRef.current = handleCharacteristicChange;

  const sendBleRaw = async (command: string) => {
    if (!characteristicRef.current) {
      throw new Error('BLE characteristic not ready');
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(command + '\n');
    addDebugMessage('sent', command);
    /* Chunk to ≤20 bytes — long wifi connect lines exceed default ATT MTU. */
    await writeBleCharacteristicChunked(characteristicRef.current, data);
  };

  const waitForWifiStatus = (timeoutMs = 8000): Promise<string> =>
    new Promise((resolve, reject) => {
      if (wifiStatusWaiterRef.current) {
        window.clearTimeout(wifiStatusWaiterRef.current.timer);
        wifiStatusWaiterRef.current.reject(new Error('Wi-Fi status wait superseded'));
      }
      const timer = window.setTimeout(() => {
        wifiStatusWaiterRef.current = null;
        reject(new Error('Timed out waiting for WIFI: status'));
      }, timeoutMs);
      wifiStatusWaiterRef.current = { resolve, reject, timer };
    });

  const queryWifiStatusOverBle = async (timeoutMs = 8000): Promise<WifiDeviceStatus> => {
    const wait = waitForWifiStatus(timeoutMs);
    await sendBleRaw('wifi status');
    const line = await wait;
    const status = parseWifiStatusLine(line);
    if (!status) {
      throw new Error(`Unexpected Wi-Fi status: ${line}`);
    }
    return status;
  };

  /** Wait for a WIFI: notify (JOINING/UP/DOWN) without sending wifi status. */
  const waitForWifiNotify = (timeoutMs = 15000): Promise<WifiDeviceStatus> =>
    waitForWifiStatus(timeoutMs).then((line) => {
      const status = parseWifiStatusLine(line);
      if (!status) {
        throw new Error(`Unexpected Wi-Fi reply: ${line}`);
      }
      return status;
    });

  /**
   * After wifi connect: use the immediate JOINING/UP notify, then at most 3
   * spaced status checks (no tight poll — that interrupts join on the 917).
   */
  const waitUntilWifiUp = async (
    firstNotify?: Promise<WifiDeviceStatus>
  ): Promise<WifiDeviceStatus> => {
    try {
      const first = await (firstNotify ?? waitForWifiNotify(12000));
      if (first.state === 'up') return first;
      if (first.state === 'down' && first.err) {
        throw new Error(`Wi-Fi join failed (${first.err}). Stay on BLE.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/Timed out waiting for WIFI/i.test(msg)) throw err;
    }

    for (let i = 0; i < 3; i++) {
      await new Promise((r) => window.setTimeout(r, 4000));
      try {
        const status = await queryWifiStatusOverBle(5000);
        if (status.state === 'up') return status;
        if (status.state === 'down' && status.err) {
          throw new Error(`Wi-Fi join failed (${status.err}). Stay on BLE.`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/Timed out waiting for WIFI/i.test(msg) && !/superseded/i.test(msg)) {
          throw err;
        }
      }
    }
    throw new Error(
      'Device Wi-Fi did not come up in time. Stay on BLE, check SSID/password, or retry.'
    );
  };

  /**
   * Send command to motor control board (active transport).
   */
  const sendCommand = async (command: string) => {
    if (!connected) {
      showError('Not connected to device');
      return;
    }

    try {
      if (transportRef.current === 'wifi' && wifiTransportRef.current) {
        addDebugMessage('sent', command);
        await wifiTransportRef.current.send(command);
        return;
      }
      await sendBleRaw(command);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to send command';
      showError(errorMsg);
      if (errorMsg.includes('disconnected') || errorMsg.includes('GATT')) {
        setConnected(false);
        setConnectionStatus('Disconnected');
        characteristicRef.current = null;
      }
    }
  };

  const dropBleOnly = () => {
    const device = deviceRef.current;
    const characteristic = characteristicRef.current;
    intentionalDisconnectRef.current = true;
    if (characteristic) {
      try {
        characteristic.removeEventListener('characteristicvaluechanged', characteristicChangeListener);
      } catch {
        /* ignore */
      }
    }
    try {
      if (device) {
        device.removeEventListener('gattserverdisconnected', gattDisconnectedListener);
      }
      if (device?.gatt?.connected) {
        device.gatt.disconnect();
      }
    } catch {
      /* ignore */
    }
    deviceRef.current = null;
    characteristicRef.current = null;
    window.setTimeout(() => {
      intentionalDisconnectRef.current = false;
    }, 500);
  };

  const attachWifiTransport = async (ip: string) => {
    const wifi = await WifiHttpTransport.probe(ip);
    telemetryParserRef.current.reset();
    bleRxLineBufRef.current = '';
    setTelemetryLive(false);
    wifi.start(
      (chunk) => ingestTransportTextRef.current(chunk),
      () => {
        if (transportRef.current === 'wifi') {
          showError('Wi-Fi link lost. Reconnect over BLE or Wi-Fi.');
          clearConnectionState();
        }
      }
    );
    wifiTransportRef.current = wifi;
    /* Single active UI dataplane: Wi-Fi HTTP only from here. */
    transportRef.current = 'wifi';
    saveDeviceIp(ip);
    setStoredDeviceIps(loadStoredDeviceIps());
    setWifiIp(ip);
    setTransport('wifi');
    setDeviceWifiUp(true);
    setWifiSupported(true);
    setConnected(true);
    setConnectionStatus(`Connected via Wi-Fi (${ip})`);
  };

  /**
   * Connect directly over Wi-Fi when the device is already on the LAN (no BLE required).
   */
  const connectWifiDirect = async (ipOverride?: string) => {
    const ip = (ipOverride ?? wifiIp).trim();
    if (!ip) {
      showError('Enter the device IP address on the local network.');
      return;
    }

    setSwitching(true);
    clearError();
    setConnectionStatus(`Looking for device at ${ip}…`);
    try {
      await attachWifiTransport(ip);
      /* Direct Wi-Fi connect: drop any leftover BLE so only HTTP is active. */
      if (deviceRef.current) {
        dropBleOnly();
      }
      setWifiDialogOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Wi-Fi connect failed';
      showError(msg, 8000);
      setConnectionStatus('Disconnected');
      setConnected(false);
    } finally {
      setSwitching(false);
    }
  };

  const openWifiDirectDialog = () => {
    setWifiDialogMode('direct');
    setStoredDeviceIps(loadStoredDeviceIps());
    setWifiIp(loadStoredDeviceIps()[0] ?? wifiIp);
    setWifiDialogOpen(true);
  };

  const openWifiProvisionDialog = () => {
    setWifiDialogMode('provision');
    setStoredNetworks(loadStoredWifiNetworks());
    setWifiUseStored(loadStoredWifiNetworks().length > 0);
    setWifiDialogOpen(true);

    /*
     * If the Si917 reports no NVM credentials, drop stale browser cache so
     * "Use stored network (…)" does not appear when the device has none.
     */
    if (transportRef.current === 'ble' && characteristicRef.current) {
      void (async () => {
        try {
          const status = await queryWifiStatusOverBle(4000);
          if (status.state === 'down' && !status.stored) {
            clearHostWifiCache();
          }
        } catch {
          /* Ignore — dialog still usable with manual SSID entry. */
        }
      })();
    }
  };

  const switchToWifi = async (opts?: { ssid?: string; password?: string; useStored?: boolean }) => {
    if (!connected || transportRef.current !== 'ble' || !characteristicRef.current) {
      /* Not on BLE — offer direct LAN connect instead of requiring BLE first. */
      openWifiDirectDialog();
      return;
    }
    setSwitching(true);
    clearError();
    try {
      const useStored = opts?.useStored ?? false;
      const ssid = opts?.ssid?.trim() ?? '';
      const targetSsid = useStored
        ? (loadStoredWifiNetworks()[0]?.ssid?.trim() ?? '')
        : ssid;
      const hasProvision = useStored || ssid.length > 0;
      let status: WifiDeviceStatus | null = null;

      /* Always check current link first — avoid bounce if already on the same AP. */
      setConnectionStatus('Checking device Wi-Fi…');
      try {
        status = await queryWifiStatusOverBle(6000);
      } catch {
        status = null;
      }

      const sameApAlreadyUp =
        status?.state === 'up' &&
        Boolean(status.ip) &&
        (targetSsid.length === 0
          ? !hasProvision /* no new creds — just use current link */
          : Boolean(status.ssid && status.ssid.toLowerCase() === targetSsid.toLowerCase()));

      if (sameApAlreadyUp && status?.state === 'up') {
        setConnectionStatus(`Already on Wi-Fi (${status.ssid ?? status.ip})…`);
      } else if (hasProvision) {
        setConnectionStatus('Joining Wi-Fi…');
        const joiningWait = waitForWifiNotify(12000);
        if (useStored) {
          await sendBleRaw('wifi connect');
        } else {
          const psk = opts?.password ?? '';
          await sendBleRaw(`wifi connect ${ssid} ${psk}`);
          saveWifiNetwork({ ssid, password: opts?.password });
          setStoredNetworks(loadStoredWifiNetworks());
        }
        status = await waitUntilWifiUp(joiningWait);
      } else if (status?.state !== 'up') {
        setWifiDialogOpen(true);
        setSwitching(false);
        setConnectionStatus('Connected via BLE');
        return;
      }

      if (!status || status.state !== 'up' || !status.ip) {
        throw new Error(
          'Device Wi-Fi is not on the same network (no IP). Stay on BLE, or enter credentials for a LAN the UI can reach.'
        );
      }

      /*
       * BLE UI keeps device HTTP stopped for coex. Bring HTTP up before probe,
       * then drop BLE so only one UI dataplane is active.
       */
      setConnectionStatus(`Starting Wi-Fi HTTP at ${status.ip}…`);
      try {
        await sendBleRaw('wifi http start');
      } catch {
        /* older firmware — probe may still work if HTTP stayed up */
      }
      await new Promise((r) => window.setTimeout(r, 500));

      setConnectionStatus(`Opening Wi-Fi at ${status.ip}…`);
      await attachWifiTransport(status.ip);
      /* Wi-Fi UI active — disconnect BLE (ADV only on device; no dual telemetry). */
      dropBleOnly();
      setWifiDialogOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Wi-Fi switch failed';
      if (msg === 'WIFI_UNSUPPORTED' || /unknown command|does not support Wi-Fi/i.test(msg)) {
        setWifiSupported(false);
      } else {
        showError(msg, 8000);
      }
      setConnectionStatus('Connected via BLE');
      setTransport('ble');
      transportRef.current = 'ble';
    } finally {
      setSwitching(false);
    }
  };

  const switchToBle = async () => {
    if (!connected || transportRef.current !== 'wifi') {
      return;
    }
    setSwitching(true);
    clearError();
    const wifi = wifiTransportRef.current;
    try {
      setConnectionStatus('Pausing Wi-Fi poll for BLE…');
      /*
       * Continuous /telemetry HTTP shares the NWP with BLE. Leave it running
       * and CCCD/startNotifications often never completes → 0x4e08 timeout.
       */
      wifi?.pause();
      await new Promise((r) => window.setTimeout(r, 250));

      setConnectionStatus('Reconnecting BLE…');
      /* Keep device Wi-Fi associated — only move UI telemetry to BLE. */
      const ok = await connectBluetooth({ fromWifi: true });
      if (!ok || !characteristicRef.current || !deviceRef.current?.gatt?.connected) {
        throw new Error('BLE not confirmed');
      }
      wifiTransportRef.current = null;
      await wifi?.disconnect();
      transportRef.current = 'ble';
      setTransport('ble');
      setDeviceWifiUp(true);
      setConnectionStatus('Connected via BLE (Wi-Fi still up on device)');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'BLE switch failed';
      showError(`${msg}. Keeping Wi-Fi.`, 8000);
      /* Resume HTTP telemetry if BLE handoff failed. */
      if (wifi && wifiTransportRef.current === wifi) {
        wifi.resume();
      } else if (wifi) {
        wifiTransportRef.current = wifi;
        wifi.resume();
      }
      transportRef.current = 'wifi';
      setTransport('wifi');
      setDeviceWifiUp(true);
      setConnected(true);
      setConnectionStatus(
        wifiTransportRef.current
          ? `Connected via Wi-Fi (${wifiIp || 'LAN'})`
          : 'Connected via Wi-Fi'
      );
    } finally {
      setSwitching(false);
    }
  };

  /**
   * Control motor mode — sends the command only.
   * Real-Time Telemetry is updated solely from BLE notifications after connect.
   */
  const setMotorMode = async (mode: Exclude<MotorMode, 'custom'>) => {
    let command = '';

    switch (mode) {
      case 'stop':
        command = 'M0';
        break;
      case 'default':
        command = 'M100';
        break;
      case 'fast':
        command = 'M250';
        break;
    }

    // Highlight the pressed control; telemetry panel follows device notify stream.
    setCurrentMode(mode);
    clearError();
    await sendCommand(command);
  };

  /**
   * Set an arbitrary speed reference (rad/s) via legacy BLE M<n> (speed + start).
   * Firmware range: -300..300 rad/s (M0 stops, M<n> sets speed + start; negative = reverse).
   */
  const setCustomSpeed = async () => {
    const speed = Number.parseInt(customSpeedInput.trim(), 10);
    if (
      !Number.isFinite(speed)
      || speed < MOTOR_SPEED_MIN_RAD_S
      || speed > MOTOR_SPEED_MAX_RAD_S
    ) {
      showError(
        `Enter a speed between ${MOTOR_SPEED_MIN_RAD_S} and ${MOTOR_SPEED_MAX_RAD_S} rad/s`
      );
      return;
    }

    clearError();
    setCurrentMode(speed === 0 ? 'stop' : 'custom');
    await sendCommand(`M${speed}`);
  };

  /** Drop browser-cached SSIDs/IPs so the Switch-to-Wi-Fi dialog stays in sync with device NVM. */
  const clearHostWifiCache = () => {
    clearAllStoredWifi();
    setStoredNetworks([]);
    setStoredDeviceIps([]);
    setWifiIp('');
    setWifiSsid('');
    setWifiPassword('');
    setWifiUseStored(false);
  };

  /**
   * User Disconnect:
   * - Wi-Fi UI: leave AP + clear device NVM + clear browser Wi-Fi cache, then tear down HTTP.
   * - BLE UI: drop GATT only — do not touch Si917 Wi-Fi / NVM / host credential cache.
   */
  const disconnectBluetooth = () => {
    const device = deviceRef.current;
    const characteristic = characteristicRef.current;
    const wifi = wifiTransportRef.current;
    const onWifi = transportRef.current === 'wifi' && wifi != null;

    if (!device && !wifi && !connected) {
      clearConnectionState();
      return;
    }

    clearError();
    intentionalDisconnectRef.current = true;

    // Update UI immediately — do not wait on stopNotifications (can hang on Linux).
    setConnected(false);
    setConnectionStatus('Disconnected');
    setWifiDialogOpen(false);

    if (onWifi) {
      /* Wi-Fi Disconnect: leave AP, clear NVM, forget browser-cached credentials. */
      clearHostWifiCache();
      void (async () => {
        try {
          await wifi.disconnect({ leaveAp: true });
        } finally {
          wifiTransportRef.current = null;
          intentionalDisconnectRef.current = true;
          clearConnectionState();
          window.setTimeout(() => {
            intentionalDisconnectRef.current = false;
          }, 500);
        }
      })();
      return;
    }

    /* BLE Disconnect: tear down GATT only — Si917 STA / NVM stay as-is. */
    void wifi?.disconnect(); /* stop poll only if a stale wifi ref exists */
    wifiTransportRef.current = null;

    if (characteristic) {
      try {
        characteristic.removeEventListener(
          'characteristicvaluechanged',
          characteristicChangeListener
        );
      } catch {
        // Ignore.
      }
    }

    try {
      if (device) {
        device.removeEventListener('gattserverdisconnected', gattDisconnectedListener);
      }
      if (device?.gatt?.connected) {
        device.gatt.disconnect();
      }
    } catch (err) {
      console.error('Disconnect error:', err);
    } finally {
      intentionalDisconnectRef.current = true;
      clearConnectionState();
      window.setTimeout(() => {
        intentionalDisconnectRef.current = false;
      }, 500);
    }
  };

  const bluetoothSupported = 'bluetooth' in navigator;
  const wifiUiEnabled = wifiSupported !== false;
  const bleLinkActive = connected && transport === 'ble';
  const wifiLinkActive = wifiUiEnabled && connected && (transport === 'wifi' || deviceWifiUp);
  const bleIconClass = bleLinkActive ? 'text-green-600' : 'text-muted-foreground/40';
  const wifiIconClass = wifiLinkActive ? 'text-green-600' : 'text-muted-foreground/40';
  const telemetrySource = transport === 'wifi' ? 'Wi-Fi' : 'BLE';

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary to-background">
      {/* Header with Silicon Labs Branding */}
      <header className="border-b border-border bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-primary">
                Motor BLE Controller
              </h1>
              <p className="text-xs text-muted-foreground">Motor Control Demo</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${connected ? 'bg-green-50' : 'bg-red-50'}`}>
              <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-sm font-medium text-foreground">
                {connectionStatus}
              </span>
              <Bluetooth className={`w-4 h-4 ${bleIconClass}`} />
              {wifiUiEnabled && <Wifi className={`w-4 h-4 ${wifiIconClass}`} />}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-12">
        {!bluetoothSupported && !connected && wifiUiEnabled && (
          <div className="max-w-2xl mx-auto mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
            Web Bluetooth is not available in this browser — you can still connect over{' '}
            <strong>Wi-Fi</strong> if the device is already on the same LAN.
          </div>
        )}
        {connected && wifiSupported === false && (
          <div className="max-w-4xl mx-auto mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-950">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
              <p>
                Wi-Fi is disabled on this device (or this firmware was built without Wi-Fi). BLE motor
                control still works.
              </p>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-8">
            {/* Left: Technology Stack */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-xl p-6 shadow-sm border border-border">
                <h2 className="text-lg font-bold text-primary mb-4">Technology Stack</h2>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <Bluetooth className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Bluetooth Connectivity</p>
                      <p className="text-xs text-muted-foreground">Web Bluetooth SPP</p>
                    </div>
                  </div>
                  {wifiSupported === false ? (
                    <div className="flex items-start gap-3 opacity-70">
                      <Wifi className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-foreground">Wi-Fi Connectivity</p>
                        <p className="text-xs text-muted-foreground">
                          Not available on this firmware
                        </p>
                      </div>
                    </div>
                  ) : (
                    wifiUiEnabled && (
                      <div className="flex items-start gap-3">
                        <Wifi className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-foreground">Wi-Fi Connectivity</p>
                          <p className="text-xs text-muted-foreground">Same-LAN HTTP dataplane</p>
                        </div>
                      </div>
                    )
                  )}
                  <div className="flex items-start gap-3">
                    <Zap className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Motor Control</p>
                      <p className="text-xs text-muted-foreground">PWM Speed Regulation</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Anomaly Detection Active Sign</p>
                      <p className="text-xs text-muted-foreground">AI/ML Edge Processing</p>
                    </div>
                  </div>
                </div>

                {/* Connection — BLE and Wi-Fi both available from the start */}
                <div className="mt-6 pt-6 border-t border-border space-y-3">
                  {!connected ? (
                    <>
                      <Button
                        onClick={connectBluetooth}
                        disabled={!bluetoothSupported || switching}
                        className="w-full tech-button bg-accent hover:bg-accent/90 text-accent-foreground"
                      >
                        <Bluetooth className="w-4 h-4 mr-2" />
                        Connect over BLE
                      </Button>
                      {wifiUiEnabled && (
                        <>
                          <Button
                            onClick={openWifiDirectDialog}
                            disabled={switching}
                            variant="outline"
                            className="w-full tech-button"
                          >
                            <Wifi className="w-4 h-4 mr-2" />
                            Connect over Wi-Fi
                          </Button>
                          <p className="text-xs text-muted-foreground">
                            Use Wi-Fi if the device is already joined to your LAN (enter its IP).
                          </p>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="flex rounded-lg border border-border overflow-hidden">
                        <button
                          type="button"
                          disabled={switching || transport === 'ble'}
                          onClick={() => void switchToBle()}
                          className={`flex-1 px-3 py-2 text-sm font-medium ${
                            transport === 'ble' ? 'bg-primary text-primary-foreground' : 'bg-white text-foreground hover:bg-secondary'
                          } disabled:opacity-60`}
                        >
                          <Bluetooth className="w-3.5 h-3.5 inline mr-1" />
                          BLE
                        </button>
                        {wifiUiEnabled && (
                          <button
                            type="button"
                            disabled={switching || transport === 'wifi'}
                            onClick={() => {
                              if (transport === 'ble') {
                                openWifiProvisionDialog();
                              } else {
                                openWifiDirectDialog();
                              }
                            }}
                            className={`flex-1 px-3 py-2 text-sm font-medium border-l border-border ${
                              transport === 'wifi' ? 'bg-primary text-primary-foreground' : 'bg-white text-foreground hover:bg-secondary'
                            } disabled:opacity-60`}
                          >
                            <Wifi className="w-3.5 h-3.5 inline mr-1" />
                            Wi-Fi
                          </button>
                        )}
                      </div>
                      {wifiUiEnabled && transport === 'ble' && (
                        <Button
                          variant="outline"
                          className="w-full"
                          disabled={switching}
                          onClick={openWifiProvisionDialog}
                        >
                          Configure / switch to Wi-Fi…
                        </Button>
                      )}
                      <Button
                        onClick={disconnectBluetooth}
                        variant="outline"
                        className="w-full tech-button"
                        disabled={switching}
                      >
                        Disconnect
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Center: Control Panel */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-xl p-8 shadow-sm border border-border">
                <h2 className="text-lg font-bold text-primary mb-8 text-center">Fan Control</h2>

                <div className="space-y-4">
                  {/* Stop Button */}
                  <button
                    onClick={() => setMotorMode('stop')}
                    disabled={!connected}
                    className={`w-full tech-button py-4 rounded-xl font-semibold transition-all ${
                      currentMode === 'stop'
                        ? 'bg-gray-500 text-white shadow-lg'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <span className="text-lg">⏹</span> Stop
                  </button>

                  {/* Default Speed Button */}
                  <button
                    onClick={() => setMotorMode('default')}
                    disabled={!connected}
                    className={`w-full tech-button py-4 rounded-xl font-semibold transition-all ${
                      currentMode === 'default'
                        ? 'bg-green-500 text-green-foreground shadow-lg'
                        : 'bg-green-100 text-green-700 hover:bg-green-200'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <span className="text-lg">🌀</span> Default (100 rad/s)
                  </button>

                  {/* Fast Speed Button */}
                  <button
                    onClick={() => setMotorMode('fast')}
                    disabled={!connected}
                    className={`w-full tech-button py-4 rounded-xl font-semibold transition-all ${
                      currentMode === 'fast'
                        ? 'bg-accent text-accent-foreground shadow-lg'
                        : 'bg-accent/10 text-accent hover:bg-accent/20'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <span className="text-lg">⚡</span> Fast (250 rad/s)
                  </button>

                  {/* Custom Speed */}
                  <div
                    className={`rounded-xl border p-4 transition-all ${
                      currentMode === 'custom'
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-border bg-secondary/30'
                    }`}
                  >
                    <label
                      htmlFor="custom-speed"
                      className="mb-2 block text-sm font-medium text-foreground"
                    >
                      Custom speed (rad/s)
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="custom-speed"
                        type="number"
                        min={MOTOR_SPEED_MIN_RAD_S}
                        max={MOTOR_SPEED_MAX_RAD_S}
                        step={1}
                        value={customSpeedInput}
                        onChange={(e) => setCustomSpeedInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void setCustomSpeed();
                          }
                        }}
                        disabled={!connected}
                        className="w-full rounded-lg border border-border bg-white px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                        placeholder="e.g. 100 or -100"
                      />
                      <Button
                        onClick={() => void setCustomSpeed()}
                        disabled={!connected}
                        className="shrink-0 tech-button bg-primary hover:bg-primary/90 text-primary-foreground"
                      >
                        Set
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Range {MOTOR_SPEED_MIN_RAD_S}–{MOTOR_SPEED_MAX_RAD_S} rad/s (negative = reverse, M0 = stop)
                    </p>
                  </div>
                </div>

                {/* Auto-Shutoff Toggle — UI retained; feature not on device yet */}
                <div className="mt-8 pt-8 border-t border-border opacity-70">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Power className="w-5 h-5 text-primary" />
                      <span className="font-medium text-foreground">Auto-Shutoff</span>
                    </div>
                    <button
                      type="button"
                      disabled
                      aria-disabled="true"
                      title="Not available on device yet"
                      className="relative inline-flex h-8 w-14 cursor-not-allowed items-center rounded-full bg-gray-300 opacity-60"
                    >
                      <span className="inline-block h-6 w-6 translate-x-1 transform rounded-full bg-white" />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Auto-shutoff disabled — not available on device yet
                  </p>
                </div>
              </div>
            </div>

            {/* Right: Telemetry Display — driven by BLE notifications after connect */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-xl p-8 shadow-sm border border-border">
                <h2 className="text-lg font-bold text-primary mb-6 text-center">Real-Time Telemetry</h2>
                <div className="mb-6 flex items-center justify-center gap-2 text-xs font-medium">
                  {connected && telemetryLive ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-green-700">Live via {telemetrySource}</span>
                    </>
                  ) : connected ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                      <span className="text-amber-700">
                        Waiting for {telemetrySource} telemetry…
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Connect to stream telemetry</span>
                  )}
                </div>

                {/* Status Indicator */}
                <div className="mb-8">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-muted-foreground">Motor Status</span>
                    <div className={`status-led ${motorState.status !== 'Stop' ? 'active' : ''} ${
                      motorState.status === 'Error'
                        ? 'bg-destructive'
                        : motorState.status === 'Running'
                          ? 'bg-green-500'
                          : 'bg-muted'
                    }`} />
                  </div>
                  <p className="text-2xl font-bold text-primary">
                    {telemetryLive ? motorState.status : '—'}
                  </p>
                </div>

                {/* Speed Display */}
                <div className="mb-8">
                  <p className="text-sm font-medium text-muted-foreground mb-2">Speed</p>
                  <div className="bg-secondary/50 rounded-lg p-4">
                    <p className="text-3xl font-mono font-bold text-accent">
                      {telemetryLive ? `${motorState.rpm.toFixed(0)} RPM` : '— RPM'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {telemetryLive ? `${motorState.speed.toFixed(2)} rad/s` : '— rad/s'}
                    </p>
                  </div>
                </div>

                {/* Anomaly Detection */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-muted-foreground">Anomaly Detection</span>
                    <div
                      className={`status-led ${
                        !telemetryLive
                          ? 'bg-muted'
                          : motorState.anomaly === 'BLOCKED'
                            ? 'bg-red-500 active'
                            : motorState.anomaly === 'SLOWED'
                              ? 'bg-yellow-500 active'
                              : 'bg-green-500'
                      }`}
                    />
                  </div>

                  <div className="bg-secondary/50 rounded-lg p-4 mb-3">
                    <p
                      className={`text-2xl font-bold tracking-wide ${
                        !telemetryLive
                          ? 'text-muted-foreground'
                          : motorState.anomaly === 'BLOCKED'
                            ? 'text-red-600'
                            : motorState.anomaly === 'SLOWED'
                              ? 'text-yellow-600'
                              : 'text-green-600'
                      }`}
                    >
                      {telemetryLive ? motorState.anomaly : '—'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {!telemetryLive
                        ? 'Pending telemetry'
                        : anomalyLabel(motorState.anomaly)}
                    </p>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {!telemetryLive
                      ? transport === 'wifi'
                        ? 'Telemetry starts when Wi-Fi delivers Motor: frames'
                        : 'Telemetry starts when BLE notifications deliver Motor: frames'
                      : motorState.anomaly === 'NORMAL'
                        ? '✓ Normal Operation'
                        : motorState.anomaly === 'SLOWED'
                          ? '⚠️ Fan running slower than expected'
                          : '⛔ Fan blocked or stalled'}
                  </p>
                </div>

                {/* Last Update */}
                <div className="pt-4 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    Last update:{' '}
                    {telemetryLive
                      ? new Date(motorState.timestamp).toLocaleTimeString()
                      : '—'}
                  </p>
                </div>
              </div>
            </div>
          </div>

        {/* Error Message */}
        {error && (
          <div className="mt-8 max-w-2xl mx-auto bg-destructive/10 border border-destructive/20 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Error</p>
              <p className="text-sm text-destructive/80">{error}</p>
            </div>
          </div>
        )}
      </main>

      {/* Wi-Fi connect / provision dialog */}
      {wifiDialogOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-white p-6 shadow-lg">
            {wifiDialogMode === 'direct' ? (
              <>
                <h3 className="text-lg font-bold text-primary mb-2">Connect over Wi-Fi</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Enter the device LAN IP. The UI will probe <code>/status</code> and{' '}
                  <code>/telemetry</code> on the same network — no BLE required.
                </p>

                {storedDeviceIps.length > 0 && (
                  <select
                    className="mb-3 w-full rounded-lg border border-border px-3 py-2 text-sm"
                    value={storedDeviceIps.includes(wifiIp) ? wifiIp : ''}
                    onChange={(e) => setWifiIp(e.target.value)}
                  >
                    <option value="">Recent device IPs…</option>
                    {storedDeviceIps.map((ip) => (
                      <option key={ip} value={ip}>
                        {ip}
                      </option>
                    ))}
                  </select>
                )}

                <input
                  className="mb-4 w-full rounded-lg border border-border px-3 py-2 text-sm font-mono"
                  placeholder="e.g. 192.168.1.42"
                  value={wifiIp}
                  onChange={(e) => setWifiIp(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void connectWifiDirect();
                    }
                  }}
                />

                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setWifiDialogOpen(false)} disabled={switching}>
                    Cancel
                  </Button>
                  <Button
                    disabled={switching || !wifiIp.trim()}
                    onClick={() => void connectWifiDirect()}
                  >
                    {switching ? 'Checking network…' : 'Connect'}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-bold text-primary mb-2">Switch to Wi-Fi</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  BLE stays connected until Wi-Fi is verified on the same LAN. If the device
                  has no IP or is on another network, you will stay on BLE.
                </p>

                {storedNetworks.length > 0 && (
                  <label className="mb-4 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={wifiUseStored}
                      onChange={(e) => setWifiUseStored(e.target.checked)}
                    />
                    Use stored network ({storedNetworks[0]?.ssid})
                  </label>
                )}

                {!wifiUseStored && (
                  <div className="space-y-3 mb-4">
                    {storedNetworks.length > 0 && (
                      <select
                        className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                        value={wifiSsid}
                        onChange={(e) => {
                          const ssid = e.target.value;
                          setWifiSsid(ssid);
                          const match = storedNetworks.find((n) => n.ssid === ssid);
                          if (match?.password) setWifiPassword(match.password);
                        }}
                      >
                        <option value="">Select stored SSID…</option>
                        {storedNetworks.map((n) => (
                          <option key={n.ssid} value={n.ssid}>
                            {n.ssid}
                          </option>
                        ))}
                      </select>
                    )}
                    <input
                      className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="SSID"
                      value={wifiSsid}
                      onChange={(e) => setWifiSsid(e.target.value)}
                    />
                    <input
                      type="password"
                      className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="Password"
                      value={wifiPassword}
                      onChange={(e) => setWifiPassword(e.target.value)}
                    />
                  </div>
                )}

                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setWifiDialogOpen(false)} disabled={switching}>
                    Cancel
                  </Button>
                  <Button
                    disabled={switching || (!wifiUseStored && !wifiSsid.trim())}
                    onClick={() =>
                      void switchToWifi(
                        wifiUseStored && storedNetworks.length > 0
                          ? { useStored: true }
                          : { ssid: wifiSsid.trim(), password: wifiPassword }
                      )
                    }
                  >
                    {switching ? 'Switching…' : 'Connect Wi-Fi'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Debug Console */}
      <DebugConsole messages={debugMessages} onClear={clearDebugMessages} />

      {/* Footer */}
      <footer className="border-t border-border bg-white/50 backdrop-blur-sm mt-12">
        <div className="container py-6 text-center text-sm text-muted-foreground">
          <p>© 2025 Silicon Labs. Web Bluetooth Fan Controller Demo v1.1.0</p>
        </div>
      </footer>
    </div>
  );
}
