const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const PANEL_H = 420;
const BAR_H = { 2: 76, 3: 96, 4: 120 };

// bar 形态配置：四边吸附 / 悬浮；缺省即首次安装形态（1/5 宽贴右下）
const BAR_SIDES = ['bottom', 'top', 'left', 'right', 'float'];
const BAR_DEF = { barSide: 'bottom', barAlign: 'end', barWRatio: 0.2, barFloat: null };
const BAR_WR_MIN = 0.2;
const BAR_SIDE_THICK = 140; // left/right 竖条横向厚度
const SNAP_PX = 24;         // 拖拽松手吸附阈值
const TICK_MS = 16;         // 光标轮询步进

let win = null;
let tray = null;
let panel = null;
let scale = 3;
let quitting = false;

// 光标轮询上下文：拖拽挪动 / 边缘调宽（主进程定时器跟手，避免 IPC 洪泛）
let dragTimer = null;
let dragCtx = null;
let rszTimer = null;
let rszCtx = null;

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
  try {
    const p = cfgPath();
    fs.writeFileSync(p + '.tmp', JSON.stringify(cfg));
    fs.renameSync(p + '.tmp', p);
  } catch (e) { /* ignore */ }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function clampWR(v) { return Number.isFinite(v) ? clamp(v, BAR_WR_MIN, 1) : BAR_DEF.barWRatio; }
function isXY(p) { return !!p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y); }
function saveBar(patch) { writeCfg({ ...loadCfg(), ...patch }); }

// 读取并规范化 bar 形态（旧 cfg 缺键按默认值处理）
function barCfg() {
  const c = loadCfg();
  return {
    barSide: BAR_SIDES.includes(c.barSide) ? c.barSide : BAR_DEF.barSide,
    barAlign: c.barAlign === 'start' ? 'start' : BAR_DEF.barAlign,
    barWRatio: clampWR(Number(c.barWRatio)),
    barFloat: isXY(c.barFloat) ? { x: c.barFloat.x, y: c.barFloat.y } : null
  };
}

function barH() { return BAR_H[scale] || 96; }

// 窗口当前所在显示器的工作区（窗口不可用时退化为光标所在显示器）
function activeWA() {
  const d = win
    ? screen.getDisplayMatching(win.getBounds())
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return d.workArea;
}

// 把矩形夹进工作区（多显示器不越界）
function clampRect(r, wa) {
  const w = Math.min(r.width, wa.width);
  const h = Math.min(r.height, wa.height);
  return {
    x: clamp(r.x, wa.x, wa.x + wa.width - w),
    y: clamp(r.y, wa.y, wa.y + wa.height - h),
    width: w,
    height: h
  };
}

// anchor(side+align) + 宽长比 → 窗口矩形；与 scale 缩放出的厚度正交组合
function computeBounds(wa, b) {
  const grow = panel ? PANEL_H : 0;
  if (b.barSide === 'left' || b.barSide === 'right') {
    const len = Math.round(clampWR(b.barWRatio) * wa.height);
    let x = b.barSide === 'left' ? wa.x : wa.x + wa.width - BAR_SIDE_THICK;
    let width = BAR_SIDE_THICK;
    if (grow) { // 竖条的面板向屏幕内侧横向展开
      width += grow;
      if (b.barSide === 'right') x -= grow;
    }
    const y = b.barAlign === 'start' ? wa.y : wa.y + wa.height - len;
    return clampRect({ x, y, width, height: len }, wa);
  }
  const len = Math.round(clampWR(b.barWRatio) * wa.width);
  const height = barH() + grow;
  if (b.barSide === 'float') {
    const f = b.barFloat || { x: wa.x + wa.width - len - 32, y: wa.y + wa.height - height - 32 };
    return clampRect({ x: f.x, y: f.y, width: len, height }, wa);
  }
  const x = b.barAlign === 'start' ? wa.x : wa.x + wa.width - len;
  const y = b.barSide === 'bottom' ? wa.y + wa.height - height : wa.y;
  return { x, y, width: len, height };
}

function bounds() { return computeBounds(activeWA(), barCfg()); }

// layout 快照：老字段全保留，扩展 side/align/wRatio
function layoutSnapshot() {
  const b = barCfg();
  return { panel, scale, barH: barH(), panelH: PANEL_H, side: b.barSide, align: b.barAlign, wRatio: b.barWRatio };
}
function broadcastLayout() { if (win) win.webContents.send('layout', layoutSnapshot()); }

function applyBounds() {
  if (!win) return;
  win.setBounds(computeBounds(activeWA(), barCfg()));
  broadcastLayout();
}

function stopPolling() {
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null; }
  if (rszTimer) { clearInterval(rszTimer); rszTimer = null; }
  dragCtx = null;
  rszCtx = null;
}

// 拖拽挪动：begin 起表跟手，end 做四边吸附判定 + 持久化一次 + 广播
function barDrag(phase) {
  if (!win) return layoutSnapshot();
  if (phase === 'begin') {
    stopPolling();
    const c = screen.getCursorScreenPoint();
    const g = win.getBounds();
    dragCtx = { ox: c.x - g.x, oy: c.y - g.y, w: g.width, h: g.height }; // 保持抓取点相对位置
    dragTimer = setInterval(() => {
      if (!win || !dragCtx) return stopPolling();
      const p = screen.getCursorScreenPoint();
      win.setBounds({
        x: Math.round(p.x - dragCtx.ox),
        y: Math.round(p.y - dragCtx.oy),
        width: dragCtx.w,
        height: dragCtx.h
      });
    }, TICK_MS);
  } else if (phase === 'end') {
    if (!dragCtx) return layoutSnapshot();
    const g = win.getBounds();
    stopPolling();
    dragSnap(g);
  }
  return layoutSnapshot();
}

// 松手吸附：距某边 <24px 贴该边（多边命中取最近），沿边位置过中点定 align；都不近则转悬浮
function dragSnap(r) {
  const wa = screen.getDisplayMatching(r).workArea;
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const cands = [
    { side: 'bottom', d: Math.abs(wa.y + wa.height - (r.y + r.height)), align: cx < wa.x + wa.width / 2 ? 'start' : 'end' },
    { side: 'top', d: Math.abs(r.y - wa.y), align: cx < wa.x + wa.width / 2 ? 'start' : 'end' },
    { side: 'left', d: Math.abs(r.x - wa.x), align: cy < wa.y + wa.height / 2 ? 'start' : 'end' },
    { side: 'right', d: Math.abs(wa.x + wa.width - (r.x + r.width)), align: cy < wa.y + wa.height / 2 ? 'start' : 'end' }
  ].filter((c) => c.d <= SNAP_PX).sort((a, b) => a.d - b.d);
  if (cands.length) {
    saveBar({ barSide: cands[0].side, barAlign: cands[0].align });
  } else {
    const rc = clampRect(r, wa);
    saveBar({ barSide: 'float', barFloat: { x: Math.round(rc.x), y: Math.round(rc.y) } });
  }
  applyBounds(); // 吸附后精确归位并广播
}

// 边缘拖拽调宽：沿长轴连续改长度（clamp 在 0.2~1 × 工作区轴长），end 才持久化比例
function barResize(p) {
  if (!win) return layoutSnapshot();
  const phase = p ? p.phase : null;
  const edge = p ? p.edge : null;
  const b = barCfg();
  const vert = b.barSide === 'left' || b.barSide === 'right';
  // 横条（bottom/top/float）用 l/r，竖条用 t/b；不符静默忽略
  if (!(vert ? edge === 't' || edge === 'b' : edge === 'l' || edge === 'r')) return layoutSnapshot();

  if (phase === 'begin') {
    stopPolling();
    const c = screen.getCursorScreenPoint();
    const g = win.getBounds();
    const wa = screen.getDisplayMatching(g).workArea;
    rszCtx = { vert, edge, max: vert ? wa.height : wa.width, x0: c.x, y0: c.y, bx: g.x, by: g.y, bw: g.width, bh: g.height };
    rszTimer = setInterval(() => {
      if (!win || !rszCtx) return stopPolling();
      const q = screen.getCursorScreenPoint();
      const t = rszCtx;
      let rect;
      if (t.vert) { // 对侧边固定，只改长度
        const len = clamp(Math.round(t.bh + (t.edge === 't' ? t.y0 - q.y : q.y - t.y0)), Math.round(BAR_WR_MIN * t.max), t.max);
        rect = { x: t.bx, y: t.edge === 't' ? t.by + t.bh - len : t.by, width: t.bw, height: len };
      } else {
        const len = clamp(Math.round(t.bw + (t.edge === 'l' ? t.x0 - q.x : q.x - t.x0)), Math.round(BAR_WR_MIN * t.max), t.max);
        rect = { x: t.edge === 'l' ? t.bx + t.bw - len : t.bx, y: t.by, width: len, height: t.bh };
      }
      win.setBounds(rect);
    }, TICK_MS);
  } else if (phase === 'end') {
    if (!rszCtx) return layoutSnapshot();
    const t = rszCtx;
    const g = win.getBounds();
    stopPolling();
    saveBar({ barWRatio: clampWR((t.vert ? g.height : g.width) / t.max) });
    applyBounds();
  }
  return layoutSnapshot();
}

function resetBarLayout() {
  saveBar(BAR_DEF);
  applyBounds();
  return layoutSnapshot();
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
    { label: '重置位置', click: () => resetBarLayout() },
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

  // 渲染层冷启动主动拉取一次（广播只发生在 applyBounds，早于脚本执行时会错过）
  ipcMain.handle('layout:get', () => layoutSnapshot());

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

  ipcMain.handle('bar:layout', (e, patch) => {
    const next = {};
    if (patch && typeof patch === 'object') {
      if (BAR_SIDES.includes(patch.barSide)) next.barSide = patch.barSide;
      if (patch.barAlign === 'start' || patch.barAlign === 'end') next.barAlign = patch.barAlign;
      if (Number.isFinite(patch.barWRatio)) next.barWRatio = clampWR(patch.barWRatio);
      if (isXY(patch.barFloat)) next.barFloat = { x: Math.round(patch.barFloat.x), y: Math.round(patch.barFloat.y) };
    }
    if (Object.keys(next).length) saveBar(next);
    applyBounds();
    return layoutSnapshot();
  });
  ipcMain.handle('bar:reset', () => resetBarLayout());
  ipcMain.handle('bar:drag', (e, phase) => barDrag(phase));
  ipcMain.handle('bar:resize', (e, p) => barResize(p));

  // 原生弹出菜单：条窗高度装不下 DOM 菜单（右键宽度档 / tiny 页签收纳）。
  // spec={items:[{label,value,checked,radio,sep}]}；返回被点项 value，点外关闭返回 null。
  ipcMain.handle('bar:nativemenu', (e, spec) => {
    const items = spec && Array.isArray(spec.items) ? spec.items : [];
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v === undefined ? null : v); } };
      const tpl = [];
      items.forEach((it) => {
        if (it.sep) { tpl.push({ type: 'separator' }); return; }
        tpl.push({
          label: String(it.label || ''),
          type: it.radio === false ? 'normal' : 'radio',
          checked: !!it.checked,
          click: () => done(it.value)
        });
      });
      Menu.buildFromTemplate(tpl).popup({
        window: win,
        callback: () => setTimeout(() => done(null), 0)
      });
    });
  });

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

app.on('before-quit', () => { quitting = true; stopPolling(); });
app.on('window-all-closed', () => { /* 常驻托盘，不退出 */ });
