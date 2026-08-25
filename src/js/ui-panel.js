// 面板渲染 v2：攻略/背包/工作/属性/圈层/设置/管理后台 七页 + 离线简报与确认弹窗
// 契约：docs/dev/v2-api.md §4
(function () {
  const TITLES = { gonglue: '攻略', beibao: '背包', gongzuo: '工作', shuxing: '属性', quanceng: '圈层', shezhi: '设置', houtai: '管理后台' };
  const TYPE_TXT = { money: '金钱型', rep: '声望型', aux: '辅助型' };
  const STATUS_TXT = { locked: '未解锁', available: '可攻略', courting: '攻略中', asset: '人脉资产' };
  const STAGE_BADGE = { ice: '破冰', warm: '升温', deep: '深交', close: '收网' };
  const Q_TXT = { common: '普通', fine: '精致', rare: '稀有' };

  // Wave2-U：分类页签 / 合成多选 / 详情弹窗（UI 侧状态，不入档）
  const BAG_TABS = [['all', '全部'], ['gift', '礼物'], ['consume', '消耗'], ['ticket', '票券'], ['func', '功能']];
  const KIND_TAB_MAP = {
    gift: ['send_gift', 'send_favor'],
    consume: ['stamina', 'favor_random', 'favor_all', 'rep'],
    ticket: ['free_date'],
    func: ['buff_date', 'buff_attr', 'unlock_next']
  };
  const ROSTER_TABS = [['all', '全部'], ['available', '可攻略'], ['courting', '攻略中'], ['asset', '人脉资产'], ['referred', '已引荐']];
  let bagTab = 'all';
  let rosterTab = 'all';
  let synthMode = false;
  let synthSel = {};       // invIdx -> 已选件数
  let synthBusy = false;   // 合成期间防重复点击
  let modalCtx = null;     // {kind:'item'|'npc', idx|id} 弹窗原地刷新用
  let resetScrollNext = false;

  let body = null;
  let titleEl = null;
  let cur = null;
  let keepScroll = 0;
  let confirmCb = null;
  let pendingOffline = null;

  function setBagTab(t) { bagTab = t; synthMode = false; synthSel = {}; resetScrollNext = true; App.refreshPanel(); }
  function setRosterTab(t) { rosterTab = t; resetScrollNext = true; App.refreshPanel(); }

  function nsOf(st, id) {
    return st.npcs[id] || { favor: 0, claimed: [], asset: false, referred: false };
  }
  function statusOf(st, def) {
    const s = st.npcs[def.id];
    if (s && s.asset) return 'asset';
    if (st.slots.indexOf(def.id) >= 0) return 'courting';
    if (def.tier <= st.tier || (s && s.referred)) return 'available';
    return 'locked';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function init() {
    body = document.getElementById('panel-body');
    titleEl = document.getElementById('panel-title');

    document.getElementById('panel-close').addEventListener('click', function () {
      App.handleAction('panel-close', this);
    });
    body.addEventListener('click', function (e) {
      const el = e.target.closest('[data-action]');
      if (el && body.contains(el)) App.handleAction(el.dataset.action, el);
    });
    body.addEventListener('change', function (e) {
      const el = e.target.closest('[data-set]');
      if (!el) return;
      let v = el.type === 'checkbox' ? el.checked : el.value;
      App.setSetting(el.dataset.set, v);
    });
    // 悬停 tooltip（window.Tip，B 侧全局组件；背包格与名册卡）
    body.addEventListener('mouseover', function (e) {
      const el = e.target.closest('[data-tip]');
      if (!el || !body.contains(el)) return;
      const html = tipHtmlFor(el.dataset.tip);
      if (html && window.Tip) window.Tip.show(html, e.clientX, e.clientY);
    });
    body.addEventListener('mousemove', function (e) {
      const el = e.target.closest('[data-tip]');
      const t = document.getElementById('tip');
      if (el && t && !t.classList.contains('hidden') && window.Tip) window.Tip.move(e.clientX, e.clientY);
    });
    body.addEventListener('mouseout', function (e) {
      const el = e.target.closest('[data-tip]');
      if (!el) return;
      const rel = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('[data-tip]') : null;
      if (rel === el) return;   // 同一格子内移动不闪断
      if (window.Tip) window.Tip.hide();
    });
    const card = document.getElementById('overlay-card');
    card.addEventListener('click', function (e) {
      const el = e.target.closest('[data-action]');
      if (!el || !card.contains(el)) return;
      if (el.dataset.action === 'confirm-ok' && confirmCb) {
        const cb = confirmCb;
        confirmCb = null;
        cb();
      }
      App.handleAction(el.dataset.action, el);
    });
  }

  function render(name) {
    cur = TITLES[name] ? name : null;
    if (!cur) {
      body.innerHTML = '';
      titleEl.textContent = '';
      return;
    }
    keepScroll = body.scrollTop;
    if (resetScrollNext) { keepScroll = 0; resetScrollNext = false; }
    titleEl.textContent = TITLES[cur];
    if (cur === 'gonglue') body.innerHTML = htmlGonglue();
    else if (cur === 'beibao') body.innerHTML = htmlBeibao();
    else if (cur === 'gongzuo') body.innerHTML = htmlGongzuo();
    else if (cur === 'shuxing') body.innerHTML = htmlShuxing();
    else if (cur === 'quanceng') body.innerHTML = htmlQuanceng();
    else if (cur === 'shezhi') body.innerHTML = htmlShezhi();
    else body.innerHTML = htmlHoutai();
    if (cur === 'gonglue') drawAvatars();
    body.scrollTop = keepScroll;
  }

  // ══ 攻略 ══
  function htmlGonglue() {
    const st = App.state;
    const S = st.settings;
    const duty = Engine.onDuty(st);
    let h = '<div class="slot-bar">';
    h += '<span class="slot-title">攻略槽 <b id="slot-count">' + st.slots.length + '/' + st.slotCount + '</b></span>';
    h += '<span class="slot-chips">';
    st.slots.forEach((id, i) => {
      const def = NPC_BY_ID[id];
      if (!def) return;
      h += '<span class="chip-slot" data-action="focus-npc" data-id="' + id + '">'
        + '<b class="chip-move" data-action="slot-move" data-id="' + id + '" data-dir="-1">↑</b>'
        + def.name + ' <i class="pct">' + Math.floor(nsOf(st, id).favor) + '%</i>'
        + '<b class="chip-move" data-action="slot-move" data-id="' + id + '" data-dir="1">↓</b>'
        + '<b class="chip-x" data-action="slot-remove" data-id="' + id + '">✕</b></span>';
    });
    h += '</span>';
    if (st.slotCount >= BALANCE.SLOTS_MAX) {
      h += '<button class="btn" disabled>已满</button>';
    } else {
      const price = Math.round(BALANCE.SLOT_COSTS[st.slotCount + 1] * S.priceRate);
      h += '<button class="btn primary" data-action="slot-expand"'
        + (st.gold < price ? ' disabled' : '') + '>扩容槽位 ' + Engine.fmtMoney(price) + '</button>';
    }
    h += '<div class="budget-line" id="budget-line">' + budgetText() + '</div>';
    h += '</div>';

    // 状态分类页签（3.3.2：跨圈层筛选，配合圈层分组头双维定位）
    h += tabsHtml(ROSTER_TABS, rosterTab, 'roster-tab');

    for (let t = 1; t <= BALANCE.TIERS.length; t++) {
      const td = Engine.tierDef(t);
      const open = Engine.tierOpen(st, t);
      const defs = NPCS.filter((def) => def.tier === t && rosterMatch(st, def));
      if (!defs.length && rosterTab !== 'all') continue;
      h += '<div class="tier-head' + (open ? '' : ' locked') + '">'
        + '<span class="tier-name">' + td.name + '</span>'
        + '<span class="tier-mult">产出 ×' + td.mult + '</span>';
      if (!open) {
        const c = Engine.canEnterTier(st, t);
        h += '<span class="tier-cond">'
          + (c.miss.length ? '需：' + c.miss.join('、') : '条件已达成，可入场') + '</span>';
      }
      h += '</div>';
      h += '<div class="roster-grid">';
      defs.forEach((def) => { h += cardHtml(st, def, open); });
      h += '</div>';
    }

    // 决策日志（04 §6）
    const logs = (st.log || []).slice(-Math.min(12, S.decisionLogDepth || 50)).reverse();
    h += '<div class="tier-head"><span class="tier-name">主角动态</span>'
      + '<span class="tier-mult">最近决策</span></div><ul class="dlog">';
    if (!logs.length) h += '<li class="dim">（主角还没花钱办事——放置中）</li>';
    logs.forEach((l) => {
      const mins = Math.floor((st.gt - l.gt) / 60000);
      h += '<li><i>' + (mins > 0 ? mins + '分前' : '刚刚') + '</i>' + esc(l.txt) + '</li>';
    });
    h += '</ul>';
    return h;
  }

  function budgetText() {
    const st = App.state;
    const S = st.settings;
    const parts = [];
    parts.push(S.dailyBudget > 0
      ? '今日预算 ' + Engine.fmtMoney(st.spent.global) + '/' + Engine.fmtMoney(S.dailyBudget)
      : '预算不限');
    parts.push('风格·' + ({ frugal: '节俭', standard: '标准', generous: '大方', lavish: '豪掷' }[S.spendStyle] || S.spendStyle));
    parts.push(Engine.onDuty(st) ? '在岗（只能动嘴）' : '下班（全动作）');
    if (st.buffs.attrHalf) parts.push('画册半价待用');
    if (st.gt < st.buffs.dateOffGt) parts.push('约会8折中');
    return parts.join(' · ');
  }

  // 网格卡片（3.3.2）：头像+名字+类型/tier+迷你好感条+状态文案；整卡点击开详情弹窗
  function rosterMatch(st, def) {
    if (rosterTab === 'all') return true;
    const status = statusOf(st, def);
    const ns = nsOf(st, def.id);
    if (rosterTab === 'referred') return !!ns.referred && status !== 'asset';
    return status === rosterTab;
  }

  function cardHtml(st, def, open) {
    const ns = nsOf(st, def.id);
    const status = statusOf(st, def);
    const tc = Engine.tierDef(def.tier).color;

    let h = '<div class="card' + (open ? '' : ' dimmed') + '" data-action="npc-open" data-id="' + def.id
      + '" data-tip="n:' + def.id + '">'
      + '<canvas class="avatar" width="48" height="32"></canvas>'
      + '<div class="info">'
      + '<div class="name-row"><span class="name">' + def.name + '</span>'
      + '<span class="chip type-' + def.type + '">' + TYPE_TXT[def.type] + '</span>'
      + '<span class="ttag">T' + def.tier + '</span>'
      + (ns.referred && !ns.asset ? '<span class="ref-badge">引荐</span>' : '') + '</div>'
      + '<div class="fav"><i style="width:' + Math.min(100, ns.favor) + '%;background:' + tc + '"></i></div>'
      + '<div class="favtext" data-role="favtext">' + favText(st, def, ns, status) + '</div>'
      + '</div>'
      + '</div>';
    return h;
  }

  function favText(st, def, ns, status) {
    let t = Math.floor(ns.favor) + '/' + BALANCE.FAVOR_MAX + ' · ' + STATUS_TXT[status];
    if (status === 'courting' && !ns.asset) {
      const stg = Agent.stageOf(ns.favor);
      t += ' · ' + STAGE_BADGE[stg.key] + '期（目标 ' + stg.goal + '）';
      const pr = Agent.pauseReason(st, def.id);
      if (pr) t += ' · 暂缓：' + pr;
    }
    return esc(t);
  }

  // 档案卡六行（03 §3）：详情弹窗与旧展开区共用
  function npcDossierHtml(st, def, ns) {
    const dos = TEXTS.dossier[def.id] || { bio: '', value: '' };
    const intel = st.intel[def.id] || {};
    const tags = def.tags.concat(intel.third ? ['+' + def.third] : []);
    // 档案：【产出】【引荐】【成本】动态生成
    const gps = BALANCE.BASE_OUTPUT[def.type] * Engine.tierDef(def.tier).mult * def.coef;
    let outputTxt;
    if (def.type === 'rep') outputTxt = '声望手札 +' + BALANCE.LOOT.LETTER_REP[def.tier]
      + '/次（间隔×2）＋ 金币包期望 ' + Engine.fmtMoney(gps * 3600) + '/时';
    else outputTxt = '金币包期望 ' + Engine.fmtMoney(gps * 3600) + '/时，偶尔回赠物品';
    if (def.type === 'aux') outputTxt += '；全队好感 +5%/资产';
    const referTxt = def.refer ? '满级引荐 ' + NPC_BY_ID[def.refer].name
      + '（' + Engine.fmtMoney(BALANCE.BASE_OUTPUT[NPC_BY_ID[def.refer].type] * Engine.tierDef(NPC_BY_ID[def.refer].tier).mult * NPC_BY_ID[def.refer].coef * 3600) + '金/时）' : '无';
    const midPrice = Engine.priceOf(st, 'gift', 'mid', def.tier);
    const costTxt = '矜持 ×' + Engine.tierDef(def.tier).restraint + ' · 中礼基准 ' + Engine.fmtMoney(midPrice);

    let h = '<div class="dossier"><b>【小传】</b>' + esc(dos.bio) + '</div>';
    h += '<div class="dossier"><b>【产出】</b>' + outputTxt + '</div>';
    h += '<div class="dossier"><b>【引荐】</b>' + referTxt + '</div>';
    h += '<div class="dossier"><b>【成本】</b>' + costTxt + '</div>';
    h += '<div class="dossier"><b>【偏好】</b>' + tags.map(esc).join('、')
      + (intel.line ? '（引荐线索已揭示）' : '')
      + (intel.mine ? ' <i class="mine">雷区：' + esc(def.mine) + '</i>' : '') + '</div>';
    h += '<div class="dossier gold"><b>【一句价值】</b>' + esc(dos.value) + '</div>';
    return h;
  }

  function spendMenu(st, def, ns) {
    const duty = Engine.onDuty(st);
    const over = Engine.overLine(st, def.id);
    let h = '<div class="menu-row"><span class="menu-label">送礼</span>';
    ['small', 'mid', 'large'].forEach((size) => {
      const g = BALANCE.GIFTS[size];
      const need = BALANCE.LARGE_TASTE[def.tier];
      const cost = Engine.priceOf(st, 'gift', size, def.tier);
      const dis = duty || over || (size === 'large' && st.attrs.taste < need) || st.gold < cost;
      const tip = size === 'large' && st.attrs.taste < need ? '品味 ≥' + need + ' 才送得出手' : '';
      h += '<button class="btn" data-action="gift" data-size="' + size + '" data-id="' + def.id + '"'
        + (dis ? ' disabled' : '') + (tip ? ' title="' + tip + '"' : '') + '>'
        + g.label + ' +' + g.favor + '｜' + Engine.fmtMoney(cost) + '</button>';
    });
    h += '</div>';

    [['light', '轻约'], ['meal', '正餐'], ['trip', '远行']].forEach(([kind, label]) => {
      const gate = BALANCE.SPEND.date[kind].unlockFavor;
      const locked = gate && ns.favor < gate;
      h += '<div class="menu-row"><span class="menu-label">' + label
        + ' +' + BALANCE.SPEND.date[kind].favor
        + (gate ? '<i class="dim">（好感≥' + gate + '）</i>' : '') + '</span>';
      BALANCE.SPEND.VARIANTS[kind].forEach((v, vi) => {
        const m = Engine.matchTags(st, def, v.tags);
        const best = Engine.bestVariantIdx(st, def, kind) === vi;
        const cost = Engine.priceOf(st, 'date', kind, def.tier, vi);
        const dis = duty || over || locked || st.gold < cost;
        h += '<button class="btn' + (m.hit ? ' match' : '') + '" data-action="date" data-kind="' + kind
          + '" data-v="' + vi + '" data-id="' + def.id + '"' + (dis ? ' disabled' : '')
          + ' title="' + v.tags.join('/') + (m.hit ? ' 投其所好 ×' + m.coef : ' 错配 ×' + m.coef) + '">'
          + (m.mine ? '☠ ' : best ? '★ ' : '') + v.name + '｜' + Engine.fmtMoney(cost) + '</button>';
      });
      h += '</div>';
    });

    const used = st.errandUsed[def.id];
    const eGate = BALANCE.SPEND.errand.unlockFavor;
    const eCost = Engine.priceOf(st, 'errand', null, def.tier);
    const eDis = duty || over || used || ns.favor < eGate || st.gold < eCost;
    h += '<div class="menu-row"><span class="menu-label">办事'
      + (used ? '<i class="dim">（已用过）</i>' : '<i class="dim">（每人一次）</i>') + '</span>'
      + '<button class="btn" data-action="errand" data-id="' + def.id + '"' + (eDis ? ' disabled' : '')
      + ' title="好感≥' + eGate + ' 解锁，一次性 +60">办事 +' + BALANCE.SPEND.errand.favor
      + '｜' + Engine.fmtMoney(eCost) + '</button></div>';

    // 免费渠道补充
    const cd = st.cds[def.id] || {};
    h += '<div class="menu-row"><span class="menu-label">免费</span>';
    h += '<button class="btn" data-action="moments" data-id="' + def.id + '"'
      + (cd.mo > st.gt ? ' disabled' : '') + '>朋友圈 +1</button>';
    h += '<button class="btn" data-action="workplace" data-id="' + def.id + '"'
      + (!Engine.onDuty(st) || def.tier > 1 || cd.wp > st.gt ? ' disabled title="仅 T1 同事·在岗时段"' : '')
      + '>职场 +3</button>';
    h += '</div>';
    return h;
  }

  function drawAvatars() {
    body.querySelectorAll('.card').forEach(function (cardEl) {
      const def = NPC_BY_ID[cardEl.dataset.id];
      const cv = cardEl.querySelector('canvas.avatar');
      if (!def || !cv) return;
      Sprites.drawHead(cv.getContext('2d'), def, 0, 0, 4);
    });
  }

  // ══ 背包（3.3.1：网格 + 分类页签 + 堆叠 + 合成）══
  function tabsHtml(defs, curTab, act) {
    let h = '<div class="page-tabs">';
    defs.forEach(([v, label]) => {
      h += '<button class="btn' + (v === curTab ? ' on' : '') + '" data-action="' + act + '" data-t="' + v + '">'
        + label + '</button>';
    });
    return h + '</div>';
  }

  function invEntry(st, idx) {
    const e = st.inv[idx];
    return e && ITEM_BY_ID[e.it] ? e : null;
  }

  function htmlBeibao() {
    const st = App.state;
    const cap = Engine.invCap(st);
    let h = '<div class="set-label">背包 ' + st.inv.length + '/' + cap + ' 格'
      + '（同名同品质堆叠 ×99；满了优先挤普通品质；出售折价 30%）</div>';

    h += tabsHtml(BAG_TABS, bagTab, 'bag-tab');

    // 合成条：多选凑满 3 件同品质 → 高一档随机物品（next-iteration §1）
    const selTotal = selUnits();
    const selGrade = selGradeOf(st);
    const canSynth = !synthBusy && selTotal === BALANCE.SYNTH.NEED && !!selGrade && selGrade !== 'rare';
    h += '<div class="synth-bar">';
    h += '<button class="btn toggle' + (synthMode ? ' on' : '') + '" data-action="synth-toggle">合成 3合1</button>';
    if (synthMode) {
      h += '<span class="hint">点选物品凑满 ' + BALANCE.SYNTH.NEED + ' 件同品质（当前 '
        + selTotal + (selGrade ? ' · ' + Q_TXT[selGrade] : '') + '）</span>';
      h += '<button class="btn" data-action="synth-clear"' + (selTotal ? '' : ' disabled') + '>清空</button>';
      h += '<button class="btn primary" data-action="synth-run"' + (canSynth ? '' : ' disabled') + '>合成'
        + (selGrade && selGrade !== 'rare' ? ' → ' + Q_TXT[BALANCE.NEXT_GRADE[selGrade]] : '') + '</button>';
    }
    h += '</div>';

    const list = [];
    st.inv.forEach((e, idx) => {
      const it = ITEM_BY_ID[e.it];
      if (!it) return;
      if (bagTab !== 'all' && (KIND_TAB_MAP[bagTab] || []).indexOf(it.effect.kind) < 0) return;
      list.push({ e, idx, it });
    });
    if (!list.length) {
      h += '<div class="lock-line">' + (st.inv.length
        ? '该分类下暂无物品——换个页签看看。'
        : '空空如也——人脉资产会随机掉落物品，约会惊喜与 NPC 回礼也会送东西。') + '</div>';
    } else {
      h += '<div class="bag-grid">';
      list.forEach(({ e, idx, it }) => {
        const n = e.n || 1;
        const picked = synthSel[idx] || 0;
        h += '<div class="bag-cell q-' + e.q + (picked ? ' sel' : '') + '"'
          + ' data-action="' + (synthMode ? 'synth-pick' : 'item-open') + '" data-idx="' + idx + '"'
          + ' data-tip="i:' + idx + '">'
          + it.icon
          + (n > 1 ? '<b class="n">' + n + '</b>' : '')
          + (picked ? '<b class="pk">×' + picked + '</b>' : '')
          + '</div>';
      });
      h += '</div>';
    }
    return h;
  }

  function selUnits() {
    let s = 0;
    for (const k in synthSel) s += synthSel[k];
    return s;
  }
  function selGradeOf(st) {
    for (const k in synthSel) {
      const e = st.inv[k];
      if (e) return e.q;
    }
    return null;
  }

  function synthToggle() { synthMode = !synthMode; synthSel = {}; resetScrollNext = true; App.refreshPanel(); }
  function synthClear() { synthSel = {}; App.refreshPanel(); }
  function synthPick(idx) {
    const st = App.state;
    const e = invEntry(st, idx);
    if (!e) return;
    const n = e.n || 1;
    const curPicked = synthSel[idx] || 0;
    if (curPicked > 0 && (curPicked >= n || selUnits() >= BALANCE.SYNTH.NEED)) delete synthSel[idx];
    else if (curPicked < n && selUnits() < BALANCE.SYNTH.NEED) synthSel[idx] = curPicked + 1;
    App.refreshPanel();
  }
  function synthRun() {
    if (synthBusy) return;
    const st = App.state;
    const grade = selGradeOf(st);
    if (selUnits() !== BALANCE.SYNTH.NEED || !grade || grade === 'rare') return;
    const picks = [];
    for (const k in synthSel) picks.push({ i: Number(k), n: synthSel[k] });
    synthBusy = true;
    let r;
    try { r = Engine.synthItems(st, picks, Math.random); } finally { synthBusy = false; }
    if (r.ok) {
      synthSel = {};
      App.eventFx([{ t: 'synth', txt: r.txt }]);
      App.save();
    } else {
      App.notify(r.msg || '合成失败', 2200);
    }
    App.refreshPanel();
    UIBar.updateHud();
  }

  // 悬停 tooltip 数据源（3.3.3：轻量 div，数据取自 dossier/items）
  function tipHtmlFor(spec) {
    const st = App.state;
    if (!st) return '';
    const colon = spec.indexOf(':');
    const kind = spec.slice(0, colon);
    const key = spec.slice(colon + 1);
    if (kind === 'i') {
      const e = invEntry(st, Number(key));
      if (!e) return '';
      const it = ITEM_BY_ID[e.it];
      return '<b>' + esc(it.label) + '</b>'
        + '<span>' + Q_TXT[e.q] + ' · ' + esc(it.desc) + '</span>'
        + '<span class="tip-fav">售价 ' + Engine.fmtMoney(Engine.sellUnitPrice(it)) + '/件'
        + ((e.n || 1) > 1 ? ' · ×' + e.n : '') + '</span>';
    }
    if (kind === 'n') {
      const def = NPC_BY_ID[key];
      if (!def) return '';
      const ns = nsOf(st, def.id);
      const status = statusOf(st, def);
      return '<b>' + esc(def.name) + '</b>'
        + '<span>' + TYPE_TXT[def.type] + '·T' + def.tier + ' · ' + STATUS_TXT[status] + '</span>'
        + '<span class="tip-fav">好感 ' + Math.floor(ns.favor) + '/100</span>';
    }
    return '';
  }

  // ══ 工作 ══
  function htmlGongzuo() {
    const st = App.state;
    const shift = Engine.shiftInfo(st, Date.now());
    let h = '<div class="attr-row"><div class="attr-info">'
      + '<div class="attr-name">当前状态</div>';
    if (shift.jobId) {
      h += '<div class="attr-desc">' + BALANCE.JOBS[shift.jobId].label
        + ' · 时薪 ' + BALANCE.JOBS[shift.jobId].wage + ' 元（体力 ' + BALANCE.JOBS[shift.jobId].staminaPerH + '/时）</div>';
      h += '<div class="attr-effect">';
      if (shift.onDuty) {
        h += shift.resting
          ? '<span class="lack">体力见底歇业中，恢复到 ' + Math.round(BALANCE.WORK_REST_RESUME * 100) + '% 自动复岗</span>'
          : '上班中 · 剩余 <b id="shift-left">' + fmtLeft(shift.endInMs) + '</b> · 时薪折 '
            + Engine.fmtRate(shift.wagePerSec) + '/秒';
      } else {
        h += '未排班——排一班就有稳定现金流（收入 &lt; 资产零头，纯兜底）';
      }
      h += '</div>';
    } else {
      h += '<div class="attr-desc">失业中。打工人的向上故事，从一份基础工作开始。</div>';
    }
    h += '<div class="attr-effect">累计工资：' + Engine.fmtMoney(st.stats.totalWage) + ' 元</div>';
    h += '</div><div class="ops">';
    if (shift.jobId) {
      if (!shift.onDuty) {
        BALANCE.SHIFT_H.forEach((hrs) => {
          h += '<button class="btn primary" data-action="shift-start" data-h="' + hrs + '">上' + hrs + '小时</button>';
        });
      }
      h += '<button class="btn" data-action="shift-stop">下班</button>';
      h += '<button class="btn danger" data-action="job-quit">辞职</button>';
    }
    h += '</div></div>';

    // 入职列表
    h += '<div class="set-label">工作机会</div>';
    Object.keys(BALANCE.JOBS).forEach((jid) => {
      const j = BALANCE.JOBS[jid];
      const lockedByAsset = j.unlockAssets && Engine.auxAssets(st) < j.unlockAssets;
      const curJob = st.job.id === jid;
      h += '<div class="attr-row' + (curJob ? ' current' : '') + '"><div class="attr-info">'
        + '<div class="attr-name">' + j.label + (curJob ? '<span class="lv">在职</span>' : '') + '</div>'
        + '<div class="attr-desc">时薪 ' + j.wage + ' 元 · 体力 ' + j.staminaPerH + '/时'
        + (j.eveningMul ? ' · 现实 18-22 点晚班 ×' + j.eveningMul : '')
        + (j.tipChance ? ' · 小概率小费' : '')
        + (j.offlineMul ? ' · 离线挂班 +' + Math.round((j.offlineMul - 1) * 100) + '%' : '')
        + '</div></div>';
      if (!curJob) {
        h += '<button class="btn primary" data-action="job-hire" data-job="' + jid + '"'
          + (lockedByAsset ? ' disabled title="需累计资产 ≥' + j.unlockAssets + '"' : '') + '>'
          + (lockedByAsset ? '需资产≥' + j.unlockAssets : '入职') + '</button>';
      }
      h += '</div>';
    });

    // 体力分配（02 §4.2）
    const PRIO = { work_first: '先工作后社交', ratio: '比例分配', social_first: '先社交后工作' };
    h += '<div class="set-group"><div class="set-label">体力分配（上班与社交抢体力）</div><div class="set-row">';
    Object.keys(PRIO).forEach((k) => {
      h += '<button class="btn' + (st.priority === k ? ' primary' : '') + '" data-action="priority-set" data-p="' + k
        + '">' + PRIO[k] + '</button>';
    });
    h += '</div></div>';
    return h;
  }
  function fmtLeft(ms) {
    const m = Math.ceil(ms / 60000);
    return m >= 60 ? Math.floor(m / 60) + '小时' + (m % 60) + '分' : m + '分钟';
  }

  // ══ 属性 ══
  function htmlShuxing() {
    const st = App.state;
    const pct = Math.round(BALANCE.ATTR_EFFECT * 100);
    const rows = [
      { key: 'charm', name: '魅力', desc: '每级 +' + pct + '% 自动好感',
        eff: '自动好感 +' + Math.round(pct * st.attrs.charm) + '%' },
      { key: 'talk', name: '谈吐', desc: '每级 +' + pct + '% 互动收益',
        eff: '互动收益 +' + Math.round(pct * st.attrs.talk) + '%' },
      { key: 'taste', name: '品味', desc: '高圈层门槛与大礼解锁', eff: '' }
    ];
    let h = '';
    rows.forEach(function (r) {
      const lv = st.attrs[r.key];
      const cost = Engine.attrCost(lv, st.settings.priceRate);
      const half = st.buffs.attrHalf;
      h += '<div class="attr-row"><div class="attr-info">'
        + '<div class="attr-name">' + r.name + '<span class="lv">Lv.' + lv + '</span></div>'
        + '<div class="attr-desc">' + r.desc + '</div>'
        + (r.eff ? '<div class="attr-effect">当前效果：' + r.eff + '</div>' : '');
      if (r.key === 'taste' && st.tier < BALANCE.TIERS.length) {
        h += '<div class="attr-effect">下一圈层门槛：品味 ' + BALANCE.TIERS[st.tier].taste + '</div>';
      }
      h += '</div><button class="btn primary" data-action="attr-up" data-key="' + r.key
        + '" data-cost="' + cost + '"' + (st.gold < cost ? ' disabled' : '')
        + '>升级 ' + Engine.fmtMoney(cost) + (half ? ' <s>5折</s>已备' : '') + '</button></div>';
    });
    // 成就分组（next-iteration §2）：达成即永久被动
    h += '<div class="set-group"><div class="set-label">成就（达成即永久被动，账号级生效）</div>';
    BALANCE.ACHIEVEMENTS.forEach(function (a) {
      const lit = !!st.perks[a.id];
      const v = a.stat === 'assets' ? Engine.assetCount(st) : (st.stats[a.stat] || 0);
      const prog = a.stat === 'totalWorkMs'
        ? Math.floor(v / 3600000) + '/' + Math.round(a.goal / 3600000) + ' 小时'
        : Math.floor(v) + '/' + a.goal;
      h += '<div class="ach-row' + (lit ? ' lit' : ' locked') + '"><div class="ai">'
        + '<b>' + a.name + '</b><i class="qtag ' + (lit ? 'q-rare' : '') + '">' + (lit ? '已达成' : '未达成') + '</i>'
        + '<em>' + esc(a.desc) + '（进度 ' + prog + '）</em>'
        + '<em class="perk">被动：' + esc(a.perkText) + (lit ? ' · 生效中' : '') + '</em>'
        + (a.flavor ? '<em class="flavor">' + esc(a.flavor) + '</em>' : '')
        + '</div></div>';
    });
    h += '</div>';

    h += '<div class="set-row" style="margin-top:10px">'
      + '<button class="btn" data-action="admin-open">管理后台（导演模式）</button></div>';
    return h;
  }

  // ══ 圈层（沿用 v1）══
  function htmlQuanceng() {
    const st = App.state;
    let h = '';
    BALANCE.TIERS.forEach(function (td) {
      const t = td.id;
      let cls = 'tier-row';
      let stateHtml = '';
      if (t < st.tier) {
        cls += ' done';
        stateHtml = '<span>✅ 已通过</span>';
      } else if (t === st.tier) {
        cls += ' current';
        stateHtml = '<span class="cur">★ 当前</span>';
      } else if (t === st.tier + 1) {
        stateHtml = '<ul class="tier-req">'
          + '<li class="' + (st.rep >= td.rep ? '' : 'lack') + '">声望 ' + Math.floor(st.rep) + '/' + td.rep + '</li>'
          + '<li class="' + (st.gold >= td.fee ? '' : 'lack') + '">入场费 ' + Engine.fmtMoney(td.fee) + '</li>'
          + '<li class="' + (st.attrs.taste >= td.taste ? '' : 'lack') + '">品味 ' + st.attrs.taste + '/' + td.taste + '</li>'
          + '</ul>';
        if (Engine.canEnterTier(st, t).ok) {
          stateHtml += '<button class="btn primary" data-action="tier-enter" data-tier="' + t + '">支付入场并进入</button>';
        }
      } else {
        cls += ' unknown';
        stateHtml = '<span>??? 未知的上层</span>';
      }
      const shownName = cls.indexOf('unknown') >= 0 ? '???' : td.name;
      h += '<div class="' + cls + '">'
        + '<div class="tier-cell"><div class="tier-name">' + shownName + '</div>'
        + '<div class="tier-mult">产出 ×' + td.mult + '</div></div>'
        + '<div class="tier-state">' + stateHtml + '</div>'
        + '</div>';
    });
    return h;
  }

  // ══ 设置 ══
  function htmlShezhi() {
    const st = App.state;
    let h = '<div class="set-group"><div class="set-label">像素缩放</div><div class="set-row">';
    [2, 3, 4].forEach(function (n) {
      h += '<button class="btn' + (App.layout.scale === n ? ' primary' : '')
        + '" data-action="scale-set" data-n="' + n + '">×' + n + '</button>';
    });
    h += '</div></div>';

    h += '<div class="set-group"><div class="set-label">界面与通知</div><div class="set-row">'
      + '<label class="check"><input type="checkbox" data-set="autoPickup"'
      + (st.settings.autoPickup ? ' checked' : '') + '> 掉落物自动拾取（关闭可手动点击暴击×2）</label>'
      + '<label class="check">通知 <select data-set="notifyLevel">'
      + '<option value="all"' + (st.settings.notifyLevel === 'all' ? ' selected' : '') + '>全部</option>'
      + '<option value="milestone"' + (st.settings.notifyLevel === 'milestone' ? ' selected' : '') + '>仅里程碑</option>'
      + '<option value="mute"' + (st.settings.notifyLevel === 'mute' ? ' selected' : '') + '>静音</option>'
      + '</select></label>'
      + '<label class="check">邀约 <select data-set="invitePolicy">'
      + '<option value="auto"' + (st.settings.invitePolicy === 'auto' ? ' selected' : '') + '>自动接受</option>'
      + '<option value="ask"' + (st.settings.invitePolicy === 'ask' ? ' selected' : '') + '>先问我</option>'
      + '</select></label>'
      + '<label class="check">自动出售 <select data-set="autoSellGrade" title="拾取时低于等于该品质的物品直接折价出售（next-iteration §4.1）">'
      + '<option value="off"' + (st.settings.autoSellGrade === 'off' ? ' selected' : '') + '>关闭</option>'
      + '<option value="common"' + (st.settings.autoSellGrade === 'common' ? ' selected' : '') + '>普通及以下</option>'
      + '<option value="fine"' + (st.settings.autoSellGrade === 'fine' ? ' selected' : '') + '>精致及以下</option>'
      + '</select></label>'
      + '</div></div>';

    // 背包扩容金币坑（next-iteration §4）
    const capLv = st.capLevel || 0;
    h += '<div class="set-group"><div class="set-label">背包</div><div class="set-row">'
      + '<span>当前容量 ' + Engine.invCap(st) + ' 格</span>';
    if (capLv >= BALANCE.INV_CAP_UPGRADES.length) {
      h += '<button class="btn" disabled>已达最大扩容</button>';
    } else {
      const up = BALANCE.INV_CAP_UPGRADES[capLv];
      h += '<button class="btn primary" data-action="cap-buy"' + (st.gold < up.cost ? ' disabled' : '')
        + '>扩容至 ' + up.cap + ' 格 ' + Engine.fmtMoney(up.cost) + '</button>';
    }
    h += '</div></div>';

    h += '<div class="set-group"><div class="set-label">系统</div><div class="set-row">'
      + '<label class="check"><input type="checkbox" data-action="autostart-toggle"'
      + (App.autostart ? ' checked' : '') + '> 开机自启</label>'
      + '<button class="btn" data-action="admin-open">管理后台</button>'
      + '<button class="btn" data-action="hide-app">隐藏到托盘</button>'
      + '<button class="btn" data-action="quit-app">退出</button>'
      + '<button class="btn danger" data-action="save-reset">重置存档</button>'
      + '</div></div>';

    h += '<div class="about">人脉圈 Alpha2 v0.2 · 单机版 · 存档于本地'
      + (st.customMode ? ' · <span class="custom-badge">自定义参数</span>' : '') + '</div>';
    return h;
  }

  // ══ 管理后台（01 §2.2）══
  const ADMIN_GROUPS = [
    { name: '体力组', items: [
      ['staminaRegenPerMin', '体力恢复/分钟（难度总旋钮）', 'num', 0, 999],
      ['staminaMax', '体力上限', 'num', 10, 999],
      ['interactStaminaCost', '线下互动消耗', 'num', 0, 100],
      ['wechatStaminaCost', '微信聊天消耗', 'num', 0, 50],
      ['workplaceInteractCost', '职场互动消耗', 'num', 0, 50],
      ['offlineRegen', '离线回复体力', 'bool']
    ] },
    { name: '时间组', items: [
      ['timeScale', '游戏时间流速', 'num', 0.5, 5, 0.1],
      ['offlineCapHours', '离线结算上限（小时）', 'num', 1, 168],
      ['offlineFavorRate', '离线好感效率', 'num', 0, 2, 0.05]
    ] },
    { name: '经济组', items: [
      ['startGold', '新档启动资金', 'num', 0, 1e9],
      ['dropIntervalRate', '掉落间隔倍率（越小越勤）', 'num', 0.1, 10, 0.1],
      ['dropValueRate', '掉落期望价值倍率', 'num', 0.1, 10, 0.1],
      ['itemDropChance', '物品掉落占比', 'num', 0, 1, 0.05],
      ['rareItemRate', '稀有品质权重', 'num', 0, 0.2, 0.01],
      ['priceRate', '全局物价倍率', 'num', 0.1, 10, 0.1],
      ['favorPerYuanRate', '消费好感倍率', 'num', 0.1, 10, 0.1],
      ['workWageRate', '工作时薪倍率', 'num', 0.1, 10, 0.1],
      ['tipChance', '奶茶店小费概率', 'num', 0, 1, 0.01]
    ] },
    { name: '自动攻略组（决策器输入）', items: [
      ['decisionIntervalSec', '决策周期（真实秒）', 'num', 1, 60],
      ['spendStyle', '消费风格', 'select', [['frugal', '节俭'], ['standard', '标准'], ['generous', '大方'], ['lavish', '豪掷']]],
      ['dailyBudget', '全局日预算（0=不限）', 'num', 0, 1e9],
      ['perNpcBudget', '单人日预算（0=不限）', 'num', 0, 1e9],
      ['milestonePushWeight', '里程碑临近加权', 'num', 1, 5, 0.1],
      ['autoSlotOrder', '候补队列自动排序', 'select', [['off', '关'], ['output', '产出优先'], ['refer', '引荐优先'], ['reputation', '声望优先']]]
    ] },
    { name: '界面组', items: [
      ['decisionLogDepth', '决策日志保留条数', 'num', 10, 200]
    ] }
  ];

  function htmlHoutai() {
    const st = App.state;
    let h = '<div class="set-group"><div class="set-label">预设 '
      + (st.customMode ? '<span class="custom-badge">自定义参数（存档已标记 customMode）</span>' : '<span class="dim">当前为预设参数</span>')
      + '</div><div class="set-row">';
    Object.keys(SETTINGS_PRESETS).forEach((k) => {
      h += '<button class="btn primary" data-action="preset-set" data-key="' + k + '">'
        + SETTINGS_PRESETS[k].label + '</button>';
    });
    h += '</div></div>';

    ADMIN_GROUPS.forEach((grp) => {
      h += '<div class="set-group"><div class="set-label">' + grp.name + '</div>';
      grp.items.forEach((f) => {
        const key = f[0], label = f[1], kind = f[2];
        const val = st.settings[key];
        h += '<div class="admin-row"><span>' + label + '</span>';
        if (kind === 'bool') {
          h += '<input type="checkbox" data-set="' + key + '"' + (val ? ' checked' : '') + '>';
        } else if (kind === 'select') {
          h += '<select data-set="' + key + '">';
          f[3].forEach((op) => {
            h += '<option value="' + op[0] + '"' + (val === op[0] ? ' selected' : '') + '>' + op[1] + '</option>';
          });
          h += '</select>';
        } else {
          h += '<input type="number" data-set="' + key + '" value="' + val + '" min="' + f[3] + '" max="' + f[4] + '"'
            + (f[5] ? ' step="' + f[5] + '"' : '') + '>';
        }
        h += '</div>';
      });
      h += '</div>';
    });

    h += '<div class="set-group"><div class="set-label">GM 工具（一次性，调试用）</div><div class="set-row">'
      + '<button class="btn" data-action="gm-gold">+1万金</button>'
      + '<button class="btn" data-action="gm-gold-big">+100万金</button>'
      + '<button class="btn" data-action="gm-rep">+100声望</button>'
      + '<button class="btn" data-action="gm-stamina">体力回满</button>'
      + '<button class="btn" data-action="gm-item">发稀有物品</button>'
      + '<button class="btn" data-action="gm-tier">解锁下一圈层</button>'
      + '<button class="btn" data-action="gm-favor">全NPC好感+10</button>'
      + '<button class="btn" data-action="export-save">导出存档</button>'
      + '<button class="btn" data-action="import-save">导入存档</button>'
      + '</div></div>';
    return h;
  }

  // ── 动态位刷新 ──
  function updateDynamic() {
    if (!cur || !body) return;
    const st = App.state;

    if (cur === 'gonglue') {
      const cnt = document.getElementById('slot-count');
      if (cnt) cnt.textContent = st.slots.length + '/' + st.slotCount;
      const bl = document.getElementById('budget-line');
      if (bl) bl.textContent = budgetText();
      body.querySelectorAll('.chip-slot').forEach(function (chip) {
        if (!chip.dataset.id) return;
        const p = chip.querySelector('.pct');
        if (p) p.textContent = Math.floor(nsOf(st, chip.dataset.id).favor) + '%';
      });
    }

    body.querySelectorAll('.card[data-id]').forEach(function (cardEl) {
      const def = NPC_BY_ID[cardEl.dataset.id];
      if (!def) return;
      const ns = nsOf(st, def.id);
      const bar = cardEl.querySelector('.fav i');
      if (bar) bar.style.width = Math.min(100, ns.favor) + '%';
      const txt = cardEl.querySelector('[data-role="favtext"]');
      if (txt) txt.innerHTML = favText(st, def, ns, statusOf(st, def));
    });

    if (cur === 'shuxing') {
      body.querySelectorAll('[data-action="attr-up"]').forEach(function (btn) {
        btn.disabled = st.gold < Number(btn.dataset.cost);
      });
    }

    if (cur === 'gongzuo') {
      const left = document.getElementById('shift-left');
      if (left) {
        const shift = Engine.shiftInfo(st, Date.now());
        left.textContent = shift.onDuty ? fmtLeft(shift.endInMs) : '--';
      }
    }
  }

  // ── 弹窗 ──
  function openOverlay(html) {
    modalCtx = null;
    document.getElementById('overlay-card').innerHTML = html;
    document.getElementById('overlay').classList.remove('hidden');
  }
  function closeOverlay() {
    modalCtx = null;
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('overlay-card').innerHTML = '';
  }

  function confirm(msg, onOk) {
    confirmCb = onOk || null;
    openOverlay('<p class="ov-msg">' + msg + '</p>'
      + '<div class="ov-btns">'
      + '<button class="btn" data-action="confirm-cancel">取消</button>'
      + '<button class="btn primary" data-action="confirm-ok">确认</button></div>');
  }

  // 物品目标选择（send 类 / 免费约会类）
  function showItemTarget(idx) {
    const st = App.state;
    const targets = st.slots.filter((id) => !nsOf(st, id).asset);
    if (!targets.length) { App.notify('没有可用的攻略目标', 2000); return; }
    let h = '<h3 class="ov-title">选择对象</h3><div class="ov-btns" style="justify-content:flex-start;flex-wrap:wrap">';
    targets.forEach((id) => {
      const def = NPC_BY_ID[id];
      h += '<button class="btn primary" data-action="use-item" data-idx="' + idx + '" data-target="' + id + '">'
        + def.name + '</button>';
    });
    h += '<button class="btn" data-action="confirm-cancel">取消</button></div>';
    openOverlay(h);
  }

  // 详情弹窗（3.3.1/3.3.2）：操作聚合，操作后原地刷新不关窗
  function needsTargetOf(it) { return ['send_favor', 'send_gift', 'free_date'].indexOf(it.effect.kind) >= 0; }

  function itemModalHtml(st, idx, e) {
    const it = ITEM_BY_ID[e.it];
    const n = e.n || 1;
    const unit = Engine.sellUnitPrice(it);
    let h = '<h3 class="ov-title">物品详情</h3>'
      + '<div class="ov-item-head">'
      + '<span class="bag-cell static q-' + e.q + '">' + it.icon
      + (n > 1 ? '<b class="n">' + n + '</b>' : '') + '</span>'
      + '<div class="ii">'
      + '<div class="name-row"><b>' + esc(it.label) + '</b><i class="qtag q-' + e.q + '">' + Q_TXT[e.q] + '</i></div>'
      + '<em>' + esc(it.desc) + '</em>'
      + '<em class="dim">来源：' + esc(it.src || '—') + '</em>'
      + '<em class="dim">售价 ' + Engine.fmtMoney(unit) + '/件</em>'
      + '</div></div>';
    h += '<div class="ov-btns" style="justify-content:flex-start">'
      + '<button class="btn primary" data-action="use-item" data-idx="' + idx + '">'
      + (needsTargetOf(it) ? '使用…' : '使用') + '</button>'
      + '<button class="btn" data-action="sell-item" data-idx="' + idx + '">'
      + '出售整堆 +' + Engine.fmtMoney(unit * n) + '</button>'
      + '<button class="btn" data-action="confirm-cancel">关闭</button>'
      + '</div>';
    return h;
  }
  function openItemModal(idx) {
    const st = App.state;
    const e = invEntry(st, Number(idx));
    if (!e) return;
    openOverlay(itemModalHtml(st, Number(idx), e));
    modalCtx = { kind: 'item', idx: Number(idx), it: e.it, q: e.q };
  }

  function npcModalHtml(st, def) {
    const ns = nsOf(st, def.id);
    const status = statusOf(st, def);
    let h = '<h3 class="ov-title">' + esc(def.name)
      + ' <i class="qtag type-' + def.type + '">' + TYPE_TXT[def.type] + ' · T' + def.tier + '</i>'
      + ' <i class="qtag">' + STATUS_TXT[status] + '</i>'
      + (ns.referred && !ns.asset ? ' <i class="ref-badge">引荐</i>' : '') + '</h3>';
    h += '<div class="menu-row">';
    if (status === 'available') {
      const full = st.slots.length >= st.slotCount;
      h += '<button class="btn primary" data-action="slot-add" data-id="' + def.id + '"'
        + (full ? ' disabled' : '') + '>入槽</button>';
    } else if (status === 'courting') {
      const cost = st.settings.interactStaminaCost;
      h += '<button class="btn primary" data-action="interact" data-id="' + def.id + '"'
        + (Engine.onDuty(st) ? ' disabled title="在岗时段只能动嘴"' : '') + '>互动 -' + cost + '⚡</button>';
      h += '<button class="btn" data-action="wechat" data-id="' + def.id + '" title="微信聊天 +2，30分冷却">微信</button>';
      h += '<button class="btn danger" data-action="slot-remove" data-id="' + def.id + '">请离</button>';
      const pr = Agent.pauseReason(st, def.id);
      if (pr) h += '<span class="ov-hint">暂缓：' + esc(pr) + '</span>';
    } else if (status === 'asset') {
      const gps = BALANCE.BASE_OUTPUT[def.type] * Engine.tierDef(def.tier).mult * def.coef;
      h += '<span class="asset-line" title="随机掉落口径：每包有波动，长期期望对齐">掉落期望 '
        + Engine.fmtMoney(gps * 3600) + '/时</span>';
    } else {
      h += '<span class="lock-line">需进入 ' + Engine.tierDef(def.tier).name + '</span>';
    }
    h += '</div>';
    h += npcDossierHtml(st, def, ns);
    if (status === 'courting') h += '<div class="spend-menu">' + spendMenu(st, def, ns) + '</div>';
    h += '<div class="ov-btns"><button class="btn" data-action="confirm-cancel">关闭</button></div>';
    return h;
  }
  function openNpcModal(id) {
    const def = NPC_BY_ID[id];
    if (!def) return;
    openOverlay(npcModalHtml(App.state, def));
    modalCtx = { kind: 'npc', id };
  }

  // 原地刷新：commit() 后由 app 调用；条目已消失/已变身份（堆叠左移串位）则关窗
  function refreshModal() {
    if (!modalCtx) return;
    const st = App.state;
    const card = document.getElementById('overlay-card');
    if (modalCtx.kind === 'item') {
      const e = invEntry(st, modalCtx.idx);
      if (!e || e.it !== modalCtx.it || e.q !== modalCtx.q) { closeOverlay(); return; }
      card.innerHTML = itemModalHtml(st, modalCtx.idx, e);
    } else {
      const def = NPC_BY_ID[modalCtx.id];
      if (!def) { closeOverlay(); return; }
      card.innerHTML = npcModalHtml(st, def);
    }
  }

  // 邀约询问（08 §4 ask 模式）
  function showInvite(id) {
    const def = NPC_BY_ID[id];
    if (!def) return;
    openOverlay('<h3 class="ov-title">邀约</h3>'
      + '<p class="ov-msg">' + esc(def.name) + ' 主动约你吃饭（免费的正餐档约会，24 小时内有效）。</p>'
      + '<div class="ov-btns">'
      + '<button class="btn" data-action="invite-dismiss" data-id="' + id + '">忽略（无惩罚）</button>'
      + '<button class="btn primary" data-action="invite-accept" data-id="' + id + '">赴约</button></div>');
  }

  // ── 离线简报 v2（04 §5）──
  function showOffline(report) {
    pendingOffline = report;
    const h = Math.floor(report.awayMs / 3600000);
    const m = Math.floor((report.awayMs % 3600000) / 60000);
    const dur = h > 0 ? h + ' 小时 ' + m + ' 分' : m + ' 分';
    let html = '<h3 class="ov-title">离线简报</h3>'
      + '<p class="ov-line">离开时长：' + dur
      + (report.capped ? '<span class="cap-note">（已按离线上限结算）</span>' : '') + '</p>';
    html += '<p class="ov-line">上班工资 <b class="gain-gold">+' + Engine.fmtMoney(report.wage) + '</b></p>';
    html += '<p class="ov-line">资产掉落 <b class="gain-gold">+' + Engine.fmtMoney(report.packGold) + '</b>'
      + ' · 手札 <b class="gain-rep">+' + Math.floor(report.letterRep) + '</b></p>';
    if (report.milestoneGold || report.milestoneRep) {
      html += '<p class="ov-line">里程碑回流 <b class="gain-gold">+' + Engine.fmtMoney(report.milestoneGold)
        + '</b> / <b class="gain-rep">+' + Math.floor(report.milestoneRep) + '</b></p>';
    }
    const favors = (report.favors || []).filter((f) => f.gained >= 0.05);
    if (favors.length) {
      html += '<ul class="ov-favors">';
      favors.forEach((f) => { html += '<li>' + esc(f.name) + ' 好感 +' + f.gained.toFixed(1) + '</li>'; });
      html += '</ul>';
    }
    const agg = {};
    (report.actions || []).forEach((a) => { agg[a.txt] = (agg[a.txt] || 0) + a.n; });
    const keys = Object.keys(agg);
    if (keys.length) {
      html += '<div class="ov-sub">昨晚主角：</div><ul class="ov-favors">';
      keys.slice(0, 10).forEach((k) => { html += '<li>' + esc(k) + (agg[k] > 1 ? ' ×' + agg[k] : '') + '</li>'; });
      html += '</ul>';
    }
    if ((report.package || []).length) {
      html += '<div class="ov-sub">离线包裹（收下进背包）：</div><ul class="ov-favors">';
      report.package.forEach((p) => {
        const it = ITEM_BY_ID[p.it];
        if (it) html += '<li>' + it.icon + ' ' + it.label + '（' + Q_TXT[p.q]
          + ((p.n || 1) > 1 ? ' ×' + p.n : '') + '）</li>';
      });
      html += '</ul>';
    }
    if (report.soldN > 0) {
      html += '<p class="ov-line">自动售出 <b class="gain-gold">' + report.soldN + '</b> 件（阈值折价）</p>';
    }
    html += '<div class="ov-btns"><button class="btn primary" data-action="offline-claim">收下</button></div>';
    openOverlay(html);
  }
  function claimOffline() {
    const rep = pendingOffline;
    pendingOffline = null;
    if (rep && rep.package && rep.package.length) {
      const out = Engine.absorbOfflinePackage(App.state, rep.package);
      const lost = out.filter((o) => !o.ok).length;
      if (lost) App.notify('背包已满，' + lost + ' 件没能装下', 2800);
      App.save();
    }
    closeOverlay();
  }

  // 导出/导入选档
  function showExport() {
    let txt = '';
    try { txt = JSON.stringify(App.state); } catch (e) { /* ignore */ }
    openOverlay('<h3 class="ov-title">导出存档</h3>'
      + '<textarea id="io-area" class="io-area" readonly>' + esc(txt) + '</textarea>'
      + '<div class="ov-btns">'
      + '<button class="btn" data-action="copy-save">复制全文</button>'
      + '<button class="btn primary" data-action="confirm-cancel">关闭</button></div>');
  }
  function showImport() {
    openOverlay('<h3 class="ov-title">导入存档（覆盖当前进度）</h3>'
      + '<textarea id="io-area" class="io-area" placeholder="粘贴导出的存档 JSON"></textarea>'
      + '<div class="ov-btns">'
      + '<button class="btn" data-action="confirm-cancel">取消</button>'
      + '<button class="btn primary" data-action="import-apply">导入并重载</button></div>');
  }
  function applyImport() {
    const ta = document.getElementById('io-area');
    if (!ta || !ta.value.trim()) { closeOverlay(); return; }
    try {
      const obj = JSON.parse(ta.value);
      const st = Engine.migrate(obj);
      if (!st) throw new Error('无法识别的存档');
      window.App.state = st;
      App.save();
      location.reload();
    } catch (e) {
      App.notify('导入失败：' + e.message, 3000);
    }
  }
  function copySave() {
    const ta = document.getElementById('io-area');
    if (!ta) return;
    ta.select();
    try { document.execCommand('copy'); App.notify('已复制到剪贴板', 1800); } catch (e) { /* ignore */ }
  }

  window.UIPanel = {
    init, render, updateDynamic, showOffline, confirm,
    showItemTarget, showInvite, claimOffline, showExport, showImport, applyImport, copySave,
    closeOverlay, refreshModal,
    setBagTab, setRosterTab, synthToggle, synthClear, synthPick, synthRun,
    openItemModal, openNpcModal
  };
})();
