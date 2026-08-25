// 装配与心跳 v2：启动（含迁移）、决策器调度、掉落拾取、邀约、操作分发、自动存档
(function () {
  const BAR_H_MAP = { 2: 76, 3: 96, 4: 120 };

  window.App = {
    state: null,
    layout: { scale: 3, barH: 96, panelH: 420, panel: null },
    autostart: false,
    togglePanel, openPanel, handleAction,
    save, refreshPanel, notify, eventFx,
    setSetting, collectDrop
  };

  let toastTimer = null;
  let pendingFocus = null;
  let lastTick = Date.now();
  let lastAgent = 0;

  function $(id) { return document.getElementById(id); }

  // ── 启动流程 ──
  (async function boot() {
    let loaded = null;
    try {
      const raw = await api.readSave();
      if (raw) loaded = Engine.migrate(JSON.parse(raw));
    } catch (e) { loaded = null; }
    App.state = loaded || Engine.newState(Date.now());

    const report = loaded ? Engine.settleOffline(App.state, Date.now()) : null;

    api.onLayout(onLayout);

    UIBar.init();
    UIPanel.init();
    applyLayout();
    syncScale();

    // 秒级心跳：时间推进 + 决策器 + 自动拾取 + 邀约处理
    setInterval(function () {
      const now = Date.now();
      const dt = Math.min(60000, now - lastTick);
      lastTick = now;
      const st = App.state;
      if (!st) return;

      App.eventFx(Engine.step(st, dt));

      // 决策器节流（04：decisionIntervalSec 真实秒）
      if (now - lastAgent >= (st.settings.decisionIntervalSec || 5) * 1000) {
        lastAgent = now;
        const act = Agent.decide(st, now);
        if (act) {
          const r = Engine.execAction(st, act, now);
          if (r && r.ok) {
            logAgent(act);
            App.eventFx([{ t: 'favor', id: act.id, gain: r.gain || 0 }].concat(r.events || []));
          }
        }
        Agent.refillQueue(st);
      }

      // 掉落自动拾取（07 §3）
      if (st.settings.autoPickup) {
        st.drops.slice().forEach(function (d) {
          if (now - d.bornReal >= BALANCE.LOOT.AUTO_PICKUP_MS) collectDrop(d.uid, false);
        });
      }

      // 邀约：auto 模式直接赴约；ask 模式弹窗（08 §4）
      if (st.invites.length && !overlayOpen()) {
        const inv = st.invites[0];
        if (st.settings.invitePolicy === 'ask') {
          UIPanel.showInvite(inv.id);
        } else {
          const r = Engine.acceptInvite(st, inv.id);
          if (r && r.ok) {
            logTxt('接受了邀约（免费正餐）');
            App.eventFx(r.events || []);
          }
        }
      }

      UIPanel.updateDynamic();
      updateBudgetHud();
    }, 1000);

    setInterval(save, 10000);
    window.addEventListener('beforeunload', save);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || overlayOpen()) return;
      api.expand(null);
    });

    if (report && report.awayMs > 60000
      && (report.capped || report.wage >= 1 || report.packGold >= 1 || report.letterRep >= 1
        || report.milestoneGold >= 1 || (report.favors || []).some((f) => f.gained >= 0.05)
        || (report.package || []).length)) {
      UIPanel.showOffline(report);
    }

    if (!App.state.seen.hint) {
      App.notify('主角已自动开攻——点击【工作】排个班，或打开【攻略】看看主角的决策', 0);
    }
    api.getAutostart().then(function (v) { App.autostart = !!v; }).catch(function () {});
  })();

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

  function consumeFocus() {
    if (!pendingFocus) return;
    const id = pendingFocus;
    let el = $('panel-body').querySelector('.card[data-id="' + id + '"]');
    // 当前状态页签过滤掉了目标时，回退「全部」再定位（3.3.2 舞台联动）
    if (!el && App.layout.panel === 'gonglue') {
      UIPanel.setRosterTab('all');
      el = $('panel-body').querySelector('.card[data-id="' + id + '"]');
    }
    pendingFocus = null;
    if (el) {
      el.scrollIntoView({ block: 'center' });
      UIPanel.openNpcModal(id);
    }
  }

  function togglePanel(name) {
    api.expand(App.layout.panel === name ? null : name);
  }
  function openPanel(name, focusId) {
    pendingFocus = focusId || null;
    if (pendingFocus && App.layout.panel === name) consumeFocus();
    api.expand(name);
  }

  // ── 设置修改（后台/设置页共用）──
  function setSetting(key, val) {
    const st = App.state;
    if (val === '' || val === undefined) return;   // 数字输入清空时不误写 0
    const r = Engine.setSetting(st, key, val);
    if (!r.ok) App.notify(r.msg || '参数无效', 1800);
    save();
    if (App.layout.panel) UIPanel.render(App.layout.panel);
  }

  // ── 浮字坐标（Wave1-B 窄条适配）：取舞台可视区中心/底缘，随滚动与吸附边自适应 ──
  function stageWrap() { return document.getElementById('stage-wrap'); }
  function fxCtr(dyUp) {
    const w = stageWrap();
    if (!w) return [window.innerWidth / 2, App.layout.barH - dyUp];
    return [w.scrollLeft + w.clientWidth / 2, w.clientHeight - dyUp];
  }
  function fxY(dyUp) {
    const w = stageWrap();
    return w ? w.clientHeight - dyUp : App.layout.barH - dyUp;
  }

  // ── 掉落拾取 ──
  function collectDrop(uid, crit) {
    const st = App.state;
    if (!st) return;
    const r = Engine.collectDrop(st, uid, !!crit);
    if (r && r.ok) {
      App.eventFx(r.events || []);
      if (crit) {
        const c = fxCtr(62);
        Fx.add('暴击 ×2!', c[0], c[1], '#ffd76a', true);
      }
      UIBar.updateHud();
    }
  }

  function logAgent(act) {
    const def = NPC_BY_ID[act.id];
    const name = def ? def.name : act.id;
    let txt = act.reason || '';
    if (act.act === 'gift') txt = '送出' + BALANCE.GIFTS[act.size].label + '·' + name;
    else if (act.act === 'date') txt = BALANCE.SPEND.date[act.kind].label + '·' + name;
    else if (!txt.includes(name)) txt += '·' + name;
    Engine.logPush(App.state, txt);
  }
  function logTxt(txt) { Engine.logPush(App.state, txt); }

  function updateBudgetHud() { /* 预算在攻略页动态位里刷新，HUD 保持四行 */ }

  // ── 操作分发 ──
  function handleAction(action, el) {
    const st = App.state;
    const ds = (el && el.dataset) || {};
    const id = ds.id;

    function commit() {
      save();
      UIPanel.render(App.layout.panel);
      UIPanel.refreshModal();
      UIBar.updateHud();
    }
    function fxResult(r) {
      if (!r) return;
      if (r.ok) {
        App.eventFx([{ t: 'favor', id: id, gain: r.gain || 0 }].concat(r.events || []));
      } else {
        App.notify(r.msg || '暂时不行', 2000);
      }
    }

    switch (action) {
      case 'slot-add': {
        const r = Engine.addToSlot(st, id);
        if (r.ok) {
          if (!st.seen.hint) st.seen.hint = 1;
          const def = NPC_BY_ID[id];
          App.notify(TEXTS.meet[id] || ('你结识了 ' + def.name + '。'), 4500);
        } else App.notify(r.msg || '暂时无法入槽', 2000);
        commit();
        break;
      }
      case 'slot-remove':
        Engine.removeFromSlot(st, id);
        commit();
        break;
      case 'slot-move': {
        const i = st.slots.indexOf(id);
        const j = i + Number(ds.dir);
        if (i >= 0 && j >= 0 && j < st.slots.length) {
          st.slots.splice(j, 0, st.slots.splice(i, 1)[0]);
          commit();
        }
        break;
      }
      case 'interact': fxResult(Engine.interact(st, id, Date.now())); commit(); break;
      case 'wechat': fxResult(Engine.wechat(st, id)); commit(); break;
      case 'moments': fxResult(Engine.moments(st, id)); commit(); break;
      case 'workplace': fxResult(Engine.workplace(st, id, Date.now())); commit(); break;
      case 'gift': {
        const r = Engine.spendGift(st, id, ds.size, Date.now());
        if (r.ok) {
          App.eventFx([{ t: 'favor', id: id, gain: r.gain }].concat(r.events || []));
          Fx.add('-' + Engine.fmtMoney(r.cost), UIBar.npcStageX(id), fxY(70), '#ff9a9a');
        } else App.notify(r.msg, 2000);
        commit();
        break;
      }
      case 'date': {
        const r = Engine.spendDate(st, id, ds.kind, Number(ds.v), Date.now());
        if (r.ok) {
          App.eventFx([{ t: 'favor', id: id, gain: r.gain }].concat(r.events || []));
          Fx.add('-' + Engine.fmtMoney(r.cost), UIBar.npcStageX(id), fxY(70), '#ff9a9a');
        } else App.notify(r.msg, 2000);
        commit();
        break;
      }
      case 'errand': {
        const r = Engine.spendErrand(st, id, Date.now());
        fxResult(r);
        if (r.ok) Fx.add('-' + Engine.fmtMoney(r.cost), UIBar.npcStageX(id), fxY(70), '#ff9a9a');
        commit();
        break;
      }
      case 'npc-open':
        UIPanel.openNpcModal(id);
        break;
      case 'item-open':
        UIPanel.openItemModal(Number(ds.idx));
        break;
      case 'bag-tab':
        UIPanel.setBagTab(ds.t);
        break;
      case 'roster-tab':
        UIPanel.setRosterTab(ds.t);
        break;
      case 'synth-toggle':
        UIPanel.synthToggle();
        break;
      case 'synth-clear':
        UIPanel.synthClear();
        break;
      case 'synth-pick':
        UIPanel.synthPick(Number(ds.idx));
        break;
      case 'synth-run':
        UIPanel.synthRun();
        break;
      case 'cap-buy': {
        const r = Engine.buyInvCap(st);
        App.notify(r.msg || (r.ok ? '扩容成功' : '暂时不行'), r.ok ? 2400 : 2200);
        commit();
        break;
      }
      case 'use-item': {
        const idx = Number(ds.idx);
        const target = ds.target;
        const entry = st.inv[idx];
        if (!entry) break;
        const it = ITEM_BY_ID[entry.it];
        const needsTarget = ['send_favor', 'send_gift', 'free_date'].indexOf(it.effect.kind) >= 0;
        if (needsTarget && !target) { UIPanel.showItemTarget(idx); break; }
        const r = Engine.useItem(st, idx, target, Math.random);
        UIPanel.closeOverlay();
        fxResult(r);
        commit();
        break;
      }
      case 'sell-item': {
        const r = Engine.sellItem(st, Number(ds.idx));
        App.notify(r.ok ? '+' + Engine.fmtMoney(r.gold) : r.msg, r.ok ? 1600 : 2200);
        commit();
        break;
      }
      case 'job-hire': {
        const r = Engine.hireJob(st, ds.job);
        App.notify(r.ok ? '入职成功' : r.msg, r.ok ? 1800 : 2200);
        commit();
        break;
      }
      case 'job-quit': Engine.quitJob(st); commit(); break;
      case 'shift-start': {
        const r = Engine.startShift(st, Number(ds.h));
        App.notify(r.ok ? '开工！工资按秒入账，体力记得省着用' : r.msg, r.ok ? 2600 : 2200);
        commit();
        break;
      }
      case 'shift-stop': Engine.stopShift(st); commit(); break;
      case 'priority-set': st.priority = ds.p; save(); UIPanel.render('gongzuo'); break;
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
        } else App.notify(r.msg, 2500);
        commit();
        break;
      }
      case 'invite-accept': {
        const r = Engine.acceptInvite(st, id);
        if (r.ok) {
          logTxt('接受了邀约（免费正餐）');
          App.eventFx(r.events || []);
        }
        UIPanel.closeOverlay();
        commit();
        break;
      }
      case 'invite-dismiss': {
        const i = st.invites.findIndex((x) => x.id === id);
        if (i >= 0) st.invites.splice(i, 1);
        UIPanel.closeOverlay();
        break;
      }
      case 'preset-set': {
        Engine.applyPreset(st, ds.key);
        App.notify('已应用预设', 1500);
        commit();
        break;
      }
      case 'admin-open': openPanel('houtai'); break;
      case 'gm-gold': Engine.gmGrant(st, 'gold', 10000); App.notify('+1万金', 1400); commit(); break;
      case 'gm-gold-big': Engine.gmGrant(st, 'gold', 1000000); App.notify('+100万金', 1400); commit(); break;
      case 'gm-rep': Engine.gmGrant(st, 'rep', 100); App.notify('+100声望', 1400); commit(); break;
      case 'gm-stamina': st.stamina = st.settings.staminaMax; commit(); break;
      case 'gm-item': App.notify(Engine.gmGrant(st, 'item').msg, 1800); commit(); break;
      case 'gm-tier': Engine.gmUnlockTier(st); document.body.dataset.tier = st.tier; App.notify('圈层+1', 1400); commit(); break;
      case 'gm-favor': Engine.gmAllFavor(st, 10); App.notify('全 NPC 好感 +10', 1400); commit(); break;
      case 'export-save': UIPanel.showExport(); break;
      case 'import-save': UIPanel.showImport(); break;
      case 'import-apply': UIPanel.applyImport(); break;
      case 'copy-save': UIPanel.copySave(); break;
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
        UIPanel.claimOffline();
        break;
      case 'confirm-ok':
      case 'confirm-cancel':
        UIPanel.closeOverlay();
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
    // 同批拾取：autosell 已有专属浮字，collect 里同文案的不再重复画
    const hasAutosell = (events || []).some(function (x) { return x.t === 'autosell'; });
    (events || []).forEach(function (e) {
      const def = e.id ? NPC_BY_ID[e.id] : null;
      const x = e.id ? UIBar.npcStageX(e.id) : fxCtr(64)[0];
      const y = fxY(64);
      switch (e.t) {
        case 'favor':
          if (e.gain > 0) Fx.add('好感 +' + (Math.round(e.gain * 10) / 10), x, y, '#9fe8c8');
          break;
        case 'milestone': {
          Fx.add(e.kind === 'gold' ? '+' + Engine.fmtMoney(e.amount) + ' 金' : '+' + e.amount + ' 声望',
            x, y, e.kind === 'gold' ? '#ffd76a' : '#d8dce8');
          if (def && allowNotify()) {
            const pool = TEXTS.node[def.type] || [];
            const tpl = pool[Math.floor(Math.random() * pool.length)];
            if (tpl) App.notify(def.name + '：' + tpl.replace('{name}', def.name), 5000);
          }
          break;
        }
        case 'full': {
          const fc = def ? [x, y] : fxCtr(76);
          Fx.add((def ? def.name : '') + ' 资产上线！', fc[0], fc[1], '#ffe9a8', true);
          if (TEXTS.full[e.id]) App.notify(TEXTS.full[e.id], 6000);
          break;
        }
        case 'refer': {
          const rd = NPC_BY_ID[e.id];
          if (rd) Fx.add('引荐解锁 ' + rd.name, UIBar.npcStageX(e.id), y, '#5ac8b0', true);
          break;
        }
        case 'tier': {
          const tc = fxCtr(72);
          Fx.add('进入 ' + Engine.tierDef(e.tier).name + '！', tc[0], tc[1], '#ffe9a8', true);
          break;
        }
        case 'stage': {
          if (def) {
            const pool = TEXTS.stage[e.to] || [];
            const mono = pool[Math.floor(Math.random() * pool.length)];
            if (mono && allowNotify()) App.notify(mono, 3200);
            Engine.logPush(App.state, (STAGE_NAME[e.to] || e.to) + '期·' + def.name);
          }
          break;
        }
        case 'date': {
          if (e.key !== 'plain' && allowNotify()) {
            const pool = TEXTS.dateEvent[e.key] || [];
            const tpl = pool[Math.floor(Math.random() * pool.length)];
            const nm = def ? def.name : '';
            App.notify('【' + e.label + '】' + (tpl ? tpl.replace('{name}', nm) : ''), 4200);
          }
          break;
        }
        case 'return': {
          const it = ITEM_BY_ID[e.itemId];
          if (allowNotify() && def) {
            const pool = TEXTS.returnGift || [];
            const tpl = pool[Math.floor(Math.random() * pool.length)];
            App.notify((tpl ? tpl.replace('{name}', def.name) : def.name + '回赠了礼物')
              + (it ? '（' + it.icon + it.label + '）' : ''), 5000);
          }
          break;
        }
        case 'drop':
          UIBar.spawnDrop(e);
          break;
        case 'collect': {
          if (hasAutosell && (e.txt || '').indexOf('自动售出') === 0) break;
          const cc = fxCtr(44);
          Fx.add(e.txt || '', cc[0], cc[1], (e.txt || '').indexOf('暴击') >= 0 ? '#ffe9a8' : '#9fe8c8');
          break;
        }
        case 'autosell': {
          const ac = fxCtr(56);
          Fx.add(e.txt || '自动售出', ac[0], ac[1], '#ffd76a');
          break;
        }
        case 'ach': {
          const vc = fxCtr(88);
          Fx.add('🏆 成就达成：' + e.name, vc[0], vc[1], '#ffe9a8', true);
          if (allowNotify()) App.notify('成就达成「' + e.name + '」：' + e.perkText, 5200);
          break;
        }
        case 'synth': {
          const sc = fxCtr(80);
          Fx.add(e.txt || '', sc[0], sc[1], '#7adec6', true);
          break;
        }
        case 'item':
          if (e.txt && allowNotify()) App.notify(e.txt, 3600);
          break;
        case 'work':
          if (e.txt && allowNotify()) App.notify(e.txt, 2200);
          break;
        case 'invite': {
          if (allowNotify() && def) {
            App.notify(def.name + ' 主动约你了！（免费正餐档）', 4500);
          }
          break;
        }
        case 'hotspot': {
          const names = (e.list || []).map((hh) => hh.name).join('、');
          if (names && allowNotify()) App.notify('今日热点：' + names, 4000);
          break;
        }
        case 'wage':
          break;
      }
    });
  }

  const STAGE_NAME = { ice: '破冰', warm: '升温', deep: '深交', close: '收网' };

  function allowNotify() {
    const lv = App.state.settings.notifyLevel;
    return lv !== 'mute';
  }

  // ── 存档 / 通知 ──
  function save() {
    if (!App.state) return;
    try { api.writeSave(JSON.stringify(App.state)); } catch (e) { /* 忽略 */ }
  }

  function refreshPanel() {
    UIPanel.render(App.layout.panel);
  }

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
})();
