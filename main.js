const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const PANEL_H = 420;
const BAR_H = { 2: 76, 3: 96, 4: 120 };

let win = null;
let tray = null;
let panel = null;
let scale = 3;
let quitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showBar);
  app.whenReady().then(boot);
}

function cfgPath() { return path.join(app.getPath('userData'), 'cfg.json'); }
function savePath() { return path.join(app.getPath('userData'), 'save.json'); }

function loadCfg() {
  try { return JSON.parse(fs.readFileSync(cfgPath(), 'utf8')); } catch (e) { return {}; }
}
function writeCfg(cfg) {
  try { fs.writeFileSync(cfgPath(), JSON.stringify(cfg)); } catch (e) { /* ignore */ }
}

function barH() { return BAR_H[scale] || 96; }
function workArea() { return screen.getPrimaryDisplay().workArea; }

function bounds() {
  const a = workArea();
  const h = barH() + (panel ? PANEL_H : 0);
  return { x: a.x, y: a.y + a.height - h, width: a.width, height: h };
}

function applyBounds() {
  if (!win) return;
  win.setBounds(bounds());
  win.webContents.send('layout', { panel, scale, barH: barH(), panelH: PANEL_H });
}

function createWindow() {
  win = new BrowserWindow({
    ...bounds(),
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#12131c',
    title: '人脉圈 Alpha',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'src', 'bar.html'));
  win.once('ready-to-show', () => win.showInactive());
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); hideBar(); }
  });
}

function showBar() {
  if (!win) return;
  applyBounds();
  win.showInactive();
}
function hideBar() { if (win) win.hide(); }

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('人脉圈 Alpha');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: () => (win.isVisible() ? hideBar() : showBar()) },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', () => (win.isVisible() ? hideBar() : showBar()));
}

function boot() {
  const cfg = loadCfg();
  if (BAR_H[cfg.scale]) scale = cfg.scale;

  Menu.setApplicationMenu(null);
  createWindow();
  createTray();

  screen.on('display-metrics-changed', applyBounds);

  ipcMain.handle('panel:expand', (e, name) => {
    panel = name || null;
    applyBounds();
    return true;
  });
  ipcMain.handle('scale:set', (e, n) => {
    if (BAR_H[n]) { scale = n; writeCfg({ ...loadCfg(), scale: n }); applyBounds(); }
    return scale;
  });
  ipcMain.on('win:hide', hideBar);
  ipcMain.on('win:quit', () => { quitting = true; app.quit(); });

  ipcMain.handle('save:write', (e, text) => {
    const p = savePath();
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, p);
    return true;
  });
  ipcMain.handle('save:read', () => {
    try { return fs.readFileSync(savePath(), 'utf8'); } catch (e) { return null; }
  });
  ipcMain.handle('save:clear', () => {
    try { fs.rmSync(savePath(), { force: true }); } catch (e) { /* ignore */ }
    return true;
  });

  ipcMain.handle('autostart:set', (e, on) => {
    app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: true });
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('autostart:get', () => app.getLoginItemSettings().openAtLogin);
}

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* 常驻托盘，不退出 */ });
