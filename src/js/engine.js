// 核心引擎 v2（纯逻辑，浏览器与 node 共用）
// 规则来源：docs/drafts/alpha/01-systems.md（v1 基线）+ docs/drafts/alpha2/01~08
// 契约：docs/dev/v2-api.md §1 存档 schema、§2 API 与事件 shapes
(function () {
  const B = globalThis.BALANCE;

  // ── 随机工具（所有随机入口接受可选 rng）──
  const rnd = (rng) => (rng ? rng() : Math.random());
  const rand = (rng, a, b) => a + rnd(rng) * (b - a);
  const irand = (rng, a, b) => Math.floor(rand(rng, a, b + 1));
  const pick = (rng, arr) => arr[Math.floor(rnd(rng) * arr.length)];

  function mergeSettings(raw) {
    const s = Object.assign({}, globalThis.SETTINGS_DEFAULT);
    if (raw) for (const k in s) if (raw[k] !== undefined) s[k] = raw[k];
    return s;
  }

  // ── 存档 ──
  function newState(now) {
    const settings = mergeSettings();
    return {
      v: B.SAVE_VERSION,
      createdAt: now,
      lastSeen: now,
      gt: 0,
      gold: settings.startGold,
      rep: 0,
      stamina: settings.staminaMax,
      attrs: { charm: 0, talk: 0, taste: 0 },
      slotCount: B.SLOTS_INIT,
      slots: ['t1_gu'],          // 开局第一目标自动进槽开攻（00 §4 红线）
      tier: 1,
      npcs: {},                   // id -> { favor, claimed:[], asset, referred }
      seen: {},
      settings,
      customMode: false,
      job: { id: 'restaurant', shiftEndGt: null, resting: false },
      priority: 'work_first',     // work_first | ratio | social_first
      cds: {},                    // id -> { wx, wp, mo } 到期 gt
      errandUsed: {},
      spent: { day: 0, global: 0, npc: {} },
      inv: [],                    // { it, q }
      drops: [],                  // 在线待拾取
      dropSeq: 1,
      lootNext: {},               // assetId -> 下次掉落 gt
      buffs: { dateOffGt: 0, attrHalf: false },
      invites: [],
      hotspot: { day: -1, list: [] },
      intel: {},                  // id -> { third, line, mine }
      weekReturn: {},
      log: [],
      stats: { totalWage: 0, totalInteract: 0, totalWorkMs: 0, totalLoot: 0, totalDates: 0 },
      perks: {},                  // 成就 id -> true（达成即永久被动，next-iteration §2）
      capLevel: 0                 // 背包扩容档位（INV_CAP_UPGRADES 下标，§4）
    };
  }

  // v1 -> v2 迁移（保留进度字段，其余按新档初始化）
  function migrate(raw) {
    try {
      if (!raw || typeof raw !== 'object') return null;
      if (raw.v === B.SAVE_VERSION) {
        raw.settings = mergeSettings(raw.settings);
        if (!Array.isArray(raw.inv)) raw.inv = [];
        else raw.inv.forEach((e) => { if (typeof e.n !== 'number' || !(e.n > 0)) e.n = 1; });   // 堆叠模型：旧条目按 n=1
        if (!Array.isArray(raw.drops)) raw.drops = [];
        if (!raw.hotspot) raw.hotspot = { day: -1, list: [] };
        raw.customMode = !!raw.customMode;
        if (!raw.stats || typeof raw.stats !== 'object') raw.stats = {};
        ['totalWage', 'totalInteract', 'totalWorkMs', 'totalLoot', 'totalDates'].forEach((k) => {
          if (typeof raw.stats[k] !== 'number') raw.stats[k] = 0;    // 旧档缺字段按 0 计
        });
        if (!raw.perks || typeof raw.perks !== 'object') raw.perks = {};
        if (typeof raw.capLevel !== 'number' || !(raw.capLevel >= 0)) raw.capLevel = 0;
        return raw;
      }
      if (raw.v !== 1) return null;
      const st = newState(raw.createdAt || Date.now());
      st.lastSeen = raw.lastSeen || Date.now();
      st.gold = typeof raw.gold === 'number' ? raw.gold : st.gold;
      st.rep = raw.rep || 0;
      st.stamina = typeof raw.stamina === 'number' ? raw.stamina : st.stamina;
      if (raw.attrs) st.attrs = Object.assign(st.attrs, raw.attrs);
      st.slotCount = raw.slotCount || st.slotCount;
      st.slots = Array.isArray(raw.slots) ? raw.slots.filter((id) => globalThis.NPC_BY_ID[id]) : st.slots;
      st.tier = raw.tier || 1;
      if (raw.npcs) {
        for (const id in raw.npcs) {
          const o = raw.npcs[id];
          st.npcs[id] = { favor: o.favor || 0, claimed: o.claimed || [], asset: !!o.asset, referred: !!o.referred };
        }
      }
      if (raw.seen) st.seen = raw.seen;
      return st;
    } catch (e) { return null; }
  }

  function npc(state, id) {
    if (!state.npcs[id]) state.npcs[id] = { favor: 0, claimed: [], asset: false, referred: false };
    return state.npcs[id];
  }

  // ── 查询 ──
  const tierDef = (t) => B.TIERS[t - 1];
  const tierOpen = (state, t) => t <= state.tier;

  function statusOf(state, def) {
    const s = state.npcs[def.id];
    if (s && s.asset) return 'asset';
    if (state.slots.indexOf(def.id) >= 0) return 'courting';
    if (tierOpen(state, def.tier) || (s && s.referred)) return 'available';
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

  // ── 成就被动（next-iteration §2）──
  function assetCount(state) {
    let c = 0;
    for (const id in state.npcs) if (state.npcs[id].asset) c++;
    return c;
  }
  function statValue(state, key) {
    return key === 'assets' ? assetCount(state) : (state.stats[key] || 0);
  }
  function checkAchievements(state, events) {
    events = events || [];
    for (const a of B.ACHIEVEMENTS) {
      if (state.perks[a.id]) continue;
      if (statValue(state, a.stat) >= a.goal) {
        state.perks[a.id] = true;
        events.push({ t: 'ach', id: a.id, name: a.name, perkText: a.perkText });
      }
    }
  }
  // 已解锁成就的乘区叠加
  function perkMul(state, key) {
    let m = 1;
    for (const a of B.ACHIEVEMENTS) if (a[key] && state.perks[a.id]) m *= a[key];
    return m;
  }
  function staminaMaxOf(state) {
    let max = Number(state.settings.staminaMax) || B.STAMINA_MAX;
    for (const a of B.ACHIEVEMENTS) if (a.stamMaxAdd && state.perks[a.id]) max += a.stamMaxAdd;
    return max;
  }

  function autoFavorPerMin(state, def) {
    const t = tierDef(def.tier);
    return 0.5 * (1 + B.ATTR_EFFECT * state.attrs.charm) / t.restraint * (1 + auxBonus(state)) * perkMul(state, 'favorMul');
  }
  function interactGain(state, def) {
    return autoFavorPerMin(state, def) * 5 * (1 + B.ATTR_EFFECT * state.attrs.talk);
  }

  // 资产产出期望（v1 口径金/秒；掉落系统的期望锚点，07 §1.2）
  function expectedIncomePerSec(state) {
    let sum = 0;
    for (const id in state.npcs) {
      const s = state.npcs[id];
      const def = globalThis.NPC_BY_ID[id];
      if (s && s.asset && def) sum += B.BASE_OUTPUT[def.type] * tierDef(def.tier).mult * def.coef;
    }
    return sum;
  }

  // attrCost(level[, priceRate])：UI 显示与扣费共用；priceRate 缺省取全局默认
  function attrCost(level, priceRate) {
    const pr = priceRate == null ? globalThis.SETTINGS_DEFAULT.priceRate : priceRate;
    return Math.round(B.ATTR_BASE_COST * Math.pow(B.ATTR_COST_GROWTH, level) * pr);
  }

  // ── 阶段（04 §2.2）──
  function stageOf(favor) {
    let cur = B.STAGES[0];
    for (const s of B.STAGES) if (favor >= s.min) cur = s;
    return cur;
  }

  // ── 好感与里程碑 ──
  function grantFavor(state, def, amount, events) {
    const s = npc(state, def.id);
    if (s.asset || !(amount > 0)) return 0;
    const offMul = state._offMul || 1;
    const amt = amount * offMul;
    const before = s.favor;
    const prevStage = stageOf(before).key;
    s.favor = Math.min(B.FAVOR_MAX, s.favor + amt);
    for (const m of B.MILESTONES) {
      if (before < m && s.favor >= m && s.claimed.indexOf(m) < 0) {
        s.claimed.push(m);
        if (def.type === 'rep') {
          state.rep += B.MILESTONE_REP[def.tier];
          events.push({ t: 'milestone', id: def.id, m, kind: 'rep', amount: B.MILESTONE_REP[def.tier] });
        } else {
          state.gold += B.MILESTONE_GOLD[def.tier];
          events.push({ t: 'milestone', id: def.id, m, kind: 'gold', amount: B.MILESTONE_GOLD[def.tier] });
        }
      }
    }
    const newStage = stageOf(s.favor).key;
    if (newStage !== prevStage) {
      events.push({ t: 'stage', id: def.id, from: prevStage, to: newStage });
    }
    if (s.favor >= B.FAVOR_MAX) toAsset(state, def, events);
    checkAchievements(state, events);
    return s.favor - before;
  }

  function toAsset(state, def, events) {
    const s = npc(state, def.id);
    if (s.asset) return;
    s.asset = true;
    state.slots = state.slots.filter((x) => x !== def.id);
    delete state.lootNext[def.id];   // 掉落计时由 step 的资产扫描重建
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

  // ── 工作与时间 ──
  function dayIndex(state) { return Math.floor(state.gt / B.DAY_MS); }

  function onDuty(state) {
    return !!(state.job && state.job.id && state.job.shiftEndGt != null && state.gt < state.job.shiftEndGt);
  }

  function wagePerSec(state, nowReal) {
    const j = state.job;
    if (!j || !j.id) return 0;
    const def = B.JOBS[j.id];
    let w = def.wage * state.settings.workWageRate / 3600 * perkMul(state, 'wageMul');
    if (j.id === 'restaurant') {
      const h = new Date(nowReal || Date.now()).getHours();
      if (h >= B.EVENING_HOURS[0] && h < B.EVENING_HOURS[1]) w *= def.eveningMul;
    }
    return w;
  }

  function shiftInfo(state, nowReal) {
    const j = state.job || {};
    const on = onDuty(state);
    return {
      jobId: j.id || null,
      onDuty: on,
      resting: !!j.resting,
      endInMs: on ? Math.max(0, j.shiftEndGt - state.gt) : 0,
      wagePerSec: on ? wagePerSec(state, nowReal) : 0
    };
  }

  function hireJob(state, jobId) {
    const def = B.JOBS[jobId];
    if (!def) return { ok: false, msg: '无此工作' };
    if (def.unlockAssets && auxAssets(state) < def.unlockAssets) {
      return { ok: false, msg: '需累计资产 ≥' + def.unlockAssets };
    }
    stopShift(state);
    state.job = { id: jobId, shiftEndGt: null, resting: false };
    return { ok: true };
  }
  function quitJob(state) {
    stopShift(state);
    state.job = { id: null, shiftEndGt: null, resting: false };
    return { ok: true };
  }
  function startShift(state, hours, nowReal) {
    if (!state.job.id) return { ok: false, msg: '先入职一份工作' };
    if (B.SHIFT_H.indexOf(hours) < 0) return { ok: false, msg: '班次时长无效' };
    state.job.resting = false;
    state.job.shiftEndGt = state.gt + hours * 3600000;
    return { ok: true };
  }
  function stopShift(state) {
    if (state.job) { state.job.shiftEndGt = null; state.job.resting = false; }
    return { ok: true };
  }

  // ── 渠道冷却 ──
  function cdOf(state, id) {
    if (!state.cds[id]) state.cds[id] = { wx: 0, wp: 0, mo: 0 };
    return state.cds[id];
  }

  function channelAct(state, id, kind, nowReal) {
    const def = globalThis.NPC_BY_ID[id];
    if (!def || statusOf(state, def) !== 'courting') return { ok: false, msg: '需先放入攻略槽' };
    const S = state.settings;
    const cd = cdOf(state, id);
    const conf = {
      wechat: { cd: B.WECHAT_CD_MIN, cost: S.wechatStaminaCost, favor: B.WECHAT_FAVOR, key: 'wx', duty: null },
      moments: { cd: B.MOMENTS_CD_MIN, cost: 0, favor: B.MOMENTS_FAVOR, key: 'mo', duty: null },
      workplace: { cd: B.WORKPLACE_CD_MIN, cost: S.workplaceInteractCost, favor: B.WORKPLACE_FAVOR, key: 'wp', duty: true }
    }[kind];
    if (conf.duty === true && !onDuty(state)) return { ok: false, msg: '职场互动需在岗时段' };
    if (conf.duty === false && onDuty(state)) return { ok: false, msg: '在岗时段只能动嘴' };
    if (cd[conf.key] > state.gt) return { ok: false, msg: '冷却中' };
    if (state.stamina < conf.cost) return { ok: false, msg: '体力不足' };
    state.stamina -= conf.cost;
    cd[conf.key] = state.gt + conf.cd * 60000;
    const events = [];
    const gain = grantFavor(state, def, conf.favor, events);
    return { ok: true, gain, events };
  }
  const wechat = (st, id) => channelAct(st, id, 'wechat');
  const moments = (st, id) => channelAct(st, id, 'moments');
  const workplace = (st, id, now) => channelAct(st, id, 'workplace', now);

  function interact(state, id, nowReal) {
    const def = globalThis.NPC_BY_ID[id];
    if (!def || statusOf(state, def) !== 'courting') return { ok: false, msg: '需先放入攻略槽' };
    if (onDuty(state)) return { ok: false, msg: '在岗时段只能动嘴' };
    const cost = state.settings.interactStaminaCost;
    if (state.stamina < cost) return { ok: false, msg: '体力不足' };
    state.stamina -= cost;
    const events = [];
    const gain = grantFavor(state, def, interactGain(state, def), events);
    state.stats.totalInteract++;
    checkAchievements(state, events);
    return { ok: true, gain, events };
  }

  // ── 预算护栏（05 §4，手动与决策器共用）──
  function overLine(state, id) {
    const S = state.settings;
    const g = S.dailyBudget > 0 && state.spent.global >= S.dailyBudget;
    const n = S.perNpcBudget > 0 && (state.spent.npc[id] || 0) >= S.perNpcBudget;
    return g || n;
  }
  function budgetLeftGlobal(state) {
    const b = state.settings.dailyBudget;
    return b <= 0 ? Infinity : Math.max(0, b - state.spent.global);
  }
  function budgetLeftNpc(state, id) {
    const b = state.settings.perNpcBudget;
    return b <= 0 ? Infinity : Math.max(0, b - (state.spent.npc[id] || 0));
  }
  function recordSpend(state, id, cost) {
    state.spent.global += cost;
    state.spent.npc[id] = (state.spent.npc[id] || 0) + cost;
  }

  // ── 消费项目（05）──
  function priceOf(state, kind, size, tier, variantIdx) {
    const S = state.settings;
    let p;
    if (kind === 'gift') p = B.GIFTS[size].cost[tier] * S.priceRate;
    else if (kind === 'errand') p = B.GIFTS.large.cost[tier] * B.SPEND.errand.mul * S.priceRate;
    else {
      const d = B.SPEND.date[size];
      p = B.GIFTS[d.base].cost[tier] * d.mul * S.priceRate;
      if (state.gt < state.buffs.dateOffGt) p *= 0.8;   // 商务名片夹 8 折
      p *= perkMul(state, 'datePriceMul');              // 社交悍匪被动
    }
    return Math.max(1, Math.round(p));
  }

  // 匹配窗口：两 tag + 情报揭示的第三偏好；雷区强制错配（08 §6）
  function matchTags(state, def, tags) {
    const intel = state.intel[def.id] || {};
    const window = def.tags.slice();
    if (intel.third && def.third) window.push(def.third);
    const hit = (tags || []).some((t) => window.indexOf(t) >= 0);
    const mine = !!(intel.mine && def.mine && (tags || []).indexOf(def.mine) >= 0);
    return { hit, mine, coef: mine ? B.SPEND.MATCH_DOWN : (hit ? B.SPEND.MATCH_UP : B.SPEND.MATCH_DOWN) };
  }

  function hotspotHit(state, tags) {
    const day = dayIndex(state);
    if (state.hotspot.day !== day) return false;
    return state.hotspot.list.some((h) => (tags || []).some((t) => h.tags.indexOf(t) >= 0));
  }

  function favorOf(state, def, kind, size, variantIdx) {
    const S = state.settings;
    let f;
    if (kind === 'gift') f = B.GIFTS[size].favor;
    else if (kind === 'errand') f = B.SPEND.errand.favor;
    else {
      f = B.SPEND.date[size].favor;
      const v = B.SPEND.VARIANTS[size][variantIdx || 0];
      const m = matchTags(state, def, v.tags);
      f *= m.coef;
      if (hotspotHit(state, v.tags)) f *= B.DATE.HOTSPOT_FAVOR;
    }
    return f * S.favorPerYuanRate;
  }

  // 最佳匹配变体索引（UI 角标与决策器共用）
  function bestVariantIdx(state, def, size) {
    let bi = 0, bs = -1;
    B.SPEND.VARIANTS[size].forEach((v, i) => {
      const m = matchTags(state, def, v.tags);
      const sc = (m.mine ? -1 : 0) + m.coef + (hotspotHit(state, v.tags) ? 1 : 0);
      if (sc > bs) { bs = sc; bi = i; }
    });
    return bi;
  }

  function spendGift(state, id, size, nowReal, rng) {
    const def = globalThis.NPC_BY_ID[id];
    if (!def || statusOf(state, def) !== 'courting') return { ok: false, msg: '需先放入攻略槽' };
    if (size === 'large' && state.attrs.taste < B.LARGE_TASTE[def.tier]) {
      return { ok: false, msg: '品味不足，送不出手' };
    }
    if (overLine(state, id)) return { ok: false, msg: '今日预算已用完' };
    const cost = priceOf(state, 'gift', size, def.tier);
    if (state.gold < cost) return { ok: false, msg: '金币不足' };
    state.gold -= cost;
    recordSpend(state, id, cost);
    const events = [];
    const gain = grantFavor(state, def, favorOf(state, def, 'gift', size), events);
    if (size === 'large') maybeReturnGift(state, def, rng, events);
    return { ok: true, cost, gain, events };
  }

  function spendErrand(state, id, nowReal, rng) {
    const def = globalThis.NPC_BY_ID[id];
    if (!def || statusOf(state, def) !== 'courting') return { ok: false, msg: '需先放入攻略槽' };
    if (state.errandUsed[id]) return { ok: false, msg: '每人限一次' };
    if (npc(state, id).favor < B.SPEND.errand.unlockFavor) return { ok: false, msg: '好感 ≥75 解锁' };
    if (overLine(state, id)) return { ok: false, msg: '今日预算已用完' };
    const cost = priceOf(state, 'errand', null, def.tier);
    if (state.gold < cost) return { ok: false, msg: '金币不足' };
    state.gold -= cost;
    recordSpend(state, id, cost);
    state.errandUsed[id] = true;
    const events = [];
    const gain = grantFavor(state, def, favorOf(state, def, 'errand'), events);
    maybeReturnGift(state, def, rng, events);
    return { ok: true, cost, gain, events };
  }

  function spendDate(state, id, kind, variantIdx, nowReal, rng) {
    const dd = B.SPEND.date[kind];
    if (!dd || !B.SPEND.VARIANTS[kind]) return { ok: false, msg: '无此约会项目' };
    const def = globalThis.NPC_BY_ID[id];
    if (!def || statusOf(state, def) !== 'courting') return { ok: false, msg: '需先放入攻略槽' };
    if (dd.unlockFavor && npc(state, id).favor < dd.unlockFavor) return { ok: false, msg: '好感 ≥' + dd.unlockFavor + ' 解锁' };
    if (onDuty(state)) return { ok: false, msg: '在岗时段只能动嘴' };
    if (overLine(state, id)) return { ok: false, msg: '今日预算已用完' };
    const cost = priceOf(state, 'date', kind, def.tier, variantIdx);
    if (state.gold < cost) return { ok: false, msg: '金币不足' };
    state.gold -= cost;
    recordSpend(state, id, cost);
    const events = [];
    const gain = resolveDate(state, def, kind, variantIdx, false, rng, events);
    if (kind === 'trip') maybeReturnGift(state, def, rng, events);
    state.stats.totalDates++;
    checkAchievements(state, events);
    return { ok: true, cost, gain, events };
  }

  // 约会结算核心（付费/免费邀约/物品免单 共用）：基础好感 × 事件倍率
  function resolveDate(state, def, kind, variantIdx, free, rng, events) {
    const vi = (variantIdx == null) ? bestVariantIdx(state, def, kind) : variantIdx;
    const v = B.SPEND.VARIANTS[kind][vi];
    const m = matchTags(state, def, v.tags);
    let base = B.SPEND.date[kind].favor * m.coef * state.settings.favorPerYuanRate;
    const hot = hotspotHit(state, v.tags);
    if (hot) base *= B.DATE.HOTSPOT_FAVOR;
    const ev = rollDateEvent(state, def, { matched: m.hit, hotspot: hot, free: !!free }, rng);
    events.push({ t: 'date', id: def.id, key: ev.key, label: ev.label, mult: ev.mul });
    const gain = grantFavor(state, def, base * ev.mul, events);
    return gain;
  }

  // ── 约会事件表（08 §2）──
  function rollDateEvent(state, def, ctx, rng) {
    const S = state.settings;
    const rolls = B.DATE.EVENTS.map((e) => {
      let w = e.w;
      if (ctx.matched && e.key === 'surprise') w *= 2;
      if (ctx.hotspot && B.DATE.POSITIVE.indexOf(e.key) >= 0) w *= 2;
      if (S.spendStyle === 'lavish' && B.DATE.POSITIVE.indexOf(e.key) >= 0) w *= 1.2;
      return { e, w };
    });
    let total = rolls.reduce((a, r) => a + r.w, 0);
    let r = rnd(rng) * total;
    let chosen = rolls[0].e;
    for (const rr of rolls) { r -= rr.w; if (r <= 0) { chosen = rr.e; break; } }
    const out = { key: chosen.key, label: chosen.label, mul: chosen.mul };
    const events = [];
    if (chosen.item) {
      const itemId = pick(rng, ['milk_tea_coupon', 'souvenir', 'card_holder', 'energy_coffee', 'double_ticket']);
      const it = globalThis.ITEM_BY_ID[itemId];
      invAdd(state, itemId, 'common', rng);
      out.item = itemId;
      events.push({ t: 'item', txt: '惊喜时刻：获得 ' + it.label });
    }
    if (chosen.intel) revealIntel(state, rng, events);
    out.events = events;
    return out;
  }

  // 情报揭示（08 §6）：三选一随机揭示已结识 NPC 的隐藏信息（不占背包）
  function revealIntel(state, rng, events) {
    events = events || [];
    const cands = [];
    for (const def of globalThis.NPCS) {
      const st = statusOf(state, def);
      if (st === 'locked') continue;
      const intel = state.intel[def.id] || {};
      const missing = ['third', 'line', 'mine'].filter((k) => !intel[k]);
      if (missing.length) cands.push({ def, missing });
    }
    if (!cands.length) {
      events.push({ t: 'item', txt: '情报：认识的每个人都被你看透了' });
      return false;
    }
    const c = pick(rng, cands);
    const k = pick(rng, c.missing);
    if (!state.intel[c.def.id]) state.intel[c.def.id] = {};
    state.intel[c.def.id][k] = true;
    let txt;
    if (k === 'third') txt = '情报：' + c.def.name + ' 还有隐藏偏好「' + c.def.third + '」';
    else if (k === 'mine') txt = '情报：雷区——' + c.def.name + ' 不喜欢「' + c.def.mine + '」';
    else {
      const rd = c.def.refer ? globalThis.NPC_BY_ID[c.def.refer] : null;
      txt = '情报：' + c.def.name + ' 的引荐线索——' + (rd ? '经由 ' + rd.name : '多出席本层场合可偶遇');
    }
    logPush(state, txt);
    events.push({ t: 'item', txt });
    return true;
  }

  // ── NPC 回礼（08 §3）：品质+1 档，每游戏周限 1 次 ──
  function maybeReturnGift(state, def, rng, events) {
    events = events || [];
    const week = Math.floor(state.gt / B.WEEK_MS);
    if (state.weekReturn[def.id] === week) return null;
    if (rnd(rng) >= B.DATE.RETURN_CHANCE) return null;
    state.weekReturn[def.id] = week;
    const q = qualityRollWith(state.settings, rng, false);
    const upq = { common: 'fine', fine: 'rare', rare: 'rare' }[q];
    const itemId = pick(rng, globalThis.ITEMS).id;
    invAdd(state, itemId, upq, rng);
    events.push({ t: 'return', id: def.id, itemId });
    return { it: itemId, q: upq };
  }

  // ── 掉落系统（07）──
  function qualityRollWith(S, rng, rareBoost) {
    let rare = typeof S.rareItemRate === 'number' ? S.rareItemRate : B.LOOT.QUALITY.rare;
    if (rareBoost) rare *= 2;
    const fine = B.LOOT.QUALITY.fine;
    const r = rnd(rng);
    if (r < rare) return 'rare';
    if (r < rare + fine) return 'fine';
    return 'common';
  }

  function lootIntervalMs(state, def, rng) {
    const S = state.settings;
    let iv = B.LOOT.INTERVAL_S[def.tier] * 1000 / def.coef * S.dropIntervalRate;
    iv *= rand(rng, B.LOOT.JITTER[0], B.LOOT.JITTER[1]);
    if (def.type === 'rep') iv *= B.LOOT.LETTER_INTERVAL_MUL;
    iv *= perkMul(state, 'dropMul');   // 捡漏之王被动
    return iv;
  }

  function rollLoot(state, def, rng) {
    const S = state.settings;
    const type = def.type;
    const table = B.LOOT.CONTENT[type];
    const total = table.reduce((a, x) => a + x[1], 0);
    let r = rnd(rng) * total;
    let branch = table[0][0];
    for (const br of table) { r -= br[1]; if (r <= 0) { branch = br[0]; break; } }
    // itemDropChance 缩放物品分支，未中回落金币包/手札
    const itemish = branch !== 'gold' && branch !== 'letter';
    if (itemish && rnd(rng) > S.itemDropChance) branch = type === 'rep' ? 'letter' : 'gold';

    if (branch === 'gold') {
      const gps = B.BASE_OUTPUT[type] * tierDef(def.tier).mult * def.coef;
      const qty = Math.max(1, Math.round(gps * 3600 * S.dropValueRate * rand(rng, B.LOOT.PACK_JITTER[0], B.LOOT.PACK_JITTER[1])));
      return { kind: 'gold', qty };
    }
    if (branch === 'letter') return { kind: 'letter', qty: B.LOOT.LETTER_REP[def.tier] };
    if (branch === 'intel') return { kind: 'intel' };

    const q = qualityRollWith(S, rng, type === 'aux');   // 辅助型稀有权重 ×2
    let itemId;
    if (branch === 'item') itemId = rnd(rng) < 0.7 ? 'gift_box' : 'limited_collectible';
    else {
      itemId = pick(rng, ['milk_tea_coupon', 'energy_coffee', 'souvenir', 'card_holder',
        'intel_brief', 'handwritten_invite', 'double_ticket', 'taste_album', 'surprise_cake']);
    }
    return { kind: 'item', itemId, q };
  }

  // ── 背包（堆叠模型 {it,q,n}，next-iteration §3.3.1；容量/自动出售 §4）──
  function invCap(state) {
    const lv = Math.min(B.INV_CAP_UPGRADES.length, state.capLevel || 0);
    return lv > 0 ? B.INV_CAP_UPGRADES[lv - 1].cap : B.LOOT.INV_CAP;
  }
  function buyInvCap(state) {
    const lv = state.capLevel || 0;
    if (lv >= B.INV_CAP_UPGRADES.length) return { ok: false, msg: '背包已达最大扩容' };
    const up = B.INV_CAP_UPGRADES[lv];
    if (state.gold < up.cost) return { ok: false, msg: '金币不足（需 ' + fmtMoney(up.cost) + '）' };
    state.gold -= up.cost;
    state.capLevel = lv + 1;
    return { ok: true, msg: '背包扩容至 ' + up.cap + ' 格', cap: up.cap };
  }
  function autoSellRank(state) {
    const g = state.settings.autoSellGrade;
    return (g === 'common' || g === 'fine') ? B.GRADE_RANK[g] : -1;   // off → -1
  }
  function sellUnitPrice(it) {
    return Math.max(1, Math.round(it.sell * B.LOOT.SELL_RATE));
  }

  // 入包：同 id 同品质并堆（上限 99），满格按品质挤最旧，稀有永不自动消失
  function invAdd(state, itemId, q, n, rng) {
    n = (typeof n === 'number' && n > 0) ? Math.floor(n) : 1;
    void rng;
    const rank = B.GRADE_RANK;
    const grade = q || 'common';
    let left = n;
    // 先并入已有堆
    for (const e of state.inv) {
      if (e.it === itemId && e.q === grade && (e.n || 1) < 99) {
        const take = Math.min(99 - (e.n || 1), left);
        e.n = (e.n || 1) + take;
        left -= take;
        if (left <= 0) return true;
      }
    }
    while (left > 0) {
      if (state.inv.length >= invCap(state)) {
        // 满：挤掉品质不高于新物的最旧一件
        let squeezed = false;
        for (let i = 0; i < state.inv.length; i++) {
          if (rank[state.inv[i].q] <= rank[grade]) {
            state.inv.splice(i, 1);
            squeezed = true;
            break;
          }
        }
        if (!squeezed) return false;
      }
      const take = Math.min(99, left);
      state.inv.push({ it: itemId, q: grade, n: take });
      left -= take;
    }
    return true;
  }

  function spawnDrop(state, def, roll) {
    const d = { uid: state.dropSeq++, id: def.id, kind: roll.kind, bornReal: Date.now() };
    if (roll.kind === 'item') { d.itemId = roll.itemId; d.q = roll.q; }
    if (roll.qty != null) d.qty = roll.qty;
    state.drops.push(d);
    return d;
  }

  function collectDrop(state, uid, crit, rng) {
    const i = state.drops.findIndex((d) => d.uid === uid);
    if (i < 0) return { ok: false, msg: '掉落物不存在' };
    const d = state.drops.splice(i, 1)[0];
    const events = [];
    let txt = '';
    if (d.kind === 'gold') {
      const amt = Math.round(d.qty * (crit ? 2 : 1));
      state.gold += amt;
      txt = '+' + fmtMoney(amt) + (crit ? ' 暴击!' : '');
    } else if (d.kind === 'letter') {
      state.rep += d.qty;
      txt = '+' + d.qty + ' 声望';
    } else if (d.kind === 'item') {
      const itDef = globalThis.ITEM_BY_ID[d.itemId];
      const thr = autoSellRank(state);
      if (thr >= B.GRADE_RANK[d.q]) {
        // 品质阈值过滤在前（§4.1）：折价直接入账，不进背包
        const amt = sellUnitPrice(itDef);
        state.gold += amt;
        state.stats.totalLoot++;
        txt = '自动售出 ' + itDef.label + ' +' + amt;
        events.push({ t: 'autosell', txt, itemId: d.itemId, q: d.q, gold: amt });
      } else if (!invAdd(state, d.itemId, d.q, 1, rng)) {
        txt = '背包已满，' + itDef.label + ' 散落了';
      } else {
        state.stats.totalLoot++;
        txt = '获得 ' + itDef.label;
      }
      checkAchievements(state, events);
    } else if (d.kind === 'intel') {
      revealIntel(state, rng, events);
      txt = '获得一条情报';
    }
    events.push({ t: 'collect', txt });
    return { ok: true, events };
  }

  // ── 背包操作 ──
  function sellItem(state, idx, n) {
    const e = state.inv[idx];
    if (!e) return { ok: false, msg: '没有这件物品' };
    const have = e.n || 1;
    const cnt = (typeof n === 'number' && n > 0) ? Math.min(Math.floor(n), have) : have;
    const it = globalThis.ITEM_BY_ID[e.it];
    const gold = sellUnitPrice(it) * cnt;
    if (cnt >= have) state.inv.splice(idx, 1);
    else e.n = have - cnt;
    state.gold += gold;
    return { ok: true, gold, sold: cnt };
  }

  // 3 合 1 升品质（next-iteration §1）：picks=[{i,n}]，Σn=NEED，同品质非稀有
  function synthItems(state, picks, rng) {
    const need = B.SYNTH.NEED;
    if (!Array.isArray(picks) || !picks.length) return { ok: false, msg: '请先选择材料' };
    let total = 0;
    let grade = null;
    for (const p of picks) {
      const e = state.inv[p.i];
      if (!e) return { ok: false, msg: '材料不存在（背包已变化）' };
      const take = Math.max(1, Math.min(e.n || 1, Number(p.n) || (e.n || 1)));
      total += take;
      if (grade === null) grade = e.q;
      else if (e.q !== grade) return { ok: false, msg: '只能合成同品质物品' };
      void take;
    }
    if (total !== need) return { ok: false, msg: '需要恰好 ' + need + ' 件材料' };
    if (grade === 'rare' || B.GRADE_RANK[grade] >= B.GRADE_RANK.rare) return { ok: false, msg: '稀有品质无法再合成' };
    // 原子性预检：完全消耗的材料条目会腾出格子，至少要剩 1 格给产物
    let freed = 0;
    for (const p of picks) {
      const e = state.inv[p.i];
      const take = Math.min(e.n || 1, Number(p.n) || (e.n || 1));
      if (take >= (e.n || 1)) freed++;
    }
    if (invCap(state) - state.inv.length + freed < 1) return { ok: false, msg: '背包已满，先腾出一个空位' };
    // 扣材料：按下标从大到小处理，避免 splice 使后续下标失效
    const sorted = picks.slice().sort((a, b) => b.i - a.i);
    for (const p of sorted) {
      const e = state.inv[p.i];
      const take = Math.min(e.n || 1, Number(p.n) || (e.n || 1));
      const left = (e.n || 1) - take;
      if (left > 0) e.n = left;
      else state.inv.splice(p.i, 1);
    }
    const outQ = B.NEXT_GRADE[grade];
    const itemId = pick(rng, globalThis.ITEMS).id;   // 全物品表均匀随机（含 send 类）
    invAdd(state, itemId, outQ, 1);
    const itDef = globalThis.ITEM_BY_ID[itemId];
    const txt = '合成出【' + B.GRADE_TXT[outQ] + '】' + itDef.label;
    return { ok: true, gained: { id: itemId, q: outQ }, txt };
  }

  // GM/便捷：自动挑一组可合成的最低档材料
  function findSynthTriple(state) {
    for (const g of ['common', 'fine']) {
      let need = B.SYNTH.NEED;
      const picks = [];
      for (let i = 0; i < state.inv.length && need > 0; i++) {
        const e = state.inv[i];
        if (B.GRADE_RANK[e.q] === B.GRADE_RANK[g]) {
          const take = Math.min(e.n || 1, need);
          picks.push({ i, n: take });
          need -= take;
        }
      }
      if (need === 0) return { grade: g, picks };
    }
    return null;
  }

  function useItem(state, idx, targetId, rng) {
    const e = state.inv[idx];
    if (!e) return { ok: false, msg: '没有这件物品' };
    const it = globalThis.ITEM_BY_ID[e.it];
    const eff = it.effect;
    const mulQ = e.q === 'fine' ? 1.5 : 1;
    const events = [];
    const consume = () => {
      const left = (e.n || 1) - 1;
      if (left > 0) e.n = left;
      else state.inv.splice(idx, 1);
    };

    switch (eff.kind) {
      case 'stamina': {
        state.stamina = Math.min(staminaMaxOf(state), state.stamina + eff.amt * mulQ);
        consume();
        events.push({ t: 'item', txt: it.label + '：体力 +' + Math.round(eff.amt * mulQ) });
        break;
      }
      case 'favor_random': {
        const cands = state.slots.map((id) => globalThis.NPC_BY_ID[id]).filter((d) => d && !npc(state, d.id).asset);
        if (!cands.length) return { ok: false, msg: '没有可用的攻略目标' };
        const def = pick(rng, cands);
        consume();
        const gain = grantFavor(state, def, eff.favor * mulQ, events);
        events.push({ t: 'favor', id: def.id, gain });
        events.push({ t: 'item', txt: it.label + '：' + def.name + ' 好感 +' + (Math.round(gain * 10) / 10) });
        break;
      }
      case 'favor_all': {
        const targets = state.slots.map((id) => globalThis.NPC_BY_ID[id]).filter((d) => d && !npc(state, d.id).asset);
        if (!targets.length) return { ok: false, msg: '没有可用的攻略目标' };
        consume();
        targets.forEach((def) => {
          const gain = grantFavor(state, def, eff.favor * mulQ, events);
          events.push({ t: 'favor', id: def.id, gain });
        });
        events.push({ t: 'item', txt: it.label + '：全员好感 +' + eff.favor });
        break;
      }
      case 'send_favor':
      case 'send_gift': {
        const def = globalThis.NPC_BY_ID[targetId];
        if (!def || statusOf(state, def) !== 'courting') return { ok: false, msg: '选择一名攻略中的对象' };
        consume();
        let favor;
        if (eff.kind === 'send_favor') favor = eff.favor * mulQ;
        else favor = B.GIFTS[eff.size].favor * mulQ;   // 免费等效礼物，large 免品味门槛，不触发回礼
        const gain = grantFavor(state, def, favor, events);
        events.push({ t: 'favor', id: def.id, gain });
        events.push({ t: 'item', txt: '送出 ' + it.label + '：' + def.name + ' 好感 +' + (Math.round(gain * 10) / 10) });
        break;
      }
      case 'free_date': {
        const def = globalThis.NPC_BY_ID[targetId];
        if (!def || statusOf(state, def) !== 'courting') return { ok: false, msg: '选择一名攻略中的对象' };
        if (onDuty(state)) return { ok: false, msg: '在岗时段只能动嘴' };
        consume();
        const kind = eff.tier === 'light' ? 'light'
          : (npc(state, def.id).favor >= 25 ? 'meal' : 'light');
        const gain = resolveDate(state, def, kind, null, true, rng, events);
        events.push({ t: 'item', txt: it.label + '：与 ' + def.name + ' 免费一约' });
        break;
      }
      case 'buff_date': {
        state.buffs.dateOffGt = state.gt + eff.hours * 3600000;
        consume();
        events.push({ t: 'item', txt: it.label + '：约会价格 ' + Math.round(eff.rate * 10) + ' 折（' + eff.hours + 'h）' });
        break;
      }
      case 'buff_attr': {
        state.buffs.attrHalf = true;
        consume();
        events.push({ t: 'item', txt: it.label + '：下一次属性升级 5 折' });
        break;
      }
      case 'rep': {
        const amt = Math.max(1, Math.ceil(2 * tierDef(state.tier).mult / 10));
        state.rep += amt;
        consume();
        events.push({ t: 'item', txt: it.label + '：声望 +' + amt });
        break;
      }
      case 'unlock_next': {
        let target = null;
        for (let t = state.tier + 1; t <= B.TIERS.length && !target; t++) {
          for (const def of globalThis.NPCS) {
            if (def.tier === t && statusOf(state, def) === 'locked') { target = def; break; }
          }
        }
        if (!target) return { ok: false, msg: '没有可解锁的对象' };
        npc(state, target.id).referred = true;
        consume();
        events.push({ t: 'refer', id: target.id, by: null });
        events.push({ t: 'item', txt: it.label + '：解锁 ' + target.name });
        break;
      }
      default:
        return { ok: false, msg: '未知物品效果' };
    }
    return { ok: true, events };
  }
  const sendItem = (state, idx, targetId, rng) => useItem(state, idx, targetId, rng);

  // ── 属性/槽位/圈层（沿用 v1，接入 priceRate 与画册半价）──
  function upgradeAttr(state, key) {
    if (!(key in state.attrs)) return { ok: false, msg: '无此属性' };
    let cost = attrCost(state.attrs[key], state.settings.priceRate);
    if (state.buffs.attrHalf) cost = Math.max(1, Math.ceil(cost / 2));
    if (state.gold < cost) return { ok: false, msg: '金币不足' };
    state.gold -= cost;
    state.attrs[key] += 1;
    if (state.buffs.attrHalf) { state.buffs.attrHalf = false; return { ok: true, cost, discounted: true }; }
    return { ok: true, cost };
  }
  function expandSlot(state) {
    if (state.slotCount >= B.SLOTS_MAX) return { ok: false, msg: '槽位已满' };
    const cost = Math.round(B.SLOT_COSTS[state.slotCount + 1] * state.settings.priceRate);
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

  // ── 日切：热点 / 邀约（08 §4~§5）──
  function refreshHotspots(state, rng) {
    const n = irand(rng, B.DATE.HOTSPOT_PER_DAY[0], B.DATE.HOTSPOT_PER_DAY[1]);
    const pool = B.DATE.HOTSPOTS.slice();
    const list = [];
    for (let i = 0; i < n && pool.length; i++) {
      list.push(pool.splice(Math.floor(rnd(rng) * pool.length), 1)[0]);
    }
    state.hotspot = { day: dayIndex(state), list };
    return list;
  }

  function inviteRoll(state, rng) {
    const events = [];
    for (const def of globalThis.NPCS) {
      const s = state.npcs[def.id];
      if (!s || s.asset || s.favor < B.DATE.INVITE_FAVOR) continue;
      if (state.invites.some((x) => x.id === def.id)) continue;
      const matched = B.SPEND.VARIANTS.light.some((v) => matchTags(state, def, v.tags).hit);
      const p = B.DATE.INVITE_P * (matched ? B.SPEND.MATCH_UP : B.SPEND.MATCH_DOWN);
      if (rnd(rng) < p) {
        state.invites.push({ id: def.id, expGt: state.gt + B.DATE.INVITE_VALID_H * 3600000 });
        events.push({ t: 'invite', id: def.id });
      }
    }
    return events;
  }

  function acceptInvite(state, id, rng) {
    const i = state.invites.findIndex((x) => x.id === id);
    if (i < 0) return { ok: false, msg: '邀约不存在或已过期' };
    const def = globalThis.NPC_BY_ID[id];
    if (!def || statusOf(state, def) !== 'courting') { state.invites.splice(i, 1); return { ok: false, msg: '无法赴约' }; }
    state.invites.splice(i, 1);
    const events = [];
    const gain = resolveDate(state, def, 'meal', null, true, rng, events);
    logPush(state, '接受了 ' + def.name + ' 的邀约（免费正餐）');
    return { ok: true, gain, events };
  }

  function newDay(state, rng) {
    state.spent = { day: dayIndex(state), global: 0, npc: {} };
    refreshHotspots(state, rng);
    const ev = inviteRoll(state, rng);
    state.invites = state.invites.filter((x) => x.expGt > state.gt);
    return ev;
  }

  // ── 决策日志 ──
  function logPush(state, txt) {
    state.log.push({ gt: state.gt, txt });
    const depth = state.settings.decisionLogDepth || 50;
    while (state.log.length > depth) state.log.shift();
  }

  // ── 主循环步进 ──
  function step(state, realDtMs, opts) {
    opts = opts || {};
    const offline = !!opts.offline;
    const rng = opts.rng;
    const events = [];
    const S = state.settings;
    const realDt = Math.max(0, realDtMs);
    const gdt = realDt * S.timeScale;
    state.gt += gdt;

    // 体力再生
    if (!offline || S.offlineRegen) {
      state.stamina = Math.min(staminaMaxOf(state), state.stamina + S.staminaRegenPerMin * gdt / 60000);
    }

    // 工作：产钱 + 耗体力 + 歇业规则（02 方案 A）
    const j = state.job;
    if (j && j.id && j.shiftEndGt != null) {
      if (state.gt >= j.shiftEndGt) { j.shiftEndGt = null; j.resting = false; }
      else if (!j.resting) {
        const jd = B.JOBS[j.id];
        state.stats.totalWorkMs += gdt;   // 全勤打工人成就计数
        const drain = jd.staminaPerH * gdt / 3600000;
        if (state.stamina - drain <= 0) {
          state.stamina = 0; j.resting = true;    // 体力见底自动歇班，不惩罚
        } else {
          state.stamina -= drain;
          let wps = wagePerSec(state, opts.nowReal || Date.now());
          if (offline && j.id === 'night') wps *= jd.offlineMul || 1;
          const wage = wps * gdt / 1000;
          if (wage > 0) { state.gold += wage; state.stats.totalWage += wage; events.push({ t: 'wage', amount: wage }); }
          if (jd.tipChance && gdt > 0) {
            if (rnd(rng) < jd.tipChance * gdt / 3600000) {
              const amt = irand(rng, jd.tipRange[0], jd.tipRange[1]);
              state.gold += amt;
              events.push({ t: 'work', txt: '小费 +' + amt });
            }
          }
        }
      } else if (state.stamina >= staminaMaxOf(state) * B.WORK_REST_RESUME) {
        j.resting = false;
      }
    }

    // 槽内自动好感（好感公式不变；离线效率约束由 settleOffline 的 _offMul 统一缩放）
    if (gdt > 0) {
      const slots = state.slots.slice();
      for (const id of slots) {
        const def = globalThis.NPC_BY_ID[id];
        if (!def) continue;
        grantFavor(state, def, autoFavorPerMin(state, def) * gdt / 60000, events);
      }
    }

    // 日切
    const day = dayIndex(state);
    if (day !== state.spent.day) {
      const dev = newDay(state, rng);
      events.push({ t: 'hotspot', list: state.hotspot.list });
      for (const e of dev) events.push(e);
    }

    // 资产掉落计时（只有人脉资产掉落）
    for (const id in state.lootNext) {
      const def = globalThis.NPC_BY_ID[id];
      const s = state.npcs[id];
      if (!def || !s || !s.asset) { delete state.lootNext[id]; continue; }
      let guard = 0;
      while (state.lootNext[id] <= state.gt && guard++ < 64) {
        if (state.lootNext[id] === undefined) break;
        const roll = rollLoot(state, def, rng);
        if (offline) {
          applyOfflineLoot(state, roll);
        } else {
          const d = spawnDrop(state, def, roll);
          events.push({ t: 'drop', uid: d.uid, id: def.id, kind: roll.kind, itemId: roll.itemId, qty: roll.qty, q: roll.q });
        }
        state.lootNext[id] = (state.lootNext[id] < state.gt - 86400000 ? state.gt : state.lootNext[id])
          + lootIntervalMs(state, def, rng);
      }
    }
    for (const id in state.npcs) {
      const s = state.npcs[id];
      if (s.asset && state.lootNext[id] === undefined) {
        const def = globalThis.NPC_BY_ID[id];
        if (def) state.lootNext[id] = state.gt + lootIntervalMs(state, def, rng);
      }
    }

    // 过期清理
    state.invites = state.invites.filter((x) => x.expGt > state.gt);

    checkAchievements(state, events);

    return events;
  }

  // 离线掉落折算：金币/声望直接入账，物品按阈值过滤（§4.1 同口径）后进离线包裹
  function applyOfflineLoot(state, roll) {
    if (roll.kind === 'gold') { state.gold += roll.qty; state._offPackGold = (state._offPackGold || 0) + roll.qty; }
    else if (roll.kind === 'letter') { state.rep += roll.qty; state._offLetterRep = (state._offLetterRep || 0) + roll.qty; }
    else if (roll.kind === 'item') {
      const thr = autoSellRank(state);
      if (thr >= B.GRADE_RANK[roll.q]) {
        const amt = sellUnitPrice(globalThis.ITEM_BY_ID[roll.itemId]);
        state.gold += amt;
        state._offPackGold = (state._offPackGold || 0) + amt;
        state._offSoldN = (state._offSoldN || 0) + 1;
        state.stats.totalLoot++;
      } else {
        state._offPackage.push({ it: roll.itemId, q: roll.q, n: 1 });
      }
    }
    else if (roll.kind === 'intel') { revealIntel(state, null, state._offIntelEvents); }
  }

  // 离线包裹领取（UI 调用）：逐条入包并计入拾取成就
  function absorbOfflinePackage(state, list) {
    const out = [];
    (list || []).forEach((p) => {
      const okc = invAdd(state, p.it, p.q, p.n || 1);
      if (okc) state.stats.totalLoot += (p.n || 1);
      out.push({ it: p.it, q: p.q, n: p.n || 1, ok: !!okc });
    });
    checkAchievements(state, []);
    return out;
  }

  // ── 决策器意图执行（手动/自动/离线 同管线）──
  function execAction(state, act, nowReal, rng) {
    if (!act) return { ok: false, msg: '空动作' };
    switch (act.act) {
      case 'interact': return interact(state, act.id, nowReal);
      case 'wechat': return wechat(state, act.id);
      case 'moments': return moments(state, act.id);
      case 'workplace': return workplace(state, act.id, nowReal);
      case 'gift': return spendGift(state, act.id, act.size, nowReal, rng);
      case 'date': return spendDate(state, act.id, act.kind, act.variantIdx, nowReal, rng);
      case 'errand': return spendErrand(state, act.id, nowReal, rng);
      case 'item': return useItem(state, act.invIdx, act.id, rng);
      default: return { ok: false, msg: '未知动作' };
    }
  }

  // ── 离线结算（04 §5：同一架构模拟 + 简报）──
  function settleOffline(state, nowReal, rng, agentFn) {
    rng = rng || null;
    const raw = Math.max(0, nowReal - state.lastSeen);
    const capGameMs = (B.OFFLINE_CAP_H + Math.min(B.OFFLINE_AUX_CAP_H, auxAssets(state) * B.OFFLINE_AUX_BONUS_H)) * 3600000;
    const allowedReal = capGameMs / Math.max(0.01, state.settings.timeScale);
    const dtReal = Math.min(raw, allowedReal);
    const report = {
      awayMs: raw, ms: dtReal * state.settings.timeScale, capped: raw > allowedReal + 1,
      wage: 0, packGold: 0, letterRep: 0, milestoneGold: 0, milestoneRep: 0,
      favors: [], actions: [], package: [], stageNotes: [], soldN: 0
    };
    if (dtReal < 5000) { state.lastSeen = nowReal; return report; }

    state._offPackage = [];
    state._offPackGold = 0;
    state._offLetterRep = 0;
    state._offSoldN = 0;
    state._offIntelEvents = [];
    state._offMul = state.settings.offlineFavorRate;

    const favorBefore = {};
    state.slots.forEach((id) => { favorBefore[id] = npc(state, id).favor; });

    const nChunks = Math.min(400, Math.max(1, Math.ceil(dtReal / 600000)));
    const chunkReal = dtReal / nChunks;
    let simReal = state.lastSeen;
    for (let i = 0; i < nChunks; i++) {
      simReal += chunkReal;
      const ev = step(state, chunkReal, { offline: true, nowReal: simReal, rng });
      absorb(report, ev, state);
      if (agentFn) {
        const act = agentFn(state, simReal, rng);
        if (act) {
          const r = execAction(state, act, simReal, rng);
          if (r && r.ok) {
            absorb(report, r.events || [], state);
            report.actions.push({ txt: actDesc(act), n: 1 });
          }
        }
      }
    }

    delete state._offMul;
    state.slots.forEach((id) => {
      const def = globalThis.NPC_BY_ID[id];
      if (def) {
        const diff = npc(state, id).favor - (favorBefore[id] || 0);
        report.favors.push({ id, name: def.name, gained: diff });
      }
    });
    report.package = state._offPackage;
    report.packGold = state._offPackGold;
    report.letterRep = state._offLetterRep;
    report.soldN = state._offSoldN || 0;
    delete state._offPackage; delete state._offPackGold; delete state._offLetterRep; delete state._offIntelEvents;
    delete state._offSoldN;

    state.lastSeen = nowReal;
    return report;
  }

  function absorb(report, events, state) {
    (events || []).forEach((e) => {
      if (e.t === 'wage') report.wage += e.amount;
      else if (e.t === 'milestone') {
        if (e.kind === 'gold') report.milestoneGold += e.amount; else report.milestoneRep += e.amount;
      } else if (e.t === 'stage') {
        report.stageNotes.push((globalThis.NPC_BY_ID[e.id] ? globalThis.NPC_BY_ID[e.id].name : e.id) + ' → ' + e.to);
      } else if (e.t === 'full' || e.t === 'refer') { /* 简报里由 favors/full 体现 */ }
    });
  }
  function actDesc(act) {
    const name = globalThis.NPC_BY_ID[act.id] ? globalThis.NPC_BY_ID[act.id].name : act.id;
    switch (act.act) {
      case 'interact': return '线下互动·' + name;
      case 'wechat': return '微信·' + name;
      case 'workplace': return '职场互动·' + name;
      case 'moments': return '朋友圈·' + name;
      case 'gift': return '送礼（' + B.GIFTS[act.size].label + '）·' + name;
      case 'date': return B.SPEND.date[act.kind].label + '·' + name;
      case 'errand': return '办事·' + name;
      case 'item': return '使用物品·' + name;
      default: return String(act.act);
    }
  }

  // ── 设置 / GM（01 §2.2）──
  function applyPreset(state, key) {
    const p = globalThis.SETTINGS_PRESETS[key];
    if (!p) return { ok: false, msg: '无此预设' };
    state.settings = Object.assign(mergeSettings(), p.patch);
    state.customMode = false;
    return { ok: true };
  }
  function setSetting(state, key, val) {
    if (!(key in globalThis.SETTINGS_DEFAULT)) return { ok: false, msg: '未知参数' };
    if (typeof globalThis.SETTINGS_DEFAULT[key] === 'number') val = Number(val);
    if (typeof globalThis.SETTINGS_DEFAULT[key] === 'boolean') val = !!val;
    state.settings[key] = val;
    if (key !== 'autoPickup' && key !== 'notifyLevel' && key !== 'decisionLogDepth') state.customMode = true;
    return { ok: true };
  }
  function gmGrant(state, kind, n) {
    n = Number(n) || 0;
    if (kind === 'gold') state.gold += n;
    else if (kind === 'rep') state.rep += n;
    else if (kind === 'stamina') state.stamina = Math.min(staminaMaxOf(state), state.stamina + n);
    else if (kind === 'item') {
      const it = globalThis.ITEMS[Math.floor(Math.random() * globalThis.ITEMS.length)];
      invAdd(state, it.id, 'rare');
      return { ok: true, msg: '发放 ' + it.label };
    }
    return { ok: true };
  }
  function gmUnlockTier(state) {
    state.tier = Math.min(B.TIERS.length, state.tier + 1);
    return { ok: true };
  }
  function gmAllFavor(state, n) {
    for (const id in state.npcs) {
      const def = globalThis.NPC_BY_ID[id];
      if (def && !state.npcs[id].asset) grantFavor(state, def, n || 10, []);
    }
    return { ok: true };
  }

  // ── 槽位 ──
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

  globalThis.Engine = {
    newState, migrate, npc, statusOf, tierOpen, tierDef,
    auxAssets, auxBonus, autoFavorPerMin, interactGain, expectedIncomePerSec,
    stageOf, grantFavor, addToSlot, removeFromSlot,
    dayIndex, onDuty, wagePerSec, shiftInfo,
    hireJob, quitJob, startShift, stopShift,
    wechat, moments, workplace, interact,
    overLine, budgetLeftGlobal, budgetLeftNpc,
    priceOf, favorOf, matchTags, hotspotHit, bestVariantIdx,
    spendGift, spendDate, spendErrand, resolveDate, rollDateEvent, revealIntel, maybeReturnGift,
    rollLoot, lootIntervalMs, qualityRollWith, invAdd, invCap, buyInvCap, autoSellRank,
    spawnDrop, collectDrop, sellItem, sellUnitPrice, useItem, sendItem, synthItems, findSynthTriple,
    absorbOfflinePackage,
    checkAchievements, staminaMaxOf, assetCount, perkMul,
    refreshHotspots, inviteRoll, acceptInvite, newDay, logPush,
    step, execAction, settleOffline, applyOfflineLoot,
    applyPreset, setSetting, gmGrant, gmUnlockTier, gmAllFavor,
    upgradeAttr, expandSlot, canEnterTier, enterTier, attrCost,
    fmtMoney, fmtRate
  };

  if (typeof module !== 'undefined') module.exports = globalThis.Engine;
})();
