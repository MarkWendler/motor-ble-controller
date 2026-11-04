export interface BleCharacteristicLike {
  properties?: {
    read?: boolean;
    write?: boolean;
    writeWithoutResponse?: boolean;
    notify?: boolean;
  };
  writeValue(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
}

export type BleWriteMode = 'withResponse' | 'withoutResponse';

/** Match Si917 SPP notify/write chunk size (default ATT MTU 23 → 20 byte payload). */
export const BLE_SPP_CHUNK_LEN = 20;

function toUint8Array(data: BufferSource): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * Write to a BLE characteristic using the mode the device supports.
 * SPP/UART characteristics often only accept write-without-response;
 * using writeValue() on those fails on Linux with "GATT operation failed".
 */
export async function writeBleCharacteristic(
  characteristic: BleCharacteristicLike,
  data: BufferSource
): Promise<BleWriteMode> {
  const canWriteWithoutResponse =
    characteristic.properties?.writeWithoutResponse !== false &&
    typeof characteristic.writeValueWithoutResponse === 'function';
  const canWriteWithResponse = characteristic.properties?.write !== false;

  if (characteristic.properties?.writeWithoutResponse && canWriteWithoutResponse) {
    await characteristic.writeValueWithoutResponse!(data);
    return 'withoutResponse';
  }

  if (characteristic.properties?.write && canWriteWithResponse) {
    await characteristic.writeValue(data);
    return 'withResponse';
  }

  // Properties unavailable: try without-response first (typical for SPP on Linux)
  if (canWriteWithoutResponse) {
    try {
      await characteristic.writeValueWithoutResponse!(data);
      return 'withoutResponse';
    } catch {
      // Fall back to write with response
    }
  }

  await characteristic.writeValue(data);
  return 'withResponse';
}

/**
 * Write a full SPP payload in ≤20-byte chunks. Firmware reassembles until '\\n',
 * so long commands like `wifi connect <ssid> <psk>` must be split or the GATT
 * write is rejected / truncated at the default ATT MTU.
 */
export async function writeBleCharacteristicChunked(
  characteristic: BleCharacteristicLike,
  data: BufferSource,
  chunkLen = BLE_SPP_CHUNK_LEN
): Promise<BleWriteMode> {
  const bytes = toUint8Array(data);
  if (bytes.length === 0) {
    return 'withoutResponse';
  }
  if (bytes.length <= chunkLen) {
    return writeBleCharacteristic(characteristic, bytes);
  }

  let mode: BleWriteMode = 'withoutResponse';
  for (let offset = 0; offset < bytes.length; offset += chunkLen) {
    const end = Math.min(offset + chunkLen, bytes.length);
    mode = await writeBleCharacteristic(characteristic, bytes.slice(offset, end));
    if (end < bytes.length) {
      await new Promise((r) => window.setTimeout(r, 15));
    }
  }
  return mode;
}

export function describeCharacteristicProperties(
  characteristic: BleCharacteristicLike
): string {
  const props = characteristic.properties;
  if (!props) return 'properties unknown';

  const enabled = Object.entries(props)
    .filter(([, value]) => value)
    .map(([key]) => key);

  return enabled.length > 0 ? enabled.join(', ') : 'none';
}
