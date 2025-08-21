// Preload minimale per il popup Quick Chat
const { contextBridge, ipcRenderer, clipboard } = require("electron");

contextBridge.exposeInMainWorld("quickChat", {
  info: () => ipcRenderer.invoke("quickchat:info"),
  paste: () => clipboard.readText(),
  proxy: (opts) => ipcRenderer.invoke("quickchat:proxy", opts) // <--- nuovo
});