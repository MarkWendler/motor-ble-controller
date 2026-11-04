/**
 * BLE GATT profile for the SiWG917 predictive-maintenance firmware.
 *
 * The Si91x host uuid_t encoding does NOT match Chrome's UUID string 1:1.
 * With the firmware's host-side MG24-style uuid_t arrays, Chrome resolves:
 *   4880c12c-fdcb-4077-2089-50a407b9f9d7  (service)
 *   fec26ec4-6d71-4442-819f-bc55d658d621  (characteristic)
 *
 * Only probe that Chrome-visible UUID. Probing a missing UUID stalls BlueZ
 * ATT for ~30s and delays Real-Time Telemetry after connect.
 */

export interface BleProfile {
  id: string;
  label: string;
  serviceUuid: string;
  characteristicUuid: string;
}

/** Chrome-resolved SPP profile (use this for getPrimaryService / getCharacteristic). */
export const PM_BLE_PROFILE: BleProfile = {
  id: 'pm',
  label: 'Motor BLE Controller',
  serviceUuid: '4880c12c-fdcb-4077-2089-50a407b9f9d7',
  characteristicUuid: 'fec26ec4-6d71-4442-819f-bc55d658d621',
};

/**
 * On-air / advertising form used in scan response filters.
 * Included in requestDevice filters only — never probed via getPrimaryService.
 */
export const PM_BLE_ADV_SERVICE_UUID = '4880c12c-fdcb-4077-8920-a450d7f9b907';

/** Single profile to resolve after connect. */
export const BLE_PROFILES: BleProfile[] = [PM_BLE_PROFILE];

/** Scan filters + optionalServices (adv UUID + Chrome GATT UUID). */
export const BLE_SERVICE_UUIDS = [PM_BLE_ADV_SERVICE_UUID, PM_BLE_PROFILE.serviceUuid];
