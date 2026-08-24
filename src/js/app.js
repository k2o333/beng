// 装配与心跳：启动流程、操作分发、自动存档、通知与舞台特效
(function () {
  // 与 main.js 的 BAR_H 表一致（main 启动时不主动广播布局，用于本地校正）
  const BAR_H_MAP = { 2: 76, 3: 96, 4: 120 };

  window.App = {
    state: null,
    layout: { scale: 3, barH: 96, panelH: 420, panel: null },
    autostart: false,
    togglePanel, openPanel, handleAction,
    save, refreshPanel, notify, eventFx
  };

  let toastTimer = null;
  let pendingFocus = null; // openPanel 带入的待定位 NPC 卡片

  function $(id) { return document.getElementById(id); }

  // ── 启动流程 ──
  (async function boot() {
    // 1. 读档（版本不符或损坏则新开）
    let loaded = null;
    try {
      const raw = await api.readSave();
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.v === BALANCE.SAVE_VERSION) loaded = s;
      }
    } catch (e) { loaded = null; }
    App.state = loaded || Engine.newState(Date.now());

    // 2. 离线结算（仅续档时）
    const report = loaded ? Engine.settleOffline(App.state, Date.now()) : null;

    // 3. 启动时刻推进一次
    Engine.tick(App.state, Date.now());

    // 4. 主进程布局同步
    api.onLayout(onLayout);

    // 5. 子系统初始化
    UIBar.init();
    UIPanel.init();
    applyLayout();
    syncScale();

    // 6. 秒级心跳：时间推进 + 事件浮字 + 面板动态位
    setInterval(function () {
      const ev = Engine.tick(App.state, Date.now());
      App.eventFx(ev);
      UIPanel.updateDynamic();
    }, 1000);

    // 7. 自动存档：10s 定时 + 关窗兜底；Esc 收起面板
    setInterval(save, 10000);
    window.addEventListener('beforeunload', save);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || overlayOpen()) return;
      api.expand(null);
    });

    // 8. 离线简报（离开超 1 分钟且有实际收获才弹）
    if (report && report.ms > 60000
      && (report.capped || report.gold >= 1 || report.rep >= 1
        || (report.favors || []).some(function (f) { return f.gained >= 0.05; }))) {
      UIPanel.showOffline(report);
    }

    // 9. 新手指引（常驻，首次入槽后关闭）
    if (!App.state.seen.hint) App.notify('点击【攻略】把第一位 NPC 加入攻略槽', 0);

    // 10. 开机自启状态
    api.getAutostart().then(function (v) { App.autostart = !!v; }).catch(function () {});
  })();

  // main.js 启动时不发 layout，这里只读回其实际缩放做本地校正（BAR_H 不匹配则无副作用）
  function syncScale() {
    api.setScale(null).then(function (n) {
      if (BAR_H_MAP[n] && n !== App.layout.scale) {
        App.layout.scale = n;
        App.layout.barH = BAR_H_MAP[n];
        applyLayout();
      }
    }).catch(function () {});
  }

  function onLayout(d) {
    if (!d) return;
    const changed = d.panel !== App.layout.panel;
    Object.assign(App.layout, d);
    applyLayout();
    if (changed) {
      UIPanel.render(d.panel);
      consumeFocus();
    }
  }

  function applyLayout() {
    document.documentElement.style.setProperty('--barh', App.layout.barH + 'px');
    document.body.classList.toggle('panel-open', !!App.layout.panel);
    if (App.state) document.body.dataset.tier = App.state.tier;
  }

  // 渲染后消费待定位目标
  function consumeFocus() {
    if (!pendingFocus) return;
    const el = $('panel-body').querySelector('.card[data-id="' + pendingFocus + '"]');
    pendingFocus = null;
    if (el) el.scrollIntoView({ block: 'center' });
  }

  // ── 面板开合 ──
  function togglePanel(name) {
    api.expand(App.layout.panel === name ? null : name);
  }

  function openPanel(name, focusId) {
    pendingFocus = focusId || null;
    if (pendingFocus && App.layout.panel === name) {
      consumeFocus(); // 已在该页，不会触发重渲染，直接定位
    }
    api.expand(name);
  }

  // ── 操作分发 ──
  function handleAction(action, el) {
    const st = App.state;
    const ds = (el && el.dataset) || {};
    const id = ds.id;

    // 改变状态的操作：保存 + 整页刷新 + HUD 同步
    function commit() {
      save();
      UIPanel.render(App.layout.panel);
      UIBar.updateHud();
    }

    switch (action) {
      case 'slot-add': {
        const r = Engine.addToSlot(st, id);
        if (r.ok) {
          if (!st.seen.hint) st.seen.hint = 1; // 下一条 notify 自动替换常驻指引
          const def = NPC_BY_ID[id];
          App.notify(TEXTS.meet[id] || ('你结识了 ' + def.name + '。'), 4500);
        } else {
          App.notify(r.msg || '暂时无法入槽', 2000);
        }
        commit();
        break;
      }
      case 'slot-remove':
        Engine.removeFromSlot(st, id);
        commit();
        break;
      case 'interact': {
        const r = Engine.interact(st, id, Date.now());
        if (r.ok) App.eventFx([{ t: 'favor', id: id, gain: r.gain }].concat(r.events || []));
        else App.notify(r.msg, 1800);
        commit();
        break;
      }
      case 'gift': {
        const r = Engine.gift(st, id, ds.size);
        if (r.ok) {
          App.eventFx([{ t: 'favor', id: id, gain: r.gain }].concat(r.events || []));
          Fx.add('-' + Engine.fmtMoney(r.cost), UIBar.npcStageX(id), App.layout.barH - 70, '#ff9a9a');
        } else {
          App.notify(r.msg, 1800);
        }
        commit();
        break;
      }
      case 'attr-up': {
        const r = Engine.upgradeAttr(st, ds.key);
        App.notify(r.ok ? '-' + Engine.fmtMoney(r.cost) : r.msg, r.ok ? 1600 : 2200);
        commit();
        break;
      }
      case 'slot-expand': {
        const r = Engine.expandSlot(st);
        App.notify(r.ok ? '-' + Engine.fmtMoney(r.cost) : r.msg, r.ok ? 1600 : 2200);
        commit();
        break;
      }
      case 'tier-enter': {
        const r = Engine.enterTier(st, Number(ds.tier));
        if (r.ok) {
          document.body.classList.add('tier-flash');
          setTimeout(function () { document.body.classList.remove('tier-flash'); }, 2000);
          App.eventFx(r.events || []);
        } else {
          App.notify(r.msg, 2500);
        }
        commit();
        break;
      }
      case 'scale-set':
        api.setScale(Number(ds.n));
        break;
      case 'autostart-toggle':
        api.setAutostart(!!el.checked).then(function (v) { App.autostart = !!v; }).catch(function () {});
        break;
      case 'save-reset':
        UIPanel.confirm('确定清空存档重新开始？', function () {
          api.clearSave().then(function () { location.reload(); });
        });
        break;
      case 'panel-close':
        api.expand(null);
        break;
      case 'hide-app':
        api.expand(null);
        api.hide();
        break;
      case 'quit-app':
        save();
        api.quit();
        break;
      case 'offline-claim':
      case 'confirm-ok':
      case 'confirm-cancel':
        closeOverlay();
        break;
      case 'focus-npc': {
        const card = $('panel-body').querySelector('.card[data-id="' + id + '"]');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      }
    }
  }

  // ── 事件特效 ──
  function eventFx(events) {
    (events || []).forEach(function (e) {
      const def = NPC_BY_ID[e.id];
      const x = UIBar.npcStageX(e.id);
      const y = App.layout.barH - 64;
      if (e.t === 'favor') {
        Fx.add('好感 +' + (Math.round(e.gain * 10) / 10), x, y, '#9fe8c8');
      } else if (e.t === 'milestone') {
        Fx.add(
          e.kind === 'gold' ? '+' + Engine.fmtMoney(e.amount) + ' 金' : '+' + e.amount + ' 声望',
          x, y, e.kind === 'gold' ? '#ffd76a' : '#d8dce8'
        );
        if (def) {
          const pool = TEXTS.node[def.type] || [];
          const tpl = pool[Math.floor(Math.random() * pool.length)];
          if (tpl) App.notify(def.name + '：' + tpl.replace('{name}', def.name), 5000);
        }
      } else if (e.t === 'full') {
        Fx.add((def ? def.name : '') + ' 资产上线！', x, y, '#ffe9a8', true);
        if (TEXTS.full[e.id]) App.notify(TEXTS.full[e.id], 6000);
      } else if (e.t === 'refer') {
        const rd = NPC_BY_ID[e.id];
        if (rd) Fx.add('引荐解锁 ' + rd.name, x, y, '#5ac8b0', true);
      } else if (e.t === 'tier') {
        Fx.add('进入 ' + Engine.tierDef(e.tier).name + '！',
          window.innerWidth / 2, App.layout.barH - 70, '#ffe9a8', true);
      }
    });
  }

  // ── 存档 / 通知 / 弹窗辅助 ──
  function save() {
    if (!App.state) return;
    try { api.writeSave(JSON.stringify(App.state)); } catch (e) { /* 忽略 */ }
  }

  function refreshPanel() {
    UIPanel.render(App.layout.panel);
  }

  // ms=0 表示常驻；再次调用替换内容并重置定时器
  function notify(msg, ms) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (ms > 0) {
      toastTimer = setTimeout(function () { t.classList.add('hidden'); toastTimer = null; }, ms);
    }
  }

  function overlayOpen() {
    const ov = $('overlay');
    return !!ov && !ov.classList.contains('hidden');
  }

  function closeOverlay() {
    const ov = $('overlay');
    if (ov) ov.classList.add('hidden');
    const card = $('overlay-card');
    if (card) card.innerHTML = '';
  }
})();
