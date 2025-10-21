const { contextBridge, ipcRenderer } = require('electron');


contextBridge.exposeInMainWorld('api', {
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (s) => ipcRenderer.send('settings:save', s),
  writeInput: (p) => ipcRenderer.invoke('input:write', p),
  start: (cfg) => ipcRenderer.invoke('run:start', cfg),
  stop: () => ipcRenderer.invoke('run:stop'),
  isRunning: () => ipcRenderer.invoke('run:isRunning'),
  onStatus: (cb) => ipcRenderer.on('status:update', (_e, s) => cb(s)),
  onLog: (cb) => ipcRenderer.on('log', (_e, line) => cb(line)),
  onOutput: (cb) => ipcRenderer.on('output:update', (_e, text) => cb(text)),
  chooseDir: () => ipcRenderer.invoke('dialog:chooseDir')
});
