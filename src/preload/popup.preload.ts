import { contextBridge, clipboard, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('quickChat', {
  paste: () => clipboard.readText(),
  on: (channel: string, listener: (...args: any[]) => void) => ipcRenderer.on(channel, (_e, ...args) => listener(...args)),
  send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
});