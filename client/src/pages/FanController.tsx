import { useState, useEffect, useRef } from 'react';
import { Bluetooth, AlertCircle, CheckCircle2, Zap, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DebugConsole, type DebugMessage } from '@/components/DebugConsole';
import { parseTelemetry, TelemetryStreamParser, type MotorTelemetry } from '@/lib/telemetry-parser';

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
  }
  interface BluetoothRemoteGATTServer {
    connect(): Promise<BluetoothRemoteGATTServer>;
    getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
  }
  interface BluetoothRemoteGATTService {
    getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
  }
  interface BluetoothRemoteGATTCharacteristic {
    value?: DataView;
    readable?: ReadableStream<Uint8Array>;
    startNotifications(): Promise<void>;
    stopNotifications(): Promise<void>;
    writeValue(value: BufferSource): Promise<void>;
    addEventListener(type: string, listener: EventListener): void;
  }
}

type MotorMode = 'stop' | 'low' | 'high';

/**
 * FanController Component
 * 
 * Web Bluetooth SPP interface for Silicon Labs MG24 motor control demo
 * Demonstrates integration of:
 * - Bluetooth Connectivity (Web Bluetooth SPP)
 * - Motor Control (PWM-based speed regulation)
 * - Anomaly Detection (AI/ML edge processing)
 * - Auto-shutoff feature control
 */
export default function FanController() {
  // Custom 128-bit UUIDs for Silicon Labs SPP service
  const SPP_SERVICE_UUID = '4880c12c-fdcb-4077-8920-a450d7f9b907';
  const SPP_DATA_CHARACTERISTIC_UUID = 'fec26ec4-6d71-4442-9f81-55bc21d658d6';

  const [connected, setConnected] = useState(false);
  const [currentMode, setCurrentMode] = useState<MotorMode>('stop');
  const [motorState, setMotorState] = useState<MotorTelemetry>({
    status: 'Stop',
    speed: 0,
    rpm: 0,
    anomalyPercentage: 0,
    anomalyDetected: false,
    timestamp: Date.now(),
  });
  const [connectionStatus, setConnectionStatus] = useState<string>('Disconnected');
  const [error, setError] = useState<string | null>(null);
  const [autoShutoffEnabled, setAutoShutoffEnabled] = useState(false);
  const [debugMessages, setDebugMessages] = useState<DebugMessage[]>([]);

  const characteristicRef = useRef<any>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const telemetryParserRef = useRef<TelemetryStreamParser>(new TelemetryStreamParser());
  const abortControllerRef = useRef<AbortController | null>(null);
  const debugMessageIdRef = useRef(0);

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
   * Connect to Bluetooth device via Web Bluetooth API
   */
  const connectBluetooth = async () => {
    try {
      setError(null);
      setConnectionStatus('Scanning...');

      // Request Bluetooth device using custom 128-bit UUIDs
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [SPP_SERVICE_UUID] },
        ],
        optionalServices: [SPP_SERVICE_UUID],
      });

      setConnectionStatus('Connecting...');

      // Connect to GATT server
      const server = await device.gatt!.connect();
      const service = await server.getPrimaryService(SPP_SERVICE_UUID);

      // Get SPP characteristic (RX/TX)
      const characteristic = await service.getCharacteristic(SPP_DATA_CHARACTERISTIC_UUID);

      characteristicRef.current = characteristic;

      // Start listening for notifications
      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', handleCharacteristicChange);

      setConnected(true);
      setConnectionStatus('Connected');
      setCurrentMode('stop');

      // Start reading from the characteristic
      startReading(characteristic);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Connection failed';
      setError(errorMsg);
      setConnectionStatus('Disconnected');
      setConnected(false);
    }
  };

  /**
   * Start reading from BLE characteristic using Web Streams API
   */
  const startReading = async (characteristic: any) => {
    try {
      const reader = characteristic.readable?.getReader();
      if (!reader) return;

      readerRef.current = reader;
      abortControllerRef.current = new AbortController();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Feed data into the telemetry parser
        const telemetryFrames = telemetryParserRef.current.feed(value);

        // Process all parsed frames
        for (const telemetry of telemetryFrames) {
          setMotorState(telemetry);
        }
      }
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('aborted'))) {
        console.error('Reading error:', err);
      }
    }
  };

  /**
   * Handle characteristic value changes (notifications)
   */
  const handleCharacteristicChange = (event: Event) => {
    const characteristic = event.target as any;
    const value = characteristic.value;
    if (value) {
      // Log raw data
      const rawData = new Uint8Array(value.buffer);
      const dataStr = new TextDecoder().decode(rawData).trim();
      if (dataStr) {
        addDebugMessage('received', dataStr, rawData);
      }

      // Feed data into the telemetry parser
      const telemetryFrames = telemetryParserRef.current.feed(value);

      // Process all parsed frames
      for (const telemetry of telemetryFrames) {
        setMotorState(telemetry);
      }
    }
  };

  /**
   * Send command to motor control board
   */
  const sendCommand = async (command: string) => {
    if (!characteristicRef.current || !connected) {
      setError('Not connected to device');
      return;
    }

    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(command + '\n');
      addDebugMessage('sent', command);
      await characteristicRef.current.writeValue(data);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to send command';
      setError(errorMsg);
    }
  };

  /**
   * Control motor mode
   */
  const setMotorMode = async (mode: MotorMode) => {
    let command = '';

    switch (mode) {
      case 'stop':
        command = 'M0';
        break;
      case 'low':
        command = 'M10';
        break;
      case 'high':
        command = 'M20';
        break;
    }

    setCurrentMode(mode);
    await sendCommand(command);
  };

  /**
   * Toggle auto-shutoff feature
   */
  const toggleAutoShutoff = async () => {
    const newState = !autoShutoffEnabled;
    const command = newState ? 'AOFF1' : 'AOFF0';

    try {
      await sendCommand(command);
      setAutoShutoffEnabled(newState);
    } catch (err) {
      setError(`Failed to ${newState ? 'enable' : 'disable'} auto-shutoff`);
    }
  };

  /**
   * Disconnect from Bluetooth device
   */
  const disconnectBluetooth = async () => {
    try {
      if (readerRef.current) {
        await readerRef.current.cancel();
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (characteristicRef.current) {
        await characteristicRef.current.stopNotifications();
      }

      setConnected(false);
      setConnectionStatus('Disconnected');
      characteristicRef.current = null;
      readerRef.current = null;
      telemetryParserRef.current.reset();
    } catch (err) {
      console.error('Disconnect error:', err);
    }
  };

  // Check Web Bluetooth support
  const bluetoothSupported = 'bluetooth' in navigator;

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
              <h1 className="text-xl font-bold text-primary">Silicon Labs MG24</h1>
              <p className="text-xs text-muted-foreground">Motor Control Demo</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${connected ? 'bg-green-50' : 'bg-red-50'}`}>
              <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-sm font-medium text-foreground">{connectionStatus}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-12">
        {!bluetoothSupported ? (
          <div className="max-w-2xl mx-auto bg-destructive/10 border border-destructive/20 rounded-xl p-8 text-center">
            <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-foreground mb-2">Web Bluetooth Not Supported</h2>
            <p className="text-muted-foreground mb-4">
              Your browser does not support the Web Bluetooth API. Please use Chrome, Edge, or Opera on a device with Bluetooth hardware.
            </p>
          </div>
        ) : (
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
                      <p className="font-medium text-foreground">Anomaly Detection</p>
                      <p className="text-xs text-muted-foreground">AI/ML Edge Processing</p>
                    </div>
                  </div>
                </div>

                {/* Connection Button */}
                <div className="mt-6 pt-6 border-t border-border">
                  {!connected ? (
                    <Button
                      onClick={connectBluetooth}
                      className="w-full tech-button bg-accent hover:bg-accent/90 text-accent-foreground"
                    >
                      <Bluetooth className="w-4 h-4 mr-2" />
                      Connect Device
                    </Button>
                  ) : (
                    <Button
                      onClick={disconnectBluetooth}
                      variant="outline"
                      className="w-full tech-button"
                    >
                      Disconnect
                    </Button>
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

                  {/* Low Speed Button */}
                  <button
                    onClick={() => setMotorMode('low')}
                    disabled={!connected}
                    className={`w-full tech-button py-4 rounded-xl font-semibold transition-all ${
                      currentMode === 'low'
                        ? 'bg-green-500 text-green-foreground shadow-lg'
                        : 'bg-green-100 text-green-700 hover:bg-green-200'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <span className="text-lg">🌀</span> Low (10 rad/s)
                  </button>

                  {/* High Speed Button */}
                  <button
                    onClick={() => setMotorMode('high')}
                    disabled={!connected}
                    className={`w-full tech-button py-4 rounded-xl font-semibold transition-all ${
                      currentMode === 'high'
                        ? 'bg-accent text-accent-foreground shadow-lg'
                        : 'bg-accent/10 text-accent hover:bg-accent/20'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <span className="text-lg">⚡</span> High (20 rad/s)
                  </button>
                </div>

                {/* Auto-Shutoff Toggle */}
                <div className="mt-8 pt-8 border-t border-border">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Power className="w-5 h-5 text-primary" />
                      <span className="font-medium text-foreground">Auto-Shutoff</span>
                    </div>
                    <button
                      onClick={toggleAutoShutoff}
                      disabled={!connected}
                      className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                        autoShutoffEnabled ? 'bg-accent' : 'bg-gray-300'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <span
                        className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                          autoShutoffEnabled ? 'translate-x-7' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {autoShutoffEnabled ? 'Auto-shutoff enabled' : 'Auto-shutoff disabled'}
                  </p>
                </div>
              </div>
            </div>

            {/* Right: Telemetry Display */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-xl p-8 shadow-sm border border-border">
                <h2 className="text-lg font-bold text-primary mb-6 text-center">Real-Time Telemetry</h2>

                {/* Status Indicator */}
                <div className="mb-8">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-muted-foreground">Motor Status</span>
                    <div className={`status-led ${motorState.status !== 'Stop' ? 'active' : ''} ${
                      motorState.status === 'Error'
                        ? 'bg-destructive'
                        : motorState.status === 'Running'
                          ? 'bg-success'
                          : 'bg-muted'
                    }`} />
                  </div>
                  <p className="text-2xl font-bold text-primary">{motorState.status}</p>
                </div>

                {/* Speed Display */}
                <div className="mb-8">
                  <p className="text-sm font-medium text-muted-foreground mb-2">Speed</p>
                  <div className="bg-secondary/50 rounded-lg p-4">
                    <p className="text-3xl font-mono font-bold text-accent">
                      {motorState.rpm.toFixed(0)} RPM
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {motorState.speed.toFixed(2)} rad/s
                    </p>
                  </div>
                </div>

                {/* Anomaly Detection */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-muted-foreground">Anomaly Detection</span>
                    <div className={`status-led ${motorState.anomalyDetected ? 'active' : ''} ${
                      motorState.anomalyDetected ? 'bg-warning' : 'bg-success'
                    }`} />
                  </div>
                  
                  {/* Anomaly Meter Bar */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-2xl font-mono font-bold text-foreground">
                        {motorState.anomalyPercentage}%
                      </span>
                      <span className="text-xs font-medium text-muted-foreground">
                        {motorState.anomalyPercentage < 30 ? 'Normal' : motorState.anomalyPercentage < 70 ? 'Warning' : 'Critical'}
                      </span>
                    </div>
                    
                    {/* Progress Bar */}
                    <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          motorState.anomalyPercentage < 30
                            ? 'bg-green-500'
                            : motorState.anomalyPercentage < 70
                              ? 'bg-yellow-500'
                              : 'bg-red-500'
                        }`}
                        style={{
                          width: `${motorState.anomalyPercentage}%`,
                        }}
                      />
                    </div>
                  </div>
                  
                  <p className="text-xs text-muted-foreground">
                    {motorState.anomalyDetected ? '⚠️ Anomaly Detected' : '✓ Normal Operation'}
                  </p>
                </div>

                {/* Last Update */}
                <div className="pt-4 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    Last update: {new Date(motorState.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

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

      {/* Debug Console */}
      <DebugConsole messages={debugMessages} onClear={clearDebugMessages} />

      {/* Footer */}
      <footer className="border-t border-border bg-white/50 backdrop-blur-sm mt-12">
        <div className="container py-6 text-center text-sm text-muted-foreground">
          <p>© 2025 Silicon Labs. Web Bluetooth Fan Controller Demo v1.0.0</p>
        </div>
      </footer>
    </div>
  );
}
