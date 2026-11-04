/** Active device link used by the motor controller UI. */
export type TransportKind = 'ble' | 'wifi';

export type TransportDataHandler = (chunk: string) => void;
export type TransportDisconnectHandler = () => void;

export interface DeviceTransport {
  readonly kind: TransportKind;
  send(line: string): Promise<void>;
  disconnect(): Promise<void>;
}
