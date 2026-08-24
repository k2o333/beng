const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  expand: (name) => ipcRenderer.invoke('panel:expand', name || null),
  setScale: (n) => ipcRenderer.invoke('scale:set', n),
  hide: () => ipcRenderer.send('win:hide'),
  quit: () => ipcRenderer.send('win:quit'),
  writeSave: (text) => ipcRenderer.invoke('save:write', text),
  readSave: () => ipcRenderer.invoke('save:read'),
  clearSave: () => ipcRenderer.invoke('save:clear'),
  setAutostart: (on) => ipcRenderer.invoke('autostart:set', on),
  getAutostart: () => ipcRenderer.invoke('autostart:get'),
  onLayout: (cb) => ipcRenderer.on('layout', (e, data) => cb(data))
});
