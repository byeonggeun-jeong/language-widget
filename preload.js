const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getImage: () => ipcRenderer.invoke('get-image'),
  getWords: () => ipcRenderer.invoke('get-words'),
  saveWords: (words) => ipcRenderer.send('save-words', words),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
  showMenu: () => ipcRenderer.send('show-menu'),
});
