// Preload — the secure bridge between the editor UI (renderer) and Node/main.
// contextIsolation stays ON; only this explicit API reaches the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flimify', {
  isDesktop: true,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  // native file-open dialog → absolute path (so /import works without re-upload)
  openVideo: () => ipcRenderer.invoke('open-video'),
  // reveal an exported file in Finder/Explorer
  revealFile: (p) => ipcRenderer.send('reveal-file', p),
  // native menu → renderer actions (import / export)
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),
});
