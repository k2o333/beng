// 核心引擎（纯逻辑，浏览器与 node 共用）：规则见 docs/drafts/alpha/01-systems.md
(function () {
  const B = globalThis.BALANCE;

  // ── 存档 ──
  function newState(now) {
    return {
      v: B.SAVE_VERSION,
      createdAt: now,
      lastSeen: now,
      gold: 0,
      rep: 0,
      stamina: B.STAMINA_MAX,
      stamTs: now,
      attrs: { charm: 0, talk: 0, taste: 0 },
      slotCount: B.SLOTS_INIT,
      slots: [],
      tier: 1,
      npcs: {},   // id -> { favor, claimed:[], asset, referred }
      seen: {}    // 一次性 UI 标记
    };
  }

  function npc(state, id) {
    if (!state.npcs[id]) state.npcs[id] = { favor: 0, claimed: [], asset: false, referred: false };
    return state.npcs[id];
  }

  // ── 查询 ──
  const tierDef = (t) => B.TIERS[t - 1];
  const tierOpen = (state, t) => t <= state.tier;

  function statusOf(state, def) {
    const s = npc(state, def.id);
    if (s.asset) return 'asset';
    if (state.slots.indexOf(def.id) >= 0) return 'courting';
    if (tierOpen(state, def.tier) || s.referred) return 'available';
    return 'locked';
  }

  function auxAssets(state) {
    let c = 0;
    for (const id in state.npcs) {
      const def = globalThis.NPC_BY_ID[id];
      if (state.npcs[id].asset && def && def.type === 'aux') c++;
    }
    return c;
  }
  function auxBonus(state) {
    return Math.min(B.AUX_BONUS_CAP, auxAssets(state) * B.AUX_BONUS_PER);
  }
  function autoFavorPerMin(state, def) {
    const t = tierDef(def.tier);
    return 0.5 * (1 + B.ATTR_EFFECT * state.attrs.charm) / t.restraint * (1 + auxBonus(state));
  }
  function interactGain(state, def) {
    return autoFavorPerMin(state, def) * 5 * (1 + B.ATTR_EFFECT * state.attrs.talk);
  }
  function incomePerSec(state) {
    let sum = 0;
    for (const id in state.npcs) {
      const s = state.npcs[id];
      const def = globalThis.NPC_BY_ID[id];
      if (s.asset && def) sum += B.BASE_OUTPUT[def.type] * tierDef(def.tier).mult * def.coef;
    }
    return sum;
  }
  function repPerMin(state) {
    let sum = 0;
    for (const id in state.npcs) {
      const s = state.npcs[id];
      const def = globalThis.NPC_BY_ID[id];
      if (s.asset && def && def.type === 'rep') sum += B.REP_PASSIVE[def.tier];
    }
    return sum;
  }
  function attrCost(level) {
    return Math.round(B.ATTR_BASE_COST * Math.pow(B.ATTR_COST_GROWTH, level));
  }

  // ── 体力 ──
  function regenStamina(state, now) {
    const el = now - state.stamTs;
    if (el <= 0) return;
    const add = Math.floor(el / B.STAMINA_REGEN_MS);
    if (add > 0) {
      state.stamina = Math.min(B.STAMINA_MAX, state.stamina + add);
      state.stamTs += add * B.STAMINA_REGEN_MS;
    }
  }

  // ── 好感：里程碑与满级转化 ──
  function grantFavor(state, def, amount, events) {
    const s = npc(state, def.id);
    if (s.asset || !(amount > 0)) return 0;
    const before = s.favor;
    s.favor = Math.min(B.FAVOR_MAX, s.favor + amount);
    for (const m of B.MILESTONES) {
      if (before < m && s.favor >= m && s.claimed.indexOf(m) < 0) {
        s.claimed.push(m);
        if (def.type === 'rep') {
          const amt = B.MILESTONE_REP[def.tier];
          state.rep += amt;
          events.push({ t: 'milestone', id: def.id, m, kind: 'rep', amount: amt });
        } else {
          const amt = B.MILESTONE_GOLD[def.tier];
          state.gold += amt;
          events.push({ t: 'milestone', id: def.id, m, kind: 'gold', amount: amt });
        }
      }
    }
    if (s.favor >= B.FAVOR_MAX) toAsset(state, def, events);
    return s.favor - before;
  }

  function toAsset(state, def, events) {
    const s = npc(state, def.id);
    s.asset = true;
    state.slots = state.slots.filter((x) => x !== def.id);
    const repAmt = B.FULL_REP[def.tier] * (def.type === 'rep' ? 2 : 1);
    state.rep += repAmt;
    events.push({ t: 'full', id: def.id, rep: repAmt });
    if (def.refer) {
      const r = npc(state, def.refer);
      const rdef = globalThis.NPC_BY_ID[def.refer];
      if (rdef && !r.asset && !r.referred) {
        r.referred = true;
        events.push({ t: 'refer', id: def.refer, by: def.id });
      }
    }
  }

  // ── 操作 ──
  function addToSlot(state, id) {
    const def = globalThis.NPC_BY_ID[id];
    if (!def) return { ok: false, msg: '无此人' };
    if (statusOf(state, def) !== 'available') return { ok: false, msg: '当前不可攻略' };
    if (state.slots.indexOf(id) >= 0) return { ok: false, msg: '已在槽位' };
    if (state.slots.length >= state.slotCount) return { ok: false, msg: '槽位已满，可扩容' };
    state.slots.push(id);
    return { ok: true };
  }
  function removeFromSlot(state, id) {
    const i = state.slots.indexOf(id);
    if (i < 0) return { ok: false, msg: '不在槽位' };
    state.slots.splice(i, 1);
    return { ok: true };
  }
  function interact(state, id, now) {
    const def = globalThis.NPC_BY_ID[id];
    if (!def || statusOf(state, def) !== 'courting') return { ok: false, msg: '需先放入攻略槽' };
    regenStamina(state, now);
    if (state.stamina < B.INTERACT_COST) return { ok: false, msg: '体力不足' };
    state.stamina -= B.INTERACT_COST;
    const events = [];
    const gain = grantFavor(state, def, interactGain(state, def), events);
    return { ok: true, gain, events };
  }
  function gift(state, id, size) {
    const def = globalThis.NPC_BY_ID[id];
    if (!def || statusOf(state, def) !== 'courting') return { ok: false, msg: '需先放入攻略槽' };
    const g = B.GIFTS[size];
    if (!g) return { ok: false, msg: '无此礼物' };
    if (size === 'large' && state.attrs.taste < B.LARGE_TASTE[def.tier]) {
      return { ok: false, msg: '品味不足，送不出手' };
    }
    const cost = g.cost[def.tier];
    if (state.gold < cost) return { ok: false, msg: '金币不足' };
    state.gold -= cost;
    const events = [];
    const gain = grantFavor(state, def, g.favor, events);
    return { ok: true, cost, gain, events };
  }
  function upgradeAttr(state, key) {
    if (!(key in state.attrs)) return { ok: false, msg: '无此属性' };
    const cost = attrCost(state.attrs[key]);
    if (state.gold < cost) return { ok: false, msg: '金币不足' };
    state.gold -= cost;
    state.attrs[key] += 1;
    return { ok: true, cost };
  }
  function expandSlot(state) {
    if (state.slotCount >= B.SLOTS_MAX) return { ok: false, msg: '槽位已满' };
    const cost = B.SLOT_COSTS[state.slotCount + 1];
    if (state.gold < cost) return { ok: false, msg: '金币不足' };
    state.gold -= cost;
    state.slotCount += 1;
    return { ok: true, cost };
  }
  function canEnterTier(state, t) {
    if (t < 1 || t > B.TIERS.length) return { ok: false, miss: ['无此圈层'] };
    const tier = tierDef(t);
    const miss = [];
    if (state.rep < tier.rep) miss.push('声望 ' + tier.rep);
    if (state.gold < tier.fee) miss.push('入场费 ' + fmtMoney(tier.fee));
    if (state.attrs.taste < tier.taste) miss.push('品味 ' + tier.taste);
    return { ok: miss.length === 0, miss, tier };
  }
  function enterTier(state, t) {
    if (t !== state.tier + 1) return { ok: false, msg: '圈层需逐级进入' };
    const c = canEnterTier(state, t);
    if (!c.ok) return { ok: false, msg: '还差：' + c.miss.join('、') };
    state.gold -= tierDef(t).fee;
    state.tier = t;
    return { ok: true, events: [{ t: 'tier', tier: t }] };
  }

  // ── 时间推进 ──
  function tick(state, now) {
    const events = [];
    const dt = Math.max(0, now - state.lastSeen);
    regenStamina(state, now);
    if (dt > 0) {
      state.gold += incomePerSec(state) * dt / 1000;
      state.rep += repPerMin(state) * dt / 60000;
      const slots = state.slots.slice();
      for (const id of slots) {
        const def = globalThis.NPC_BY_ID[id];
        if (!def) continue;
        grantFavor(state, def, autoFavorPerMin(state, def) * dt / 60000, events);
      }
    }
    state.lastSeen = now;
    return events;
  }

  // 离线结算（启动时一次）：好感 ×50%，金币/声望被动 ×100%，上限见 BALANCE
  function settleOffline(state, now) {
    const raw = Math.max(0, now - state.lastSeen);
    const capMs = (B.OFFLINE_CAP_H + Math.min(B.OFFLINE_AUX_CAP_H, auxAssets(state) * B.OFFLINE_AUX_BONUS_H)) * 3600000;
    const dt = Math.min(raw, capMs);
    const report = { awayMs: raw, ms: dt, capped: raw > capMs, gold: 0, rep: 0, favors: [], events: [] };
    regenStamina(state, now);
    if (dt > 5000) {
      report.gold = incomePerSec(state) * dt / 1000;
      report.rep = repPerMin(state) * dt / 60000;
      state.gold += report.gold;
      state.rep += report.rep;
      const slots = state.slots.slice();
      for (const id of slots) {
        const def = globalThis.NPC_BY_ID[id];
        if (!def) continue;
        const before = npc(state, id).favor;
        grantFavor(state, def, autoFavorPerMin(state, def) * dt / 60000 * B.OFFLINE_FAVOR_RATE, report.events);
        report.favors.push({ id, name: def.name, gained: npc(state, id).favor - before });
      }
    }
    state.lastSeen = now;
    return report;
  }

  // ── 格式化 ──
  function fmtMoney(n) {
    if (n >= 1e8) return trim(n / 1e8) + '亿';
    if (n >= 1e4) return trim(n / 1e4) + '万';
    return String(Math.floor(n));
  }
  function trim(x) {
    const s = x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
    return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  }
  function fmtRate(n) {
    return n >= 100 ? String(Math.round(n)) : trim(n);
  }

  const Engine = {
    newState, npc, statusOf, tierOpen, tierDef,
    auxAssets, auxBonus, autoFavorPerMin, interactGain,
    incomePerSec, repPerMin, attrCost, regenStamina,
    grantFavor, addToSlot, removeFromSlot, interact, gift,
    upgradeAttr, expandSlot, canEnterTier, enterTier,
    tick, settleOffline, fmtMoney, fmtRate
  };

  globalThis.Engine = Engine;
  if (typeof module !== 'undefined') module.exports = Engine;
})();
