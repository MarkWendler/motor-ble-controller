export type StoredWifiNetwork = {
  ssid: string;
  /** Host-side cache only; device also stores credentials in NVM. */
  password?: string;
};

const NETWORKS_KEY = 'pm.wifi.networks';
const DEVICE_IPS_KEY = 'pm.wifi.deviceIps';

export function loadStoredWifiNetworks(): StoredWifiNetwork[] {
  try {
    const raw = localStorage.getItem(NETWORKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredWifiNetwork[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n) => typeof n?.ssid === 'string' && n.ssid.length > 0);
  } catch {
    return [];
  }
}

export function saveWifiNetwork(network: StoredWifiNetwork): void {
  const list = loadStoredWifiNetworks().filter((n) => n.ssid !== network.ssid);
  list.unshift({ ssid: network.ssid, password: network.password });
  localStorage.setItem(NETWORKS_KEY, JSON.stringify(list.slice(0, 8)));
}

/** Clear browser-cached SSIDs/passwords (keeps UI in sync after device NVM erase). */
export function clearStoredWifiNetworks(): void {
  localStorage.removeItem(NETWORKS_KEY);
}

/** Recently used device LAN IPs (most recent first). */
export function loadStoredDeviceIps(): string[] {
  try {
    const raw = localStorage.getItem(DEVICE_IPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((ip) => typeof ip === 'string' && ip.length > 0);
  } catch {
    return [];
  }
}

export function saveDeviceIp(ip: string): void {
  const trimmed = ip.trim();
  if (!trimmed) return;
  const list = loadStoredDeviceIps().filter((x) => x !== trimmed);
  list.unshift(trimmed);
  localStorage.setItem(DEVICE_IPS_KEY, JSON.stringify(list.slice(0, 8)));
}

/** Clear cached device LAN IPs. */
export function clearStoredDeviceIps(): void {
  localStorage.removeItem(DEVICE_IPS_KEY);
}

/**
 * Forget all host-side Wi-Fi provisioning cache (networks + device IPs).
 * Call when the Si917 NVM credentials are cleared (user Disconnect).
 */
export function clearAllStoredWifi(): void {
  clearStoredWifiNetworks();
  clearStoredDeviceIps();
}
