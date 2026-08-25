// Bar 主条渲染 v2：HUD + 像素舞台（主角 + NPC + 掉落物）+ 热点角标
(function () {
  let canvas, ctx;
  let stageW = 0, stageH = 0;
  let meX = 0;                       // 主角当前显示 x（缓动）
  const dropFx = new Map();          // uid -> 视觉状态
  let hotspotCycle = 0, hotspotT = 0;

  const tierColor = () => Engine.tierDef(App.state.tier).color;

  function init() {
    canvas = document.getElementById('stage');
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    document.querySelectorAll('#actions button').forEach((btn) => {
      btn.addEventListener('click', () => App.togglePanel(btn.dataset.panel));
    });
    canvas.addEventListener('click', onCanvasClick);
    requestAnimationFrame(loop);
  }

  function layout() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stageW = w; stageH = h;
  }

  function slotX(i, n) {
    const pad = 30;
    const w = stageW - pad * 2 - 40;   // 左侧让出主角位
    return pad + 40 + ((i + 0.5) * w) / Math.max(n, 1);
  }
  function groundY() { return stageH - 8; }
  function px() { return App.layout.scale; }
  function npcBaseY() { return groundY() - 16 * px(); }

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
    requestAnimationFrame(loop);
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
      ctx.font = "9px 'Microsoft YaHei', sans-serif";
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
    ctx.font = "9px 'Microsoft YaHei', sans-serif";
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
    for (const [uid, fx] of dropFx) {
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
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(fx.icon, fx.x, y);
    }
  }

  function drawBadge() {
    const st = App.state;
    let assets = 0;
    for (const id in st.npcs) if (st.npcs[id].asset) assets++;
    ctx.textAlign = 'left';
    ctx.font = "bold 10px 'Microsoft YaHei', sans-serif";
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
    ctx.font = "bold 10px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = '#e8c46a';
    ctx.fillText('热点·' + show.name, stageW - 8, 12);
    ctx.font = "9px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = '#8a8fa8';
    ctx.fillText(show.tags.join('/'), stageW - 8, 24);
  }

  // ── HUD ──
  function updateHud() {
    const st = App.state;
    const inc = Engine.expectedIncomePerSec(st);
    const shift = Engine.shiftInfo(st, Date.now());
    const total = inc + shift.wagePerSec;
    setText('hud-gold', '💰 ' + Engine.fmtMoney(st.gold));
    setText('hud-rep', '🏅 ' + Math.floor(st.rep));
    setText('hud-stam', '⚡ ' + Math.floor(st.stamina) + '/' + st.settings.staminaMax);
    setText('hud-inc', '收入 ' + Engine.fmtRate(total) + '/秒');
    const incEl = document.getElementById('hud-inc');
    if (incEl) {
      incEl.title = '资产期望 ' + Engine.fmtRate(inc) + '/秒'
        + (shift.wagePerSec > 0 ? ' + 工资 ' + Engine.fmtRate(shift.wagePerSec) + '/秒' : '');
    }
    const bar = document.getElementById('stam-bar');
    if (bar) bar.style.width = (st.stamina / st.settings.staminaMax) * 100 + '%';
    document.body.dataset.tier = st.tier;
  }
  function setText(id, v) {
    const el = document.getElementById(id);
    if (el && el.textContent !== v) el.textContent = v;
  }

  // ── 交互：先掉落物，后 NPC ──
  function onCanvasClick(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
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
