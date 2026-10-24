const { contextBridge, ipcRenderer } = require('electron');
// No arbitrary channel, filesystem, shell, or network access crosses this bridge.
contextBridge.exposeInMainWorld('athensDesktop', Object.freeze({
  session: () => ipcRenderer.invoke('athens:session'),
  host: () => ipcRenderer.invoke('athens:host'),
  join: address => ipcRenderer.invoke('athens:join', address),
  solo: () => ipcRenderer.invoke('athens:solo'),
}));
