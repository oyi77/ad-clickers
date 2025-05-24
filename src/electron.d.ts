interface ElectronAPI {
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  isElectron: boolean;
  ipcRenderer?: {
    on: (channel: string, listener: (event: any, data: any) => void) => void;
    removeAllListeners: (channel: string) => void;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {}; 