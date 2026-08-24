// 面板渲染：攻略/属性/圈层/设置 四页 + 离线简报与确认弹窗
(function () {
  const TITLES = { gonglue: '攻略', shuxing: '属性', quanceng: '圈层', shezhi: '设置' };
  const TYPE_TXT = { money: '金钱型', rep: '声望型', aux: '辅助型' };
  const STATUS_TXT = { locked: '未解锁', available: '可攻略', courting: '攻略中', asset: '人脉资产' };

  let body = null;
  let titleEl = null;
  let cur = null;        // 当前面板名
  let keepScroll = 0;    // 渲染前后保持滚动位置
  let confirmCb = null;  // 确认框回调

  // 只读取 NPC 状态（避免像 Engine.npc 那样为全部 NPC 写入存档）
  function nsOf(st, id) {
    return st.npcs[id] || { favor: 0, claimed: [], asset: false, referred: false };
  }
  // 与 Engine.statusOf 同逻辑的本地副本
  function statusOf(st, def) {
    const s = st.npcs[def.id];
    if (s && s.asset) return 'asset';
    if (st.slots.indexOf(def.id) >= 0) return 'courting';
    if (def.tier <= st.tier || (s && s.referred)) return 'available';
    return 'locked';
  }

  function init() {
    body = document.getElementById('panel-body');
    titleEl = document.getElementById('panel-title');

    document.getElementById('panel-close').addEventListener('click', function () {
      App.handleAction('panel-close', this);
    });
    // 面板内事件委托
    body.addEventListener('click', function (e) {
      const el = e.target.closest('[data-action]');
      if (el && body.contains(el)) App.handleAction(el.dataset.action, el);
    });
    // 弹窗卡片委托；遮罩空白点击不关闭（必须点按钮）
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
    titleEl.textContent = TITLES[cur];
    if (cur === 'gonglue') body.innerHTML = htmlGonglue();
    else if (cur === 'shuxing') body.innerHTML = htmlShuxing();
    else if (cur === 'quanceng') body.innerHTML = htmlQuanceng();
    else body.innerHTML = htmlShezhi();
    if (cur === 'gonglue') drawAvatars();
    body.scrollTop = keepScroll;
  }

  // ── 攻略 ──
  function htmlGonglue() {
    const st = App.state;
    let h = '<div class="slot-bar">';
    h += '<span class="slot-title">攻略槽 <b id="slot-count">' + st.slots.length + '/' + st.slotCount + '</b></span>';
    h += '<span class="slot-chips">';
    for (const id of st.slots) {
      const def = NPC_BY_ID[id];
      if (!def) continue;
      h += '<span class="chip-slot" data-action="focus-npc" data-id="' + id + '" title="点击定位到卡片">'
        + def.name + ' <i class="pct">' + Math.floor(nsOf(st, id).favor) + '%</i>'
        + '<b class="chip-x" data-action="slot-remove" data-id="' + id + '" title="请离">✕</b></span>';
    }
    h += '</span>';
    if (st.slotCount >= BALANCE.SLOTS_MAX) {
      h += '<button class="btn" disabled>已满</button>';
    } else {
      const price = BALANCE.SLOT_COSTS[st.slotCount + 1] || 0;
      h += '<button class="btn primary" data-action="slot-expand"'
        + (st.gold < price ? ' disabled' : '')
        + '>扩容槽位 ' + Engine.fmtMoney(price) + '</button>';
    }
    h += '</div>';

    for (let t = 1; t <= BALANCE.TIERS.length; t++) {
      const td = Engine.tierDef(t);
      const open = Engine.tierOpen(st, t);
      h += '<div class="tier-head' + (open ? '' : ' locked') + '">'
        + '<span class="tier-name">' + td.name + '</span>'
        + '<span class="tier-mult">产出 ×' + td.mult + '</span>';
      if (!open) {
        const c = Engine.canEnterTier(st, t);
        h += '<span class="tier-cond">'
          + (c.miss.length ? '需：' + c.miss.join('、') : '条件已达成，可入场')
          + '</span>';
      }
      h += '</div>';
      for (const def of NPCS) {
        if (def.tier === t) h += cardHtml(st, def, open);
      }
    }
    return h;
  }

  function cardHtml(st, def, open) {
    const ns = nsOf(st, def.id);
    const status = statusOf(st, def);
    const tc = Engine.tierDef(def.tier).color;

    let ops = '';
    if (status === 'available') {
      const full = st.slots.length >= st.slotCount;
      ops = '<button class="btn primary" data-action="slot-add" data-id="' + def.id + '"'
        + (full ? ' disabled' : '') + '>入槽</button>';
    } else if (status === 'courting') {
      ops = '<button class="btn primary" data-action="interact" data-id="' + def.id + '">互动 -'
        + BALANCE.INTERACT_COST + '⚡</button>';
      ['small', 'mid', 'large'].forEach(function (size) {
        const g = BALANCE.GIFTS[size];
        const need = BALANCE.LARGE_TASTE[def.tier];
        if (size === 'large' && st.attrs.taste < need) {
          ops += '<button class="btn" data-action="gift" data-size="large" data-id="' + def.id + '" disabled'
            + ' title="大礼需品味 ≥ ' + need + '，送不出手">大礼 品味≥' + need + '</button>';
        } else {
          const cost = g.cost[def.tier];
          ops += '<button class="btn" data-action="gift" data-size="' + size + '" data-id="' + def.id + '"'
            + (st.gold < cost ? ' disabled' : '') + '>' + g.label + ' ' + Engine.fmtMoney(cost) + '</button>';
        }
      });
      ops += '<button class="btn danger" data-action="slot-remove" data-id="' + def.id + '">请离</button>';
    } else if (status === 'asset') {
      const out = BALANCE.BASE_OUTPUT[def.type] * Engine.tierDef(def.tier).mult * def.coef;
      ops = '<span class="asset-line">资产 · 产出 ' + Engine.fmtRate(out) + '/秒</span>';
    } else {
      ops = '<span class="lock-line">需进入 ' + Engine.tierDef(def.tier).name + '</span>';
    }

    const refBadge = ns.referred && !open
      ? '<span class="ref-badge" title="由上层人脉满级引荐解锁">引荐</span>' : '';

    return '<div class="card" data-id="' + def.id + '">'
      + '<canvas class="avatar" width="48" height="32"></canvas>'
      + '<div class="info">'
      + '<div class="name-row"><span class="name">' + def.name + '</span>'
      + '<span class="chip type-' + def.type + '">' + TYPE_TXT[def.type] + '</span>'
      + '<span class="ttag">T' + def.tier + '</span>' + refBadge + '</div>'
      + '<div class="fav"><i style="width:' + Math.min(100, ns.favor) + '%;background:' + tc + '"></i></div>'
      + '<div class="favtext">' + Math.floor(ns.favor) + '/' + BALANCE.FAVOR_MAX + ' · ' + STATUS_TXT[status] + '</div>'
      + '</div>'
      + '<div class="ops">' + ops + '</div>'
      + '</div>';
  }

  // 头像须在插入 DOM 后绘制（12×8 头部 ×4 = 48×32）
  function drawAvatars() {
    body.querySelectorAll('.card').forEach(function (cardEl) {
      const def = NPC_BY_ID[cardEl.dataset.id];
      const cv = cardEl.querySelector('canvas.avatar');
      if (!def || !cv) return;
      Sprites.drawHead(cv.getContext('2d'), def, 0, 0, 4);
    });
  }

  // ── 属性 ──
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
      const cost = Engine.attrCost(lv);
      h += '<div class="attr-row"><div class="attr-info">'
        + '<div class="attr-name">' + r.name + '<span class="lv">Lv.' + lv + '</span></div>'
        + '<div class="attr-desc">' + r.desc + '</div>'
        + (r.eff ? '<div class="attr-effect">当前效果：' + r.eff + '</div>' : '');
      if (r.key === 'taste' && st.tier < BALANCE.TIERS.length) {
        h += '<div class="attr-effect">下一圈层门槛：品味 ' + BALANCE.TIERS[st.tier].taste + '</div>';
      }
      h += '</div><button class="btn primary" data-action="attr-up" data-key="' + r.key
        + '" data-cost="' + cost + '"' + (st.gold < cost ? ' disabled' : '')
        + '>升级 ' + Engine.fmtMoney(cost) + '</button></div>';
    });
    return h;
  }

  // ── 圈层 ──
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

  // ── 设置 ──
  function htmlShezhi() {
    let h = '<div class="set-group"><div class="set-label">像素缩放</div><div class="set-row">';
    [2, 3, 4].forEach(function (n) {
      h += '<button class="btn' + (App.layout.scale === n ? ' primary' : '')
        + '" data-action="scale-set" data-n="' + n + '">×' + n + '</button>';
    });
    h += '</div></div>';

    h += '<div class="set-group"><div class="set-label">系统</div><div class="set-row">'
      + '<label class="check"><input type="checkbox" data-action="autostart-toggle"'
      + (App.autostart ? ' checked' : '') + '> 开机自启</label>'
      + '<button class="btn" data-action="hide-app">隐藏到托盘</button>'
      + '<button class="btn" data-action="quit-app">退出</button>'
      + '<button class="btn danger" data-action="save-reset">重置存档</button>'
      + '</div></div>';

    h += '<div class="about">人脉圈 Alpha v0.1 · 单机版 · 存档于本地</div>';
    return h;
  }

  // ── 动态位刷新（每秒，不重建 DOM）──
  function updateDynamic() {
    if (!cur || !body) return;
    const st = App.state;

    if (cur === 'gonglue') {
      const cnt = document.getElementById('slot-count');
      if (cnt) cnt.textContent = st.slots.length + '/' + st.slotCount;
      body.querySelectorAll('.chip-slot').forEach(function (chip) {
        const p = chip.querySelector('.pct');
        if (p && chip.dataset.id) p.textContent = Math.floor(nsOf(st, chip.dataset.id).favor) + '%';
      });
    }

    // 卡片好感条与状态文本（状态可能因满级转资产而变化）
    body.querySelectorAll('.card[data-id]').forEach(function (cardEl) {
      const def = NPC_BY_ID[cardEl.dataset.id];
      if (!def) return;
      const ns = nsOf(st, def.id);
      const bar = cardEl.querySelector('.fav i');
      if (bar) bar.style.width = Math.min(100, ns.favor) + '%';
      const txt = cardEl.querySelector('.favtext');
      if (txt) {
        txt.textContent = Math.floor(ns.favor) + '/' + BALANCE.FAVOR_MAX
          + ' · ' + STATUS_TXT[statusOf(st, def)];
      }
    });

    // 属性面板金币可用性
    if (cur === 'shuxing') {
      body.querySelectorAll('[data-action="attr-up"]').forEach(function (btn) {
        btn.disabled = st.gold < Number(btn.dataset.cost);
      });
    }
  }

  // ── 弹窗 ──
  function openOverlay(html) {
    document.getElementById('overlay-card').innerHTML = html;
    document.getElementById('overlay').classList.remove('hidden');
  }

  function showOffline(report) {
    const h = Math.floor(report.awayMs / 3600000);
    const m = Math.floor((report.awayMs % 3600000) / 60000);
    const dur = h > 0 ? h + ' 小时 ' + m + ' 分' : m + ' 分';
    let html = '<h3 class="ov-title">离线简报</h3>'
      + '<p class="ov-line">离开时长：' + dur
      + (report.capped ? '<span class="cap-note">（已按离线上限结算）</span>' : '') + '</p>'
      + '<p class="ov-line">金币 <b class="gain-gold">+' + Engine.fmtMoney(report.gold) + '</b></p>'
      + '<p class="ov-line">声望 <b class="gain-rep">+' + Math.floor(report.rep) + '</b></p>';
    const favors = (report.favors || []).filter(function (f) { return f.gained >= 0.05; });
    if (favors.length) {
      html += '<ul class="ov-favors">';
      favors.forEach(function (f) {
        html += '<li>' + f.name + ' 好感 +' + f.gained.toFixed(1) + '</li>';
      });
      html += '</ul>';
    }
    html += '<div class="ov-btns"><button class="btn primary" data-action="offline-claim">收下</button></div>';
    openOverlay(html);
  }

  function confirm(msg, onOk) {
    confirmCb = onOk || null;
    openOverlay('<p class="ov-msg">' + msg + '</p>'
      + '<div class="ov-btns">'
      + '<button class="btn" data-action="confirm-cancel">取消</button>'
      + '<button class="btn primary" data-action="confirm-ok">确认</button></div>');
  }

  window.UIPanel = { init, render, updateDynamic, showOffline, confirm };
})();
