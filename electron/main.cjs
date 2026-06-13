// Flimify Studio — Electron main process. Opens the editor window AND launches
// the bundled studio-bridge (the local backend) as a child running on Electron's
// own Node — so the packaged app needs no system Node. The bridge is what spawns
// the local Claude CLI + renders, preserving the "free on your own subscription,
// no API key" model on desktop.
const { app, BrowserWindow, shell, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const isDev = !app.isPackaged;
const DEV_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5191';
let bridgeProc = null;
let mainWin = null;

// ── SELF-UPDATE (writable overlay) ──────────────────────────────────────────
// The packaged app loads its frontend (dist) AND its bridge (server.cjs) from a
// WRITABLE folder, seeded from the app bundle on first run, then auto-synced from
// the local repo. So shipping a fix = rebuild dist in the repo — the running app
// picks it up within ~45s and hot-reloads, no reinstall / re-download. When the
// repo isn't present (a distributed copy on someone else's machine) it just keeps
// using the bundle. Only main.cjs/preload.cjs changes still need a real reinstall.
const LIVE_DIR = path.join(os.homedir(), 'FlimifyStudio', 'app');
const LIVE_DIST = path.join(LIVE_DIR, 'dist');
const LIVE_BRIDGE = path.join(LIVE_DIR, 'server.cjs');
const BUNDLED_DIST = path.join(__dirname, '..', 'dist');
const BUNDLED_BRIDGE = path.join(__dirname, '..', 'studio-bridge', 'server.cjs').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const UPDATE_SOURCE = process.env.FLIMIFY_UPDATE_SOURCE || path.join(os.homedir(), 'All Claude Work', 'flimify-studio');
const SRC_DIST = path.join(UPDATE_SOURCE, 'dist');
const SRC_BRIDGE = path.join(UPDATE_SOURCE, 'studio-bridge', 'server.cjs');
let _pendingUpdateToast = false;

function _copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) _copyDir(s, d); else fs.copyFileSync(s, d);
  }
}
const _read = (p) => { try { return fs.readFileSync(p); } catch { return null; } };
const _differs = (a, b) => { const x = _read(a), y = _read(b); if (!x || !y) return !!x !== !!y; return !x.equals(y); };
// Swap in a fresh dist atomically (tmp + rename) so a reload never reads a half-written bundle.
function _replaceDist(srcDist) {
  const tmp = LIVE_DIST + '.tmp';
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  _copyDir(srcDist, tmp);
  try { fs.rmSync(LIVE_DIST, { recursive: true, force: true }); } catch {}
  fs.renameSync(tmp, LIVE_DIST);
}
function seedOverlay() {
  try {
    if (!fs.existsSync(path.join(LIVE_DIST, 'index.html'))) {
      _replaceDist(BUNDLED_DIST); fs.copyFileSync(BUNDLED_BRIDGE, LIVE_BRIDGE);
    } else if (!fs.existsSync(path.join(SRC_DIST, 'index.html')) && _differs(path.join(LIVE_DIST, 'index.html'), path.join(BUNDLED_DIST, 'index.html'))) {
      // a freshly-installed .app (bundle differs, no repo to override) wins
      _replaceDist(BUNDLED_DIST); fs.copyFileSync(BUNDLED_BRIDGE, LIVE_BRIDGE);
    }
  } catch (e) { console.error('[update] seed failed:', e && e.message); }
}
function syncFromSource() {
  const out = { distChanged: false, bridgeChanged: false };
  try {
    const srcIdx = path.join(SRC_DIST, 'index.html');
    if (fs.existsSync(srcIdx) && _differs(srcIdx, path.join(LIVE_DIST, 'index.html'))) { _replaceDist(SRC_DIST); out.distChanged = true; }
    if (fs.existsSync(SRC_BRIDGE) && _differs(SRC_BRIDGE, LIVE_BRIDGE)) { fs.copyFileSync(SRC_BRIDGE, LIVE_BRIDGE); out.bridgeChanged = true; }
  } catch (e) { console.error('[update] sync failed:', e && e.message); }
  return out;
}
function applyUpdate(changed, announce) {
  if (changed.bridgeChanged) restartBridge();
  if (changed.distChanged && mainWin) { _pendingUpdateToast = true; try { mainWin.webContents.reload(); } catch {} }
  if (announce && !changed.distChanged && !changed.bridgeChanged) {
    try { dialog.showMessageBox(mainWin, { type: 'info', title: 'Flimify Studio', message: 'You’re on the latest version.', buttons: ['OK'] }); } catch {}
  } else if (announce) {
    try { dialog.showMessageBox(mainWin, { type: 'info', title: 'Flimify Studio', message: 'Updated to the latest version.', buttons: ['OK'] }); } catch {}
  }
}
// Active paths: prefer the writable overlay, fall back to the bundle.
const activeDistIndex = () => fs.existsSync(path.join(LIVE_DIST, 'index.html')) ? path.join(LIVE_DIST, 'index.html') : path.join(BUNDLED_DIST, 'index.html');
const activeBridge = () => fs.existsSync(LIVE_BRIDGE) ? LIVE_BRIDGE : BUNDLED_BRIDGE;

// Launch the studio-bridge using THIS Electron binary in pure-Node mode
// (ELECTRON_RUN_AS_NODE) so no separate node install is required when packaged.
function startBridge() {
  // In the packaged app the code lives inside app.asar; a Node script can't be
  // spawned from an asar path, so resolve to the unpacked copy (asarUnpack).
  const serverPath = activeBridge();
  if (!fs.existsSync(serverPath)) { console.error('[main] studio-bridge not found at', serverPath); return; }
  console.log('[main] starting bridge:', serverPath);
  bridgeProc = spawn(process.execPath, [serverPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridgeProc.stdout.on('data', (d) => process.stdout.write('[bridge] ' + d));
  bridgeProc.stderr.on('data', (d) => process.stderr.write('[bridge] ' + d));
  bridgeProc.on('exit', (code) => console.log('[main] bridge exited', code));
}
function stopBridge() { if (bridgeProc) { try { bridgeProc.kill(); } catch {} bridgeProc = null; } }
// Manual engine restart (Help → Restart Engine) — useful if the bridge wedges.
function restartBridge() {
  console.log('[main] restarting bridge…');
  stopBridge();
  setTimeout(() => {
    startBridge();
    try { mainWin && mainWin.webContents.send('engine-restarted'); } catch {}
  }, 400);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#0b0c0e',
    title: 'Flimify Studio',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
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
  else win.loadFile(activeDistIndex());

  // after a hot-update reload, tell the renderer so it can toast "Updated".
  win.webContents.on('did-finish-load', () => {
    if (_pendingUpdateToast) { _pendingUpdateToast = false; setTimeout(() => { try { win.webContents.send('app-updated'); } catch {} }, 700); }
  });

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

// Tell the renderer to run a menu action (Import / Export).
const sendMenu = (action) => mainWin && mainWin.webContents.send('menu', action);

function aboutBox() {
  dialog.showMessageBox(mainWin, {
    type: 'info',
    title: 'Flimify Studio',
    message: 'Flimify Studio',
    detail:
      `An AI-native video editor.\nGenerate motion graphics, auto-edit, caption, and export — all in one app.\n\n` +
      `Version ${app.getVersion()} · Electron ${process.versions.electron}\nRuns on your own Claude — no API key.`,
    buttons: ['Close', 'flimify.com'],
    defaultId: 0,
  }).then((r) => { if (r.response === 1) shell.openExternal('https://www.flimify.com'); });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { label: 'About Flimify Studio', click: aboutBox },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Import Video…', accelerator: 'CmdOrCtrl+I', click: () => sendMenu('import') },
        { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: () => sendMenu('export') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }])] },
    {
      role: 'help',
      submenu: [
        { label: 'Flimify Website', click: () => shell.openExternal('https://www.flimify.com') },
        { type: 'separator' },
        { label: 'Restart Engine', click: () => restartBridge() },
        { label: 'Check for Updates…', click: () => { if (isDev) return; applyUpdate(syncFromSource(), true); } },
        ...(isMac ? [] : [{ type: 'separator' }, { label: 'About', click: aboutBox }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
ipcMain.handle('restart-engine', () => { restartBridge(); return true; });

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png')); } catch {}
  }
  if (!isDev) { seedOverlay(); syncFromSource(); }   // make the overlay current BEFORE we load it
  buildMenu();
  startBridge();
  createWindow();
  // poll the repo for new builds and hot-apply them (no reinstall)
  if (!isDev) setInterval(() => { try { applyUpdate(syncFromSource(), false); } catch {} }, 45000);
});
app.on('before-quit', stopBridge);
app.on('window-all-closed', () => { stopBridge(); if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
