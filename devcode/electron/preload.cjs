const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('devcode', {
  selectFolder: () => ipcRenderer.invoke('devcode:selectFolder'),
  getState: () => ipcRenderer.invoke('devcode:getState'),
  setState: (patch) => ipcRenderer.invoke('devcode:setState', patch),
  getVersion: () => ipcRenderer.invoke('devcode:getVersion'),
  downloadAndInstall: (url, version) => ipcRenderer.invoke('devcode:downloadAndInstall', url, version),
  
  // Folder Fetch Logic (IPC)
  fsTree: (root, dir) => ipcRenderer.invoke('fs:tree', root, dir),
  fsRead: (root, path) => ipcRenderer.invoke('fs:read', root, path),
  fsWrite: (root, path, content) => ipcRenderer.invoke('fs:write', root, path, content),
  fsWatch: (root, callback) => {
    ipcRenderer.removeAllListeners('fs:watch:change')
    ipcRenderer.on('fs:watch:change', (e, data) => callback(data))
    return ipcRenderer.invoke('fs:watch', root)
  }
})
