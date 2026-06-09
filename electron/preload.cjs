// Preload — the secure bridge between the editor UI (renderer) and Node/main.
// Runs with access to Node but exposes only a tiny, explicit API to the page
// via contextBridge (contextIsolation stays ON). This is where we'll later
// expose the bundled bridge / local render / Claude CLI to the editor.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('flimify', {
  // The editor reads this to know it's running as the desktop app (vs the web
  // build) and can therefore use the local bridge + free-on-subscription model.
  isDesktop: true,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
