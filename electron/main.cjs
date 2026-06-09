// Flimify Studio — Electron main process. Opens the editor window AND launches
// the bundled studio-bridge (the local backend) as a child running on Electron's
// own Node — so the packaged app needs no system Node. The bridge is what spawns
// the local Claude CLI + renders, preserving the "free on your own subscription,
// no API key" model on desktop.
const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const isDev = !app.isPackaged;
const DEV_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5191';
let bridgeProc = null;
let mainWin = null;

// Launch the studio-bridge using THIS Electron binary in pure-Node mode
// (ELECTRON_RUN_AS_NODE) so no separate node install is required when packaged.
function startBridge() {
  const serverPath = path.join(__dirname, '..', 'studio-bridge', 'server.cjs');
  if (!fs.existsSync(serverPath)) { console.error('[main] studio-bridge not found at', serverPath); return; }
  bridgeProc = spawn(process.execPath, [serverPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridgeProc.stdout.on('data', (d) => process.stdout.write('[bridge] ' + d));
  bridgeProc.stderr.on('data', (d) => process.stderr.write('[bridge] ' + d));
  bridgeProc.on('exit', (code) => console.log('[main] bridge exited', code));
}
function stopBridge() { if (bridgeProc) { try { bridgeProc.kill(); } catch {} bridgeProc = null; } }

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#0b0c0e',
    title: 'Flimify Studio',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWin = win;
  win.once('ready-to-show', () => win.show());
  if (isDev) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  if (process.env.FLIMIFY_CAPTURE) {
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try { fs.writeFileSync(process.env.FLIMIFY_CAPTURE, (await win.webContents.capturePage()).toPNG()); console.log('[flimify] captured'); }
        catch (e) { console.error('[flimify] capture failed', e && e.message); }
        app.quit();
      }, 4000);
    });
  }
  return win;
}

// ── IPC the renderer (editor UI) uses, exposed via preload ──
ipcMain.handle('open-video', async () => {
  const r = await dialog.showOpenDialog(mainWin, {
    title: 'Import video',
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'] }],
  });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});
ipcMain.on('reveal-file', (_e, p) => { try { shell.showItemInFolder(p); } catch {} });

app.whenReady().then(() => { startBridge(); createWindow(); });
app.on('before-quit', stopBridge);
app.on('window-all-closed', () => { stopBridge(); if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
