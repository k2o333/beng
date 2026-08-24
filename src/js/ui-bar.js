// Bar 主条渲染：HUD + 像素舞台 + 功能按钮
(function () {
  let canvas, ctx;
  let stageW = 0, stageH = 0;

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
    const w = stageW - pad * 2;
    return pad + ((i + 0.5) * w) / Math.max(n, 1);
  }

  function groundY() { return stageH - 8; }
  function px() { return App.layout.scale; }

  function npcBaseY() { return groundY() - 16 * px(); }

  function loop() {
    const st = App.state;
    layout();
    drawBg();
    const slots = st.slots;
    for (let i = 0; i < slots.length; i++) {
      const def = NPC_BY_ID[slots[i]];
      if (!def) continue;
      drawNpc(def, slotX(i, slots.length), i);
    }
    drawBadge();
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
    // 地面
    ctx.fillStyle = '#1f2130';
    ctx.fillRect(0, groundY(), stageW, stageH - groundY());
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, groundY(), stageW, 1);
  }

  function drawNpc(def, x, i) {
    const st = App.state;
    const p = px();
    const by = npcBaseY();
    const frame = Math.floor(performance.now() / 460 + i * 0.7) % 2;
    Sprites.shadow(ctx, x - 6 * p, by + 15 * p, p);
    Sprites.draw(ctx, def, x - 6 * p, by, p, frame, false);
    // 头顶：名字 + 好感条
    const ns = Engine.npc(st, def.id);
    const bw = 52, bx = x - bw / 2, byy = by - 14;
    ctx.font = "9px 'Microsoft YaHei', sans-serif";
    ctx.textAlign = 'center';
    ctx.fillStyle = '#cfd3e8';
    ctx.fillText(def.name, x, byy - 2);
    ctx.fillStyle = '#000a';
    ctx.fillRect(bx, byy, bw, 5);
    ctx.fillStyle = Engine.tierDef(def.tier).color;
    ctx.fillRect(bx + 1, byy + 1, (bw - 2) * Math.min(1, ns.favor / 100), 3);
    ctx.fillStyle = '#8a8fa8';
    ctx.fillText(Math.floor(ns.favor) + '/100', x, byy + 14);
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

  // ── HUD ──
  function updateHud() {
    const st = App.state;
    const inc = Engine.incomePerSec(st);
    const rpm = Engine.repPerMin(st);
    setText('hud-gold', '💰 ' + Engine.fmtMoney(st.gold));
    setText('hud-rep', '🏅 ' + Math.floor(st.rep) + (rpm > 0 ? ' (+' + Engine.fmtRate(rpm) + '/分)' : ''));
    setText('hud-stam', '⚡ ' + Math.floor(st.stamina) + '/' + BALANCE.STAMINA_MAX);
    setText('hud-inc', '收入 ' + Engine.fmtRate(inc) + '/秒');
    const bar = document.getElementById('stam-bar');
    if (bar) bar.style.width = (st.stamina / BALANCE.STAMINA_MAX) * 100 + '%';
    document.body.dataset.tier = st.tier;
  }
  function setText(id, v) {
    const el = document.getElementById(id);
    if (el && el.textContent !== v) el.textContent = v;
  }

  // ── 交互 ──
  function onCanvasClick(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const slots = App.state.slots;
    for (let i = 0; i < slots.length; i++) {
      const x = slotX(i, slots.length);
      if (Math.abs(mx - x) < 8 * px()) { App.openPanel('gonglue', slots[i]); return; }
    }
  }

  function npcStageX(id) {
    const i = App.state.slots.indexOf(id);
    return i >= 0 ? slotX(i, App.state.slots.length) : stageW / 2;
  }

  window.UIBar = { init, npcStageX, updateHud };
})();
