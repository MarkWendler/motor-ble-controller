/**
 * BLE GATT profiles for the supported motor controller boards.
 *
 * Two firmware generations are in the field and both advertise the same 128-bit
 * SPP service UUID, so they can only be told apart after the GATT connection:
 *
 * - MG24 / Arduino Nano Matter boards expose the SPP UUIDs verbatim.
 * - SiWG917 predictive-maintenance boards build their GATT table from Si91x
 *   `uuid_t` arrays whose byte order does not round-trip through Chrome, so the
 *   same firmware constants surface with the trailing groups byte-swapped.
 *
 * Resolution must enumerate the services the device actually exposes rather
 * than probing each UUID in turn: a getPrimaryService() call for a UUID that is
 * not present stalls BlueZ ATT for ~30s and delays telemetry after connect.
 */

export interface BleProfile {
  id: string;
  label: string;
  serviceUuid: string;
  characteristicUuid: string;
  /** Firmware generation that understands the `wifi` SPP commands. */
  supportsWifi: boolean;
}

/** SiWG917 predictive-maintenance firmware, as Chrome resolves its GATT table. */
export const PM_BLE_PROFILE: BleProfile = {
  id: 'pm',
  label: 'SiWG917 predictive maintenance',
  serviceUuid: '4880c12c-fdcb-4077-2089-50a407b9f9d7',
  characteristicUuid: 'fec26ec4-6d71-4442-819f-bc55d658d621',
  supportsWifi: true,
};

/** Original MG24 / Nano Matter SPP firmware, which uses the UUIDs verbatim. */
export const LEGACY_BLE_PROFILE: BleProfile = {
  id: 'mg24',
  label: 'MG24 SPP',
  serviceUuid: '4880c12c-fdcb-4077-8920-a450d7f9b907',
  characteristicUuid: 'fec26ec4-6d71-4442-9f81-55bc21d658d6',
  supportsWifi: false,
};

/**
 * On-air / advertising form used in scan response filters. Both generations
 * advertise it, and on the MG24 it is also the GATT service UUID.
 */
export const PM_BLE_ADV_SERVICE_UUID = LEGACY_BLE_PROFILE.serviceUuid;

/** Profiles to match against the device's GATT table, newest firmware first. */
export const BLE_PROFILES: BleProfile[] = [PM_BLE_PROFILE, LEGACY_BLE_PROFILE];

/** Scan filters + optionalServices (adv UUID plus every GATT service UUID). */
export const BLE_SERVICE_UUIDS = Array.from(
  new Set([PM_BLE_ADV_SERVICE_UUID, ...BLE_PROFILES.map((profile) => profile.serviceUuid)])
);

/* Structural GATT types so profile resolution can be exercised without a radio. */
export interface GattServiceLike<TCharacteristic> {
  uuid: string;
  getCharacteristic(characteristic: string): Promise<TCharacteristic>;
}

export interface GattServerLike<TCharacteristic> {
  getPrimaryService(service: string): Promise<GattServiceLike<TCharacteristic>>;
  getPrimaryServices(service?: string): Promise<GattServiceLike<TCharacteristic>[]>;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Work out which firmware generation a connected board runs and hand back its
 * SPP characteristic.
 *
 * Service enumeration comes first so only UUIDs the board actually has are ever
 * requested. Probing an absent UUID stalls BlueZ ATT for ~30s, which is what
 * makes a blind "try every profile in turn" approach unusable here. Probing is
 * kept only as a fallback for stacks that refuse to enumerate.
 */
export async function resolveBleProfile<TCharacteristic>(
  server: GattServerLike<TCharacteristic>,
  timeoutMs = 5000
): Promise<{ profile: BleProfile; characteristic: TCharacteristic }> {
  let discovered: GattServiceLike<TCharacteristic>[] = [];
  try {
    discovered = await withTimeout(server.getPrimaryServices(), timeoutMs, 'Service discovery');
  } catch {
    /* Enumeration unavailable — fall back to probing the known UUIDs below. */
  }

  const servicesByUuid = new Map(
    discovered.map((service) => [service.uuid.toLowerCase(), service])
  );
  const candidates =
    servicesByUuid.size > 0
      ? BLE_PROFILES.filter((profile) => servicesByUuid.has(profile.serviceUuid))
      : BLE_PROFILES;

  if (candidates.length === 0) {
    const found = Array.from(servicesByUuid.keys()).join(', ') || 'none';
    throw new Error(`No supported SPP service on this device (services found: ${found})`);
  }

  let lastError: unknown;
  for (const profile of candidates) {
    try {
      const service =
        servicesByUuid.get(profile.serviceUuid) ??
        (await withTimeout(server.getPrimaryService(profile.serviceUuid), timeoutMs, 'SPP service'));
      const characteristic = await withTimeout(
        service.getCharacteristic(profile.characteristicUuid),
        timeoutMs,
        'SPP characteristic'
      );
      return { profile, characteristic };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('SPP characteristic not found on this device');
}
