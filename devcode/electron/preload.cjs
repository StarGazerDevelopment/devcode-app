const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('devcode', {
  selectFolder: () => ipcRenderer.invoke('devcode:selectFolder'),
  getState: () => ipcRenderer.invoke('devcode:getState'),
  setState: (patch) => ipcRenderer.invoke('devcode:setState', patch),
})
