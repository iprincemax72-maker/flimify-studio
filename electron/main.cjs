// Flimify Studio — Electron main process. Turns the Vite/React editor into a
// real desktop app window. This is also the process that (next) launches the
// bundled bridge and spawns the local Claude CLI — which is what preserves the
// "free on your own Claude subscription, no API key" model on desktop.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = !app.isPackaged;
const DEV_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5191';

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#0b0c0e',
    title: 'Flimify Studio',
    show: false,                         // show once the content is ready (no white flash)
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Open external links (e.g. sign-in) in the system browser, not in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  // Headless verification: FLIMIFY_CAPTURE=<png> → screenshot the loaded editor
  // a few seconds after load, then quit. Proves Electron opens + renders the UI.
  if (process.env.FLIMIFY_CAPTURE) {
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.FLIMIFY_CAPTURE, img.toPNG());
          console.log('[flimify] captured ' + process.env.FLIMIFY_CAPTURE);
        } catch (e) {
          console.error('[flimify] capture failed', e && e.message);
        }
        app.quit();
      }, 4000);
    });
  }

  return win;
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
