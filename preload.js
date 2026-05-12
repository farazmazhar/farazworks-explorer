const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('explorerAPI', {
  getProviders: () => ipcRenderer.invoke('get-providers'),
  addProvider: (type, config) => ipcRenderer.invoke('add-provider', type, config),
  removeProvider: (id) => ipcRenderer.invoke('remove-provider', id),
  getDbfsProfiles: () => ipcRenderer.invoke('get-dbfs-profiles'),
  listFiles: (providerId, path) => ipcRenderer.invoke('list-files', providerId, path),
  delete: (providerId, path) => ipcRenderer.invoke('delete', providerId, path),
  rename: (providerId, oldPath, newName) => ipcRenderer.invoke('rename', providerId, oldPath, newName),
  copy: (srcProviderId, destProviderId, srcPath, destDir) => ipcRenderer.invoke('copy', srcProviderId, destProviderId, srcPath, destDir),
  move: (srcProviderId, destProviderId, srcPath, destDir) => ipcRenderer.invoke('move', srcProviderId, destProviderId, srcPath, destDir),
  mkdir: (providerId, targetDir, folderName) => ipcRenderer.invoke('mkdir', providerId, targetDir, folderName),
  
  // Dialogs
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),

  // Drag and Drop
  startDrag: (filePath) => ipcRenderer.send('ondragstart', filePath),

  // Events
  onProgressUpdate: (callback) => {
    ipcRenderer.on('progress-update', (event, data) => callback(data));
  }
});
