import { contextBridge, ipcRenderer } from 'electron';

// Expose safe APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  getPlatform: () => ipcRenderer.invoke('bluetooth:get-platform'),
  requestDevice: (options: any) => ipcRenderer.invoke('bluetooth:request-device', options),
});

// Declare the type for TypeScript
declare global {
  interface Window {
    electronAPI: {
      getPlatform: () => Promise<string>;
      requestDevice: (options: any) => Promise<any>;
    };
  }
}
