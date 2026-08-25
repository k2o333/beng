// Bar 主条渲染 v2：HUD + 像素舞台（主角 + NPC + 掉落物）+ 热点角标
// Wave1-B 响应式改造：side/wRatio 分档挂钩、窄条舞台滚动、NPC tooltip、
// 拖拽/调宽热区（grabber + 边缘 6px 热区）、右键宽度菜单
(function () {
  let canvas, ctx, wrap, barEl;
  let fadeL, fadeR, btnPrev, btnNext;
  let grabberEl, actMore, actMenu, ctxMenu;
  let stageW = 0, stageH = 0;
  let meX = 0;                       // 主角当前显示 x（缓动）
  const dropFx = new Map();          // uid -> 视觉状态
  let hotspotCycle = 0, hotspotT = 0;

  // ── bar 形态（主进程 layout 广播驱动；初值贴底全宽）──
  const SIDES = ['bottom', 'top', 'left', 'right', 'float'];
  const WR_PRESETS = [0.2, 1 / 3, 0.5, 1];
  const TYPE_TXT = { money: '金钱型', rep: '声望型', aux: '辅助型' };
  let barSide = 'bottom';
  let barWRatio = 1;
  let wrTier = 'full';               // tiny(≤0.21) / small(≤0.34) / full

  const tierColor = () => Engine.tierDef(App.state.tier).color;

  // api 防御调用（方法缺失/抛错/reject 均不阻塞渲染层）
  function callApi(name) {
    try {
      if (typeof api === 'undefined' || typeof api[name] !== 'function') return;
      const r = api[name].apply(null, Array.prototype.slice.call(arguments, 1));
      if (r && typeof r.catch === 'function') r.catch(() => {});
      return r;
    } catch (e) { /* 忽略 */ }
  }

  function wrBucket(r) {
    if (typeof r !== 'number' || !isFinite(r)) return 'full';
    return r <= 0.21 ? 'tiny' : (r <= 0.34 ? 'small' : 'full');
  }

  // 广播 → 分档 dataset（canvas 尺寸由每帧 layout() 自适应重算）
  function applyBarShape(d) {
    d = d || {};
    barSide = SIDES.indexOf(d.side) >= 0 ? d.side : 'bottom';       // 兜底贴底
    barWRatio = (typeof d.wRatio === 'number' && isFinite(d.wRatio)) ? d.wRatio : 1; // 兜底全宽
    wrTier = wrBucket(barWRatio);
    document.body.dataset.side = barSide;
    document.body.dataset.wr = wrTier;
    clearTipTimer();
    if (window.Tip) window.Tip.hide();
    hideMenus();
  }

  function init() {
    canvas = document.getElementById('stage');
    wrap = document.getElementById('stage-wrap');
    barEl = document.getElementById('bar');
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    applyBarShape(null);   // 首个广播到达前先落默认档

    // 页签按钮（仅直接子级；tiny 菜单里的克隆键单独绑，☰ 无 data-panel）
    document.querySelectorAll('#actions > button[data-panel]').forEach((btn) => {
      btn.addEventListener('click', () => App.togglePanel(btn.dataset.panel));
    });

    bindActMenu();
    bindStageScroll();
    bindMoveHandles();
    bindCtxMenu();

    canvas.addEventListener('click', onCanvasClick);
    canvas.addEventListener('mousemove', onStageMove);
    canvas.addEventListener('mouseleave', onStageLeave);

    // 点空白收起小菜单（捕获阶段，先于菜单自身 click）
    document.addEventListener('mousedown', (e) => {
      if (ctxMenu && !ctxMenu.classList.contains('hidden') && !ctxMenu.contains(e.target)) {
        closeCtxMenu();
      }
      if (actMenu && !actMenu.classList.contains('hidden')
        && !actMenu.contains(e.target) && e.target !== actMore) {
        hideActMenu();
      }
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenus(); });

    // 自留一份布局回调：记录 side/wRatio 并刷新分档 class
    if (typeof api !== 'undefined' && typeof api.onLayout === 'function') {
      api.onLayout(applyBarShape);
      // 冷启动补偿：首条广播可能早于本监听注册（applyBounds 先于 loadFile 完成），主动拉一次
      try {
        const p = api.getLayout();
        if (p && typeof p.then === 'function') p.then(applyBarShape).catch(() => {});
      } catch (e) { /* 忽略 */ }
    }

    requestAnimationFrame(loop);
  }

  // ── tiny 页签收纳：「☰」弹像素小菜单，沿用 data-panel ──
  function bindActMenu() {
    actMore = document.getElementById('act-more');
    actMenu = document.getElementById('act-menu');
    if (!actMore || !actMenu) return;
    actMore.addEventListener('click', (e) => {
      e.stopPropagation();
      actMenu.classList.toggle('hidden');
    });
    actMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-panel]');
      if (!btn) return;
      actMenu.classList.add('hidden');
      App.togglePanel(btn.dataset.panel);
    });
  }
  function hideActMenu() { if (actMenu) actMenu.classList.add('hidden'); }
  function closeCtxMenu() { if (ctxMenu) ctxMenu.classList.add('hidden'); }
  function hideMenus() { hideActMenu(); closeCtxMenu(); }

  // ── 舞台窄条滚动：滚轮纵→横、边缘箭头步进 ──
  function bindStageScroll() {
    fadeL = document.querySelector('#stage-box .fade-l');
    fadeR = document.querySelector('#stage-box .fade-r');
    btnPrev = document.querySelector('#stage-box .st-prev');
    btnNext = document.querySelector('#stage-box .st-next');
    wrap.addEventListener('wheel', (e) => {
      if (!e.deltaY) return;
      wrap.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
    if (btnPrev) btnPrev.addEventListener('click', () => { wrap.scrollLeft -= 150; });
    if (btnNext) btnNext.addEventListener('click', () => { wrap.scrollLeft += 150; });
  }
  let scrollUiKey = '';
  function syncScrollUi() {   // 有溢出才亮渐隐与箭头
    const sl = Math.round(wrap.scrollLeft);
    const max = Math.round(wrap.scrollWidth - wrap.clientWidth);
    const key = sl + '|' + max;
    if (key === scrollUiKey) return;
    scrollUiKey = key;
    const any = max > 2;
    const l = any && sl > 2;
    const r = any && sl < max - 2;
    fadeL.classList.toggle('show', l);
    fadeR.classList.toggle('show', r);
    btnPrev.classList.toggle('show', l);
    btnNext.classList.toggle('show', r);
  }

  // ── 拖拽挪动 / 边缘调宽：pointer capture 保证 begin/end 配对 ──
  function edgeOk(edge) {
    const vert = barSide === 'left' || barSide === 'right';
    return vert ? (edge === 't' || edge === 'b') : (edge === 'l' || edge === 'r');
  }
  function bindPress(el, begin, end) {
    if (!el) return;
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      clearTipTimer();
      if (window.Tip) window.Tip.hide();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      begin();
    });
    el.addEventListener('mouseup', (e) => { if (e.button === 0) end(); });
    el.addEventListener('pointercancel', () => end());
  }
  function bindMoveHandles() {
    grabberEl = document.getElementById('grabber');
    bindPress(grabberEl,
      () => callApi('barDrag', 'begin'),
      () => callApi('barDrag', 'end'));
    barEl.querySelectorAll('.rz').forEach((z) => {
      const edge = z.dataset.edge;
      bindPress(z,
        () => { if (edgeOk(edge)) callApi('barResize', 'begin', edge); },
        () => { if (edgeOk(edge)) callApi('barResize', 'end', edge); });
      z.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cycleWidthPreset();
      });
    });
  }
  // 双击热区：在四预设间循环到下一档
  function cycleWidthPreset() {
    if (typeof api === 'undefined' || typeof api.setBarLayout !== 'function') return;
    let idx = 0, best = Infinity;
    WR_PRESETS.forEach((p, i) => {
      const d = Math.abs(p - barWRatio);
      if (d < best) { best = d; idx = i; }
    });
    try {
      api.setBarLayout({ barWRatio: WR_PRESETS[(idx + 1) % WR_PRESETS.length] }).catch(() => {});
    } catch (e) { /* 忽略 */ }
  }

  // ── 右键 #bar：宽度四档勾选 + 重置位置 ──
  function bindCtxMenu() {
    ctxMenu = document.getElementById('ctx-menu');
    if (!ctxMenu || !barEl) return;
    barEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      clearTipTimer();
      if (window.Tip) window.Tip.hide();
      openCtxMenu(e.clientX, e.clientY);
    });
    ctxMenu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-wrp],[data-role]');
      if (!item) return;
      closeCtxMenu();
      if (item.dataset.wrp !== undefined) {
        const v = Number(item.dataset.wrp);
        if (isFinite(v)) callApi('setBarLayout', { barWRatio: v });
      } else if (item.dataset.role === 'reset') {
        callApi('resetBarLayout');
      }
    });
  }
  function openCtxMenu(x, y) {
    if (!ctxMenu) return;
    ctxMenu.querySelectorAll('[data-wrp]').forEach((it) => {
      it.classList.toggle('cur', Math.abs(Number(it.dataset.wrp) - barWRatio) < 0.03);
    });
    ctxMenu.classList.remove('hidden');
    const w = ctxMenu.offsetWidth || 140, h = ctxMenu.offsetHeight || 160;
    ctxMenu.style.left = Math.min(Math.max(4, x), window.innerWidth - w - 4) + 'px';
    ctxMenu.style.top = Math.min(Math.max(4, y), window.innerHeight - h - 4) + 'px';
  }

  // ── NPC 悬停 tooltip：全局轻量 div，跟随鼠标 + 视口翻转 ──
  const Tip = (function () {
    let el = null;
    function node() { if (!el) el = document.getElementById('tip'); return el; }
    function place(x, y) {
      const t = node();
      if (!t || t.classList.contains('hidden')) return;
      const w = t.offsetWidth || 0, h = t.offsetHeight || 0;
      let tx = x + 14, ty = y + 18;
      if (tx + w > window.innerWidth - 4) tx = x - w - 12;    // 右缘翻转
      if (ty + h > window.innerHeight - 4) ty = y - h - 12;   // 下缘翻转
      tx = Math.max(4, Math.min(tx, window.innerWidth - w - 4));
      ty = Math.max(4, Math.min(ty, window.innerHeight - h - 4));
      t.style.left = tx + 'px';
      t.style.top = ty + 'px';
    }
    function show(html, x, y) {
      const t = node();
      if (!t) return;
      t.innerHTML = html;
      t.classList.remove('hidden');
      place(x, y);
    }
    function move(x, y) { place(x, y); }
    function hide() { const t = node(); if (t) t.classList.add('hidden'); }
    return { show, move, hide };
  })();
  window.Tip = Tip;

  let tipTimer = null, tipId = null, tipXY = [0, 0];
  function clearTipTimer() { if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; } }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function tipHtml(id) {
    const def = NPC_BY_ID[id];
    if (!def || !App.state) return '';
    const ns = Engine.npc(App.state, id);
    const stageTxt = ns.asset ? '人脉资产' : ((Agent.stageOf(ns.favor) || {}).label || '');
    return '<b>' + esc(def.name) + '</b>'
      + '<span>' + (TYPE_TXT[def.type] || def.type) + '·T' + def.tier + '</span>'
      + '<span class="tip-fav">好感 ' + Math.floor(ns.favor) + '/100</span>'
      + (stageTxt ? '<span>阶段 ' + esc(stageTxt) + '</span>' : '');
  }
  // 鼠标 → 舞台内容坐标（计入横向滚动）
  function stagePoint(cx, cy) {
    const rect = wrap.getBoundingClientRect();
    return { x: cx - rect.left + wrap.scrollLeft, y: cy - rect.top };
  }
  function npcHitAt(cx, cy) {
    const st = App.state;
    if (!st || !st.slots.length) return null;
    const pt = stagePoint(cx, cy);
    const gy = groundY();
    const half = Math.max(12, 8 * px());
    for (let i = 0; i < st.slots.length; i++) {
      const x = slotX(i, st.slots.length);
      if (Math.abs(pt.x - x) <= half && pt.y > gy - 64 && pt.y < gy + 8) return st.slots[i];
    }
    return null;
  }
  function onStageMove(e) {
    const hit = npcHitAt(e.clientX, e.clientY);
    if (!hit) {
      if (tipId || tipTimer) { clearTipTimer(); tipId = null; Tip.hide(); }
      return;
    }
    tipXY = [e.clientX, e.clientY];
    if (hit !== tipId) {
      clearTipTimer();                       // 300ms 内出泡
      tipId = hit;
      tipTimer = setTimeout(() => {
        tipTimer = null;
        Tip.show(tipHtml(tipId), tipXY[0], tipXY[1]);
      }, 300);
    } else {
      Tip.move(tipXY[0], tipXY[1]);
    }
  }
  function onStageLeave() { clearTipTimer(); tipId = null; Tip.hide(); }

  function layout() {
    const dpr = window.devicePixelRatio || 1;
    const availW = wrap.clientWidth;
    const h = wrap.clientHeight;
    const need = needW(App.state ? App.state.slots.length : 0);
    const w = Math.max(availW, need);        // 内容宽 ≥ 容器宽，窄条时产生横向滚动
    const ws = w + 'px', hs = h + 'px';
    if (canvas.style.width !== ws) canvas.style.width = ws;
    if (canvas.style.height !== hs) canvas.style.height = hs;
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stageW = w; stageH = h;
  }

  function slotGap() { return Math.max(58, 15 * px()); }   // 相邻 NPC 最小间距，防重叠
  function needW(n) {
    if (!n) return 0;                    // 无槽位不强撑内容宽
    const pad = 30;
    return pad + 40 + n * slotGap() + pad;
  }
  function slotX(i, n) {
    const pad = 30;
    const w = stageW - pad * 2 - 40;   // 左侧让出主角位
    return pad + 40 + ((i + 0.5) * w) / Math.max(n, 1);
  }
  function groundY() { return stageH - 8; }
  function px() { return App.layout.scale; }
  function npcBaseY() { return groundY() - 16 * px(); }
  // 字号随档位微降（tiny -3 / small -1）
  function fsz(base) {
    const d = wrTier === 'tiny' ? 3 : (wrTier === 'small' ? 1 : 0);
    return Math.max(7, base - d);
  }

  function loop() {
    const st = App.state;
    if (!st) { requestAnimationFrame(loop); return; }
    layout();
    drawBg();
    drawMe();
    const slots = st.slots;
    for (let i = 0; i < slots.length; i++) {
      const def = NPC_BY_ID[slots[i]];
      if (!def) continue;
      drawNpc(def, slotX(i, slots.length), i);
    }
    drawDrops();
    drawBadge();
    drawHotspots();
    Fx.tick();
    Fx.draw(ctx);
    updateHud();
    syncScrollUi();
    syncTipVsOverlay();          // 弹窗盖屏时收起气泡
    requestAnimationFrame(loop);
  }

  let ovEl = null;
  function syncTipVsOverlay() {
    if (tipId === null) return;
    if (!ovEl) ovEl = document.getElementById('overlay');
    if (ovEl && !ovEl.classList.contains('hidden')) {
      clearTipTimer();
      tipId = null;
      Tip.hide();
    }
  }

  function drawBg() {
    const c = tierColor();
    const g = ctx.createLinearGradient(0, 0, 0, stageH);
    g.addColorStop(0, '#171826');
    g.addColorStop(1, '#101019');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, stageW, stageH);
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(0, 0, stageW, 3);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#1f2130';
    ctx.fillRect(0, groundY(), stageW, stageH - groundY());
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, groundY(), stageW, 1);
  }

  // ── 主角：在岗立于左端工位，下班缓动走向首个槽位 ──
  function drawMe() {
    const st = App.state;
    const duty = Engine.onDuty(st);
    const p = px();
    const by = npcBaseY();
    const targetX = duty ? 22 : (st.slots.length ? Math.max(22, slotX(0, st.slots.length) - 34) : 22);
    if (!meX) meX = targetX;
    meX += (targetX - meX) * 0.04;
    const frame = Math.floor(performance.now() / 460) % 2;
    Sprites.shadow(ctx, meX - 6 * p, by + 15 * p, p);
    Sprites.drawMe(ctx, meX - 6 * p, by, p, frame, duty);
    // 在岗头顶小标记
    if (duty) {
      ctx.font = fsz(9) + "px 'Microsoft YaHei', sans-serif";
      ctx.textAlign = 'center';
      ctx.fillStyle = '#8a8fa8';
      ctx.fillText('上班中', meX, by - 6);
    }
  }

  function drawNpc(def, x, i) {
    const st = App.state;
    const p = px();
    const by = npcBaseY();
    const frame = Math.floor(performance.now() / 460 + i * 0.7) % 2;
    Sprites.shadow(ctx, x - 6 * p, by + 15 * p, p);
    Sprites.draw(ctx, def, x - 6 * p, by, p, frame, false);
    const ns = Engine.npc(st, def.id);
    // 阶段角标（04 §6）
    let badge = '';
    if (!ns.asset) {
      const stg = Agent.stageOf(ns.favor);
      badge = { ice: '冰', warm: '暖', deep: '交', close: '网' }[stg.key] || '';
    } else badge = '资';
    const bw = 52, bx = x - bw / 2, byy = by - 14;
    ctx.font = fsz(9) + "px 'Microsoft YaHei', sans-serif";
    ctx.textAlign = 'center';
    ctx.fillStyle = '#cfd3e8';
    ctx.fillText(def.name, x, byy - 2);
    ctx.fillStyle = '#000a';
    ctx.fillRect(bx, byy, bw, 5);
    ctx.fillStyle = Engine.tierDef(def.tier).color;
    ctx.fillRect(bx + 1, byy + 1, (bw - 2) * Math.min(1, ns.favor / 100), 3);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e8c46a';
    ctx.fillText(badge, bx + bw + 2, byy + 5);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8a8fa8';
    ctx.fillText(Math.floor(ns.favor) + '/100', x, byy + 14);
  }

  // ── 掉落物（07 §3）：落地弹跳两次，3s 后自动入包或点击暴击 ──
  function spawnDrop(e) {
    const x = UIBar.npcStageX(e.id);
    dropFx.set(e.uid, { x, born: performance.now(), icon: iconOf(e) });
    if (dropFx.size > 24) {   // 防堆积
      const first = dropFx.keys().next().value;
      dropFx.delete(first);
    }
  }
  function iconOf(e) {
    if (e.kind === 'gold') return '💰';
    if (e.kind === 'letter') return '📜';
    if (e.kind === 'intel') return '🔎';
    return (ITEM_BY_ID[e.itemId] || {}).icon || '🎁';
  }
  function drawDrops() {
    const now = performance.now();
    const gy = groundY();
    for (const [, fx] of dropFx) {
      const t = (now - fx.born) / 1000;         // 秒
      const fall = Math.min(1, t / 0.9);
      // 下落 + 两次弹跳
      let y = -12 + fall * (gy - 26 + 12);
      if (fall >= 1) {
        const bt = t - 0.9;
        const hop = bt < 0.35 ? Math.sin(bt / 0.35 * Math.PI) * 10
          : bt < 0.7 ? Math.sin((bt - 0.35) / 0.35 * Math.PI) * 5 : 0;
        y = gy - 16 - hop;
      }
      ctx.font = fsz(13) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(fx.icon, fx.x, y);
    }
  }

  function drawBadge() {
    const st = App.state;
    let assets = 0;
    for (const id in st.npcs) if (st.npcs[id].asset) assets++;
    ctx.textAlign = 'left';
    ctx.font = 'bold ' + fsz(10) + "px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = '#6a7088';
    ctx.fillText('人脉资产 ' + assets, 6, 12);
  }

  // ── 热点日历角标（08 §5）──
  function drawHotspots() {
    const st = App.state;
    const list = (st.hotspot && st.hotspot.list) || [];
    if (!list.length) return;
    hotspotT += 1;
    if (hotspotT >= 240) { hotspotT = 0; hotspotCycle = (hotspotCycle + 1) % list.length; }
    const show = list[Math.min(hotspotCycle, list.length - 1)];
    ctx.textAlign = 'right';
    ctx.font = 'bold ' + fsz(10) + "px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = '#e8c46a';
    ctx.fillText('热点·' + show.name, stageW - 8, 12);
    ctx.font = fsz(9) + "px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = '#8a8fa8';
    ctx.fillText(show.tags.join('/'), stageW - 8, 24);
  }

  // ── HUD（按 wrTier 分档出文案）──
  function updateHud() {
    const st = App.state;
    if (!st) return;
    const inc = Engine.expectedIncomePerSec(st);
    const shift = Engine.shiftInfo(st, Date.now());
    const total = inc + shift.wagePerSec;
    const tiny = wrTier === 'tiny';
    setText('hud-gold', (tiny ? '💰' : '💰 ') + Engine.fmtMoney(st.gold));   // 万/亿紧凑缩写
    setText('hud-rep', '🏅 ' + Math.floor(st.rep));
    setText('hud-stam', tiny
      ? '⚡' + Math.floor(st.stamina)
      : '⚡ ' + Math.floor(st.stamina) + '/' + st.settings.staminaMax);
    // small 档收入去标签，tiny 整行隐藏
    setText('hud-inc', (wrTier === 'small' ? '' : '收入 ') + Engine.fmtRate(total) + '/秒');
    const incEl = document.getElementById('hud-inc');
    if (incEl) {
      incEl.title = tiny ? '' : '资产期望 ' + Engine.fmtRate(inc) + '/秒'
        + (shift.wagePerSec > 0 ? ' + 工资 ' + Engine.fmtRate(shift.wagePerSec) + '/秒' : '');
    }
    const repEl = document.getElementById('hud-rep');
    if (repEl) repEl.title = tiny ? '' : '声望值';
    const bar = document.getElementById('stam-bar');
    if (bar) bar.style.width = (st.stamina / st.settings.staminaMax) * 100 + '%';
    document.body.dataset.tier = st.tier;
  }
  function setText(id, v) {
    const el = document.getElementById(id);
    if (el && el.textContent !== v) el.textContent = v;
  }

  // ── 交互：先掉落物，后 NPC（坐标计入 scrollLeft）──
  function onCanvasClick(e) {
    const pt = stagePoint(e.clientX, e.clientY);
    const mx = pt.x, my = pt.y;
    // 掉落物命中（07：3s 内点中暴击 ×2）
    for (const [uid, fx] of dropFx) {
      if (Math.abs(mx - fx.x) < 14 && my > groundY() - 44) {
        const crit = (performance.now() - fx.born) <= BALANCE.LOOT.CRIT_MS;
        App.collectDrop(uid, crit);
        return;
      }
    }
    const slots = App.state.slots;
    for (let i = 0; i < slots.length; i++) {
      const x = slotX(i, slots.length);
      if (Math.abs(mx - x) < 8 * px()) { App.openPanel('gonglue', slots[i]); return; }
    }
  }

  // 每帧同步：移除已收集的视觉
  setInterval(() => {
    if (!App.state) return;
    const alive = new Set(App.state.drops.map((d) => d.uid));
    for (const uid of Array.from(dropFx.keys())) {
      if (!alive.has(uid)) {
        const fx = dropFx.get(uid);
        dropFx.delete(uid);
        void fx;
      }
    }
  }, 800);

  function npcStageX(id) {
    const st = App.state;
    const i = st.slots.indexOf(id);
    if (i >= 0 && st.slots.length) return slotX(i, st.slots.length);
    // 非槽位（资产掉落）：按 id 哈希稳定铺开，避免全部堆在中央
    let h = 0;
    for (let c = 0; c < id.length; c++) h = (h * 31 + id.charCodeAt(c)) >>> 0;
    return 50 + (h % 1000) / 1000 * Math.max(50, stageW - 100);
  }

  window.UIBar = { init, npcStageX, updateHud, spawnDrop };
})();
