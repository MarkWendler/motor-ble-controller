import { describe, expect, it } from 'vitest';
import {
  BLE_SERVICE_UUIDS,
  LEGACY_BLE_PROFILE,
  PM_BLE_PROFILE,
  resolveBleProfile,
  type GattServerLike,
  type GattServiceLike,
} from './ble-profiles';

interface FakeCharacteristic {
  uuid: string;
}

/**
 * Stand-in for a connected board. `table` is its GATT tree, and `probes`
 * records every getPrimaryService() call so tests can assert we never ask a
 * board for a UUID it does not have.
 */
function fakeBoard(table: Record<string, string[]>, options: { canEnumerate?: boolean } = {}) {
  const canEnumerate = options.canEnumerate ?? true;
  const probes: string[] = [];
  const gatt = new Map(
    Object.entries(table).map(([uuid, characteristics]) => [uuid.toLowerCase(), characteristics])
  );

  const makeService = (uuid: string): GattServiceLike<FakeCharacteristic> => ({
    uuid,
    getCharacteristic: async (characteristic) => {
      if (!gatt.get(uuid.toLowerCase())?.includes(characteristic)) {
        throw new Error(`NotFoundError: ${characteristic}`);
      }
      return { uuid: characteristic };
    },
  });

  const server: GattServerLike<FakeCharacteristic> = {
    getPrimaryServices: async () => {
      if (!canEnumerate) throw new Error('getPrimaryServices unsupported');
      return Object.keys(table).map(makeService);
    },
    getPrimaryService: async (uuid) => {
      probes.push(uuid);
      if (!gatt.has(uuid.toLowerCase())) throw new Error(`NotFoundError: ${uuid}`);
      return makeService(uuid);
    },
  };

  return { server, probes };
}

const legacyBoard = {
  [LEGACY_BLE_PROFILE.serviceUuid]: [LEGACY_BLE_PROFILE.characteristicUuid],
};
const pmBoard = {
  [PM_BLE_PROFILE.serviceUuid]: [PM_BLE_PROFILE.characteristicUuid],
};

describe('scan configuration', () => {
  it('filters on both the advertised and the SiWG917 GATT service UUID', () => {
    expect(BLE_SERVICE_UUIDS).toContain(LEGACY_BLE_PROFILE.serviceUuid);
    expect(BLE_SERVICE_UUIDS).toContain(PM_BLE_PROFILE.serviceUuid);
  });

  it('keeps the two firmware generations on distinct GATT UUIDs', () => {
    expect(LEGACY_BLE_PROFILE.serviceUuid).not.toBe(PM_BLE_PROFILE.serviceUuid);
    expect(LEGACY_BLE_PROFILE.characteristicUuid).not.toBe(PM_BLE_PROFILE.characteristicUuid);
  });
});

describe('resolveBleProfile', () => {
  it('resolves the original MG24 board', async () => {
    const { server } = fakeBoard(legacyBoard);
    const { profile, characteristic } = await resolveBleProfile(server);

    expect(profile.id).toBe('mg24');
    expect(characteristic.uuid).toBe(LEGACY_BLE_PROFILE.characteristicUuid);
  });

  it('resolves the SiWG917 board', async () => {
    const { server } = fakeBoard(pmBoard);
    const { profile, characteristic } = await resolveBleProfile(server);

    expect(profile.id).toBe('pm');
    expect(characteristic.uuid).toBe(PM_BLE_PROFILE.characteristicUuid);
  });

  it('never probes a UUID the board does not expose', async () => {
    const legacy = fakeBoard(legacyBoard);
    await resolveBleProfile(legacy.server);
    expect(legacy.probes).toEqual([]);

    const pm = fakeBoard(pmBoard);
    await resolveBleProfile(pm.server);
    expect(pm.probes).toEqual([]);
  });

  it('matches regardless of the UUID casing the stack reports', async () => {
    const { server } = fakeBoard({
      [LEGACY_BLE_PROFILE.serviceUuid.toUpperCase()]: [LEGACY_BLE_PROFILE.characteristicUuid],
    });
    const { profile } = await resolveBleProfile(server);

    expect(profile.id).toBe('mg24');
  });

  it('ignores unrelated services a board also advertises', async () => {
    const { server } = fakeBoard({
      '00001800-0000-1000-8000-00805f9b34fb': [],
      ...legacyBoard,
    });
    const { profile } = await resolveBleProfile(server);

    expect(profile.id).toBe('mg24');
  });

  it('falls back to probing when the stack cannot enumerate services', async () => {
    const { server, probes } = fakeBoard(legacyBoard, { canEnumerate: false });
    const { profile } = await resolveBleProfile(server);

    expect(profile.id).toBe('mg24');
    expect(probes).toContain(LEGACY_BLE_PROFILE.serviceUuid);
  });

  it('reports what it saw when no supported service is present', async () => {
    const { server } = fakeBoard({ '0000180f-0000-1000-8000-00805f9b34fb': [] });

    await expect(resolveBleProfile(server)).rejects.toThrow(/0000180f-0000-1000-8000-00805f9b34fb/);
  });

  it('only advertises Wi-Fi support for the firmware that implements it', () => {
    expect(PM_BLE_PROFILE.supportsWifi).toBe(true);
    expect(LEGACY_BLE_PROFILE.supportsWifi).toBe(false);
  });
});
