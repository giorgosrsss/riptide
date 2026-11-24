const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('riptide', {
  add: id => ipcRenderer.invoke('add', id),
  addFiles: () => ipcRenderer.invoke('add-files'),
  addDropped: file => ipcRenderer.invoke('add', webUtils.getPathForFile(file)),
  pause: h => ipcRenderer.invoke('pause', h),
  resume: h => ipcRenderer.invoke('resume', h),
  remove: (h, deleteFiles) => ipcRenderer.invoke('remove', h, deleteFiles),
  selectFile: (h, i, sel) => ipcRenderer.invoke('select-file', h, i, sel),
  settings: () => ipcRenderer.invoke('settings'),
  updateSettings: patch => ipcRenderer.invoke('update-settings', patch),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  openFolder: h => ipcRenderer.invoke('open-folder', h),
  openFile: (h, i) => ipcRenderer.invoke('open-file', h, i),
  isMagnetDefault: () => ipcRenderer.invoke('magnet-default'),
  makeMagnetDefault: () => ipcRenderer.invoke('make-magnet-default'),
  copy: text => ipcRenderer.invoke('copy', text),
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  on: (channel, fn) => {
    if (!['state', 'toast', 'log'].includes(channel)) return
    ipcRenderer.on(channel, (_e, payload) => fn(payload))
  }
})
