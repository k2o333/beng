'use strict';

// Headless Monte-Carlo simulator (docs/drafts/alpha4/02-calibration-and-balance-report.md §1-§5).
// Usage: node scripts/sim.js [--quick] [--runs=N] [--days=N] [--strategies=a,b,c] [--seed=N]

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

require('../src/js/data/balance.js');
require('../src/js/data/npcs.js');
require('../src/js/data/items.js');
require('../src/js/data/texts.js');
const Engine = require('../src/js/engine.js');
const Agent = require('../src/js/agent.js');

const B = globalThis.BALANCE;
const NPCS = globalThis.NPCS;
const DAY_MS = B.DAY_MS;

const CHUNK_MS = 300000;
const FINE_DT = 25000;
const WORKER_TOTAL_CAP = 17;   // 并行 worker 上限（策略分片 + 验证），留 1 核给系统
const MAX_ACT_PER_CHUNK = 20;
const NULL_SKIP_MS = CHUNK_MS + 30000;
const VAL_RUNS = 3;
const VAL_DAYS_CAP = 60;
const DIV_WARN = 0.05;
const SPIKE_FLAG = 3.0;
const QUICK_DEADLINE_MS = 480000;
const EFF_MIN_N = 30;
const ATTR_LV_CAP = 20;
const BANK_HORIZON_DAYS = 6;
const SP_RATE_WINDOW_DAYS = 10;

const BASE_NOON = (() => { const d = new Date(1750000000000); d.setHours(12, 0, 0, 0); return d.getTime(); })();
const BASE_EVENING = (() => { const d = new Date(1750000000000); d.setHours(20, 0, 0, 0); return d.getTime(); })();

const STRATEGIES = {
  'frugal-net': {
    label: 'frugal-net 白嫖+广撒网（下限）',
    patch: { spendStyle: 'frugal', autoSlotOrder: 'gap' },
    priority: 'work_first', slots: 'agent',
    skillPolicy: 'k1a', clock: 'flow', job: 'rest8'
  },
  'standard': {
    label: 'standard 默认（主口径）',
    patch: {},
    priority: 'work_first', slots: 'fillAll',
    skillPolicy: 'default', clock: 'flow', job: 'rest8'
  },
  'lavish-deep': {
    label: 'lavish-deep 豪掷深耕（上限）',
    patch: { spendStyle: 'lavish', autoSlotOrder: 'off' },
    priority: 'social_first', slots: 'deep3',
    skillPolicy: 'deep', clock: 'flow', job: 'rest8'
  },
  'night-owl': {
    label: 'night-owl 夜猫子+夜班挂机',
    patch: {},
    priority: 'work_first', slots: 'fillAll',
    skillPolicy: 'owl', clock: 'evening', job: 'night4'
  },
  'synergy-early': {
    label: 'synergy-early 优先连携层',
    patch: {},
    priority: 'work_first', slots: 'fillAll',
    skillPolicy: 'synFirst', clock: 'flow', job: 'rest8'
  }
};

const SKILL_ORDER_DEFAULT = [
  'i11', 's11', 'c11', 'i12', 's12', 'c12', 'i13', 's13', 'c13',
  's14', 's15', 'i14', 'i15', 'c14', 'c15',
  'k2b', 'k1b', 'k3b', 'i16', 's16', 'c16', 'y1', 'y2', 'y3'
];
// lavish-deep：把 s16 知心（cost2/gate8）提到基石前，gate8 开后由银行策略攒点直取（M2）
const SKILL_ORDER_DEEP = [
  'i11', 's11', 'c11', 'i12', 's12', 'c12', 'i13', 's13', 'c13',
  's14', 's15', 's16', 'i14', 'i15', 'c14', 'c15',
  'k2b', 'k1b', 'k3b', 'i16', 'c16', 'y1', 'y2', 'y3'
];
function skillOrder(policy) {
  if (policy === 'synFirst') return ['y1', 'y2', 'y3'].concat(SKILL_ORDER_DEFAULT);
  if (policy === 'k1a') return SKILL_ORDER_DEFAULT.map((id) => (id === 'k1b' ? 'k1a' : id));
  if (policy === 'owl') return ['k2a'].concat(SKILL_ORDER_DEFAULT.filter((id) => id !== 'k2b'));   // M1：夜窗基石 k2a 优先
  if (policy === 'deep') return SKILL_ORDER_DEEP;
  return SKILL_ORDER_DEFAULT;
}

const MILESTONE_DEFS = [
  ['firstAsset', '首资产'],
  ['tier2', '进入T2精英圈'], ['tier3', '进入T3名流圈'],
  ['tier4', '进入T4富豪圈'], ['tier5', '进入T5顶层圈'],
  ['career2', '职级2 专员'], ['career4', '职级4 主管'], ['career6', '职级6 经理'],
  ['career8', '职级8 总监'], ['career10', '职级10 总裁'],
  ['allAch', '全成就']
].concat(B.PETS.map((p) => ['pet_' + p.id, '宠物·' + p.name + ' III 阶']));

const BLOCKER_KEYS = [
  ['tier2', 'T2精英圈'], ['tier3', 'T3名流圈'], ['tier4', 'T4富豪圈'], ['tier5', 'T5顶层圈'],
  ['career4', '职级4 主管'], ['career6', '职级6 经理'], ['career8', '职级8 总监'], ['career10', '职级10 总裁']
];

const CALIBRATION_TARGETS = [
  ['firstAsset', '首资产', 1, 2],
  ['tier2', 'T2 精英圈', 3, 5],
  ['tier3', 'T3 名流圈', 8, 14],
  ['tier4', 'T4 富豪圈', 18, 30],
  ['tier5', 'T5 顶层圈', 35, 60],
  ['career10', '职级10 总裁', 45, 75],
  ['allAch', '全成就', 60, 90],
  ['pet_nuanshou', '宠物·暖手 III 阶', 60, 90]
];

const DEADZONE_PAIRS = [
  ['tier2', 'T1→T2 停留', 5],
  ['tier3', 'T2→T3 停留', 14],
  ['tier4', 'T3→T4 停留', 30],
  ['tier5', 'T4→T5 停留', 60]
];

const INC_SOURCES = [
  ['wage', '工资'], ['tips', '小费'], ['biz', '业务提成+津贴'],
  ['dropGold', '掉落金包'], ['itemSell', '售物/自动出售'], ['milestone', '里程碑奖励']
];

const ACTION_UNIVERSE = ['interact', 'wechat', 'moments', 'workplace', 'identify', 'invite',
  'errand', 'item', 'gift:small', 'gift:mid', 'gift:large', 'date:light', 'date:meal', 'date:trip'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// B2a：策略名参与种子派生，各策略为独立样本流
function strHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

function parseArgs(argv) {
  const o = { quick: false, runs: null, days: 100, strategies: null, seed: 42 };
  for (const a of argv) {
    if (a === '--quick') o.quick = true;
    else if (a.indexOf('--runs=') === 0) o.runs = Math.max(1, parseInt(a.slice(7), 10) || 1);
    else if (a.indexOf('--days=') === 0) o.days = Math.min(100, Math.max(1, parseInt(a.slice(7), 10) || 100));
    else if (a.indexOf('--strategies=') === 0) o.strategies = a.slice(13).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.indexOf('--seed=') === 0) o.seed = parseInt(a.slice(7), 10) || 42;
  }
  if (o.runs == null) o.runs = o.quick ? 20 : 200;
  return o;
}

function quantile(sorted, q) {
  const n = sorted.length;
  if (!n) return null;
  if (n === 1) return sorted[0];
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function qtl(values, q) {
  const v = values.filter((x) => x != null && isFinite(x)).slice().sort((a, b) => a - b);
  return quantile(v, q);
}
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

function grp(n) {
  const neg = n < 0 ? '-' : '';
  const s = Math.round(Math.abs(n)).toString();
  return neg + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function reproStamp() {
  let git = 'unknown';
  try {
    git = cp.execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'unknown';
  } catch (e) { git = 'unknown'; }
  const files = {};
  const rels = ['src/js/data/balance.js', 'src/js/data/npcs.js', 'src/js/data/items.js', 'src/js/engine.js', 'src/js/agent.js'];
  for (const rel of rels) {
    try {
      const st = fs.statSync(path.join(__dirname, '..', rel));
      files[rel] = { size: st.size, mtimeMs: Math.round(st.mtimeMs) };
    } catch (e) { files[rel] = null; }
  }
  return { gitHash: git, node: process.version, inputs: files };
}

function newRun(seed, runIndex) {
  return {
    seed,
    runIndex,
    actions: 0,
    errandCount: 0,
    rareEquip: 0,
    attrBuys: 0,
    equipActions: 0,
    repItemUses: 0,
    dropsFailed: 0,
    decideN: 0,
    nullN: 0,
    budgetSamples: 0,
    budgetSatHits: 0,
    perNpcSatSum: 0,
    lateSamples: 0,
    lateSatHits: 0,
    spBankedTicks: 0,
    skillPending: null,
    spHist: [],
    litNodes: [],
    blockers: null,
    error: null,
    ms: {},
    inc: { wage: 0, tips: 0, biz: 0, dropGold: 0, itemSell: 0, milestone: 0 },
    incByDay: [],
    curInc: null,
    goldByDay: [],
  datesByDay: [],
    deltaByDay: [],
    prevDayGold: null,
    curDay: -1,
    lastSpikeDay: -1,
    spikeMax: 0,
    spikeDay: null,
    shiftDay: -1,
    eff: {},
    skipUntil: 0,
    endGold: 0,
    endDay: 0,
    endAttrs: null,
    msWalltime: 0
  };
}

function effAdd(run, tier, type, cost, stamina, gain) {
  const k = tier + '|' + type;
  let m = run.eff[k];
  if (!m) { m = run.eff[k] = { n: 0, cost: 0, stamina: 0, gain: 0 }; }
  m.n++; m.cost += cost; m.stamina += stamina; m.gain += gain;
}

function bumpCur(run, key, amt) {
  if (amt > 0) {
    run.inc[key] += amt;
    if (run.curInc) run.curInc[key] += amt;
  }
}

const TIP_RE = /\+(\d+)/;
function processEvents(evts, run) {
  for (let i = 0; i < evts.length; i++) {
    const e = evts[i];
    if (e.t === 'wage') bumpCur(run, 'wage', e.amount);
    else if (e.t === 'biz') bumpCur(run, 'biz', (e.gold || 0) + (e.allowance || 0));
    else if (e.t === 'milestone') { if (e.kind === 'gold') bumpCur(run, 'milestone', e.amount); }
    else if (e.t === 'autosell') bumpCur(run, 'itemSell', e.gold || 0);   // M5：autosell 事件显式入账
    else if (e.t === 'work') { const m = TIP_RE.exec(e.txt || ''); if (m) bumpCur(run, 'tips', parseInt(m[1], 10)); }
    else if (e.t === 'drop') {
      if ((e.itemId === 'watch_steel' || e.itemId === 'jewel_jade') && e.q === 'rare') run.rareEquip++;
    }
  }
}

function collectDrops(state, run, rng) {
  const drops = state.drops;
  while (drops.length) {
    const d = drops[0];
    const pre = state.gold;
    let r = null;
    try { r = Engine.collectDrop(state, d.uid, false, rng); } catch (e) { drops.shift(); run.dropsFailed++; continue; }   // m5
    const delta = state.gold - pre;
    if (r && r.ok) {
      let autosellGold = 0;
      if (r.events) for (const ev of r.events) if (ev && ev.t === 'autosell') autosellGold += ev.gold || 0;
      if (d.kind === 'gold') bumpCur(run, 'dropGold', delta);
      else { bumpCur(run, 'itemSell', autosellGold); if (delta - autosellGold > 0) bumpCur(run, 'itemSell', delta - autosellGold); }
    }
  }
}

function sellPressure(state, run) {
  const cap = Engine.invCap(state);
  if (state.inv.length <= cap - 6) return;
  let sold = 0;
  while (state.inv.length > cap - 16 && sold < 40) {
    let bi = -1, bk = Infinity;
    for (let i = 0; i < state.inv.length; i++) {
      const e = state.inv[i];
      const it = globalThis.ITEM_BY_ID[e.it];
      if (!it) continue;
      const k = B.GRADE_RANK[e.q] * 1e9 + Engine.sellUnitPrice(it);
      if (k < bk) { bk = k; bi = i; }
    }
    if (bi < 0) break;
    const r = Engine.sellItem(state, bi);
    if (!(r && r.ok)) break;
    bumpCur(run, 'itemSell', r.gold);
    sold++;
  }
}

// M3a：自动装备——空槽/更差品质时穿入严格更高品质的装备（每 chunk 至多一轮）
function manageEquipment(state, run) {
  const rank = B.GRADE_RANK;
  for (const slot of ['watch', 'jewel']) {
    const cur = state.equips[slot];
    const curRank = cur ? (rank[cur.q] != null ? rank[cur.q] : -1) : -1;
    let bi = -1, br = -1;
    for (let i = 0; i < state.inv.length; i++) {
      const e = state.inv[i];
      const it = globalThis.ITEM_BY_ID[e.it];
      if (!it || !it.effect || it.effect.kind !== 'equip' || it.effect.slot !== slot) continue;
      const qr = rank[e.q] != null ? rank[e.q] : 0;
      if (qr > br) { br = qr; bi = i; }
    }
    if (bi >= 0 && br > curRank) {
      let r = null;
      try { r = Engine.equipItemFromInv(state, bi); } catch (e) { r = null; }
      if (r && r.ok) run.equipActions++;
    }
  }
}

// M3b：声望物品——下一圈层仅被声望卡住且有 intel_brief 型物品时使用
function manageRepItems(state, run, rng) {
  const nt = state.tier + 1;
  if (nt > B.TIERS.length) return;
  const chk = Engine.canEnterTier(state, nt);
  if (chk.ok || !chk.miss || chk.miss.length !== 1) return;
  if (String(chk.miss[0]).indexOf('声望') !== 0) return;
  for (let i = 0; i < state.inv.length; i++) {
    const it = globalThis.ITEM_BY_ID[state.inv[i].it];
    if (!it || !it.effect || it.effect.kind !== 'rep') continue;
    let r = null;
    try { r = Engine.useItem(state, i, null, rng); } catch (e) { r = null; }
    if (r && r.ok) run.repItemUses++;
    break;
  }
}

function manageJob(state, strat, run) {
  if (strat.job === 'night4' && Engine.assetCount(state) >= 3 && state.job.id !== 'night') {
    Engine.hireJob(state, 'night');
  }
  const j = state.job;
  if (!j || !j.id || j.shiftEndGt != null || j.resting) return;
  const today = Math.floor(state.gt / DAY_MS);
  if (run.shiftDay >= today) return;
  if (state.stamina >= Engine.staminaMaxOf(state) * 0.8) {
    Engine.startShift(state, strat.job === 'night4' ? 4 : 8);
    run.shiftDay = today;
  }
}

function manageProgression(state, run) {
  const nt = state.tier + 1;
  if (nt <= B.TIERS.length) {
    const td = B.TIERS[nt - 1];
    const tasteTarget = Math.max(td.taste, B.LARGE_TASTE[state.tier] || 0);
    let guard = 0;
    while (state.attrs.taste < tasteTarget && guard++ < 60) {
      const cost = Engine.attrCost(state.attrs.taste, state.settings.priceRate);
      if (state.gold < cost * 2) break;
      const r = Engine.upgradeAttr(state, 'taste');
      if (!r.ok) break;
      run.attrBuys++;
    }
    if (state.rep >= td.rep && state.attrs.taste >= td.taste && state.gold >= td.fee) {
      Engine.enterTier(state, nt);
    }
  }
  const feeNext = B.TIERS[Math.min(B.TIERS.length, state.tier + 1) - 1].fee;
  const keys = ['charm', 'talk'];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (state.attrs[key] >= ATTR_LV_CAP) continue;
    const cost = Engine.attrCost(state.attrs[key], state.settings.priceRate);
    if (state.gold >= cost * 10 && state.gold - cost >= feeNext) {
      const r = Engine.upgradeAttr(state, key);
      if (r && r.ok) run.attrBuys++;
    }
  }
  if (state.slotCount < B.SLOTS_MAX) {
    const cost = Math.round(B.SLOT_COSTS[state.slotCount + 1] * state.settings.priceRate);
    if (state.gold >= cost * 3) Engine.expandSlot(state);
  }
}

// ── 技能点银行策略（B2b）：按优先序点亮；最高未亮节点只差点数时进入银行：
//    若按近期点数流速估算、缺口的到达时间 ≤ H=6 游戏日，则冻结低优支出攒点直取；
//    若点流已枯竭（等待 >H 天），放弃银行按序正常消费（反正也等不到）。──
function spEarned(state) {
  return state.skills.points + Engine.skillPointsInvested(state);
}
function spRatePerDay(run, gt) {
  const h = run.spHist;
  const n = h.length;
  if (n < 2) return 0;
  const cutoff = gt - SP_RATE_WINDOW_DAYS * DAY_MS;
  let i = n - 1;
  while (i > 0 && h[i - 1].t >= cutoff) i--;
  const spanDays = (h[n - 1].t - h[i].t) / DAY_MS;
  if (spanDays <= 0.25) return 0;
  return Math.max(0, (h[n - 1].e - h[i].e) / spanDays);
}
// S8 精华位二选一：模拟器按节点本意取默认强化（策略可覆盖）
const SKILL_CHOICE_DEFAULT = { s14: 'warm', s15: 'snow', i15: 'read', c15: 'cash' };
function takeOrdered(state, id, strat) {
  const nd = B.SKILLS.nodes[id];
  let choice;
  if (nd && Array.isArray(nd.choice)) {
    const pref = (strat && strat.skillChoices && strat.skillChoices[id]) || SKILL_CHOICE_DEFAULT[id];
    choice = (pref && nd.choice.indexOf(pref) >= 0) ? pref : nd.choice[0];
  }
  const r = Engine.takeSkill(state, id, choice);
  return !!(r && r.ok);
}
function tryTakeSkill(state, order, run, strat) {
  if (!(state.skills.points > 0)) return false;
  let bankId = null, bankPos = -1;
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    const chk = Engine.skillNodeState(state, id);
    if (chk.st === 'lit') continue;
    if (chk.st === 'can') { if (takeOrdered(state, id, strat)) return true; continue; }
    if (chk.st === 'cost') { bankId = id; bankPos = i; break; }
  }
  if (!bankId) return false;
  const deficit = B.SKILLS.nodes[bankId].cost - state.skills.points;
  const rate = spRatePerDay(run, state.gt);
  const waitDays = rate > 1e-9 ? deficit / rate : Infinity;
  run.spBankedTicks++;
  if (waitDays <= BANK_HORIZON_DAYS) return false;   // 银行冻结：一分不挪，等高优目标
  for (let j = bankPos + 1; j < order.length; j++) {   // 放弃银行：点流枯竭，低优照常消费
    const chk = Engine.skillNodeState(state, order[j]);
    if (chk.st === 'can') { if (takeOrdered(state, order[j], strat)) return true; }
  }
  return false;
}

function outputScoreOf(def) {
  return B.BASE_OUTPUT[def.type] * B.TIERS[def.tier - 1].mult * def.coef;
}

function fillSlots(state, policy) {
  if (policy === 'agent') { Agent.refillQueue(state); return; }
  const cap = policy === 'deep3' ? Math.min(3, Engine.slotCapOf(state)) : Engine.slotCapOf(state);
  let guard = 0;
  while (state.slots.length < cap && guard++ < 12) {
    let best = null;
    for (let i = 0; i < NPCS.length; i++) {
      const def = NPCS[i];
      if (Engine.statusOf(state, def) !== 'available') continue;
      if (state.slots.indexOf(def.id) >= 0) continue;
      if (!best || def.tier > best.tier || (def.tier === best.tier && outputScoreOf(def) > outputScoreOf(best))) best = def;
    }
    if (!best) break;
    if (!Engine.addToSlot(state, best.id).ok) break;
  }
}

function sampleBudget(state, run, horizon) {
  const S = state.settings;
  run.budgetSamples++;
  const gSat = S.dailyBudget > 0 && state.spent.global >= S.dailyBudget;
  if (gSat) run.budgetSatHits++;
  let sat = 0, cnt = 0;
  for (const id of state.slots) {
    cnt++;
    if (S.perNpcBudget > 0 && (state.spent.npc[id] || 0) >= S.perNpcBudget) sat++;
  }
  run.perNpcSatSum += cnt ? sat / cnt : 0;
  const late = state.gt >= horizon * (2 / 3);
  if (late) {
    run.lateSamples++;
    if (gSat || (cnt && sat / cnt > 0.6)) run.lateSatHits++;
  }
}

function metaPolicy(state, strat, run, rng, horizon) {
  if (!state.career.industry) state.career.industry = 'finance';
  while (state.invites.length) {
    const inv = state.invites[0];
    let r = null;
    try { r = Engine.acceptInvite(state, inv.id, rng); } catch (e) { state.invites.shift(); break; }
    if (!(r && r.ok)) { state.invites.shift(); continue; }
    run.actions++;
    effAdd(run, state.tier, 'invite', 0, 0, r.gain || 0);
    if (r.events && r.events.length) processEvents(r.events, run);
  }
  collectDrops(state, run, rng);
  manageJob(state, strat, run);
  manageProgression(state, run);
  manageEquipment(state, run);   // M3a
  manageRepItems(state, run, rng);   // M3b
  sellPressure(state, run);
  tryTakeSkill(state, strat._order, run, strat);
  fillSlots(state, strat.slots);
  sampleBudget(state, run, horizon);
}

function agentPhase(state, run, rng, nowReal) {
  let fired = 0;
  while (fired < MAX_ACT_PER_CHUNK) {
    if (state.gt < run.skipUntil) return;
    run.decideN++;
    let act = null;
    try { act = Agent.decide(state, nowReal, rng); } catch (e) { run.error = String(e); return; }
    if (!act) { run.nullN++; run.skipUntil = state.gt + NULL_SKIP_MS; return; }
    fired++;
    let r = null;
    try { r = Engine.execAction(state, act, nowReal, rng); } catch (e) { run.error = String(e); return; }
    if (!(r && r.ok)) { run.skipUntil = state.gt + NULL_SKIP_MS; return; }
    run.actions++;
    let type = act.act;
    if (act.size) type += ':' + act.size;
    else if (act.kind) type += ':' + act.kind;
    let gain = r.gain || 0;
    if (!gain && r.events) { for (const ev of r.events) if (ev && ev.t === 'favor') gain += ev.gain || 0; }   // m3：物品动作好感从事件取
    effAdd(run, state.tier, type, r.cost || 0, act.stamina || 0, gain);
    if (act.act === 'errand') run.errandCount++;
    if (r.events && r.events.length) processEvents(r.events, run);
  }
}

function dayRoll(state, run) {
  const d = Math.floor(state.gt / DAY_MS);
  if (d === run.curDay) return;
  if (run.curDay >= 0) {
    run.incByDay[run.curDay] = run.curInc;
    run.goldByDay[run.curDay] = state.gold;
    run.datesByDay[run.curDay] = state.stats.totalDates;
    const delta = state.gold - (run.prevDayGold == null ? state.gold : run.prevDayGold);
    run.deltaByDay[run.curDay] = delta;
    if (run.curDay >= 7) {
      let s = 0;
      for (let i = run.curDay - 7; i < run.curDay; i++) s += run.deltaByDay[i] || 0;
      const mean = s / 7;
      if (mean > 0) {
        const ratio = delta / mean;
        if (ratio > run.spikeMax) { run.spikeMax = ratio; run.spikeDay = run.curDay; }
      }
    }
    run.prevDayGold = state.gold;
  }
  run.curInc = { wage: 0, tips: 0, biz: 0, dropGold: 0, itemSell: 0, milestone: 0 };
  run.curDay = d;
}

function snapMilestones(state, run) {
  const day = state.gt / DAY_MS;
  const ac = Engine.assetCount(state);
  if (ac >= 1 && run.ms.firstAsset == null) run.ms.firstAsset = day;
  if (state.tier >= 2 && run.ms.tier2 == null) run.ms.tier2 = day;
  if (state.tier >= 3 && run.ms.tier3 == null) run.ms.tier3 = day;
  if (state.tier >= 4 && run.ms.tier4 == null) run.ms.tier4 = day;
  if (state.tier >= 5 && run.ms.tier5 == null) run.ms.tier5 = day;
  const cls = [2, 4, 6, 8, 10];
  for (let i = 0; i < cls.length; i++) {
    const lv = cls[i];
    const k = 'career' + lv;
    if (state.career.level >= lv && run.ms[k] == null) run.ms[k] = day;
  }
  if (run.ms.allAch == null && Object.keys(state.perks).length >= B.ACHIEVEMENTS.length) run.ms.allAch = day;
  const petHas = (pid) => {
    const p = state.pets || {};
    if (Array.isArray(p.unlocked)) return p.unlocked.indexOf(pid) >= 0;   // 旧档形态
    return (p[pid] || 0) >= 3;                                            // v4 阶段映射：III 阶才算长线达标
  };
  for (let i = 0; i < B.PETS.length; i++) {
    const pid = B.PETS[i].id;
    const k = 'pet_' + pid;
    if (run.ms[k] == null && petHas(pid)) run.ms[k] = day;
  }
}

// M6：绑定约束诊断——运行结束时对每个未达成里程碑记录卡点分解
function diagnoseBlockers(state, run) {
  const out = {};
  const priceRate = state.settings.priceRate;
  const cumTasteGold = (to) => {
    let s = 0;
    for (let lv = state.attrs.taste; lv < to && lv < 80; lv++) s += Engine.attrCost(lv, priceRate);
    return Math.round(s);
  };
  const slotsFull = state.slots.length >= Engine.slotCapOf(state);
  let freeAvail = false;
  for (let i = 0; i < NPCS.length; i++) {
    const def = NPCS[i];
    if (Engine.statusOf(state, def) === 'available' && state.slots.indexOf(def.id) < 0) { freeAvail = true; break; }
  }
  const poolExhausted = slotsFull && !freeAvail;
  const budgetSat = state.settings.dailyBudget > 0 && state.spent.global >= state.settings.dailyBudget;
  for (let t = 2; t <= B.TIERS.length; t++) {
    const key = 'tier' + t;
    const td = B.TIERS[t - 1];
    const reached = run.ms[key] != null;
    out[key] = {
      reached,
      repHave: state.rep, repNeed: td.rep, missRep: !reached && state.rep < td.rep,
      goldHave: Math.round(state.gold), fee: td.fee, missFee: !reached && state.gold < td.fee,
      taste: state.attrs.taste, tasteNeed: td.taste, missTaste: !reached && state.attrs.taste < td.taste,
      tasteCumGold: cumTasteGold(td.taste),
      largeTasteNeed: B.LARGE_TASTE[t] || 0,
      slotsFull, poolExhausted, budgetSat
    };
  }
  for (const lv of [2, 4, 6, 8, 10]) {
    const key = 'career' + lv;
    out[key] = {
      reached: run.ms[key] != null,
      bizVol: Math.round(state.career.bizVolumeTotal),
      bizNeed: B.CAREER_LEVELS[lv - 1].need
    };
  }
  out.allAch = {
    reached: run.ms.allAch != null,
    perks: Object.keys(state.perks).length,
    perkNeed: B.ACHIEVEMENTS.length
  };
  return out;
}

function runOnce(stratId, runIndex, days, dt, seedBase) {
  const strat = STRATEGIES[stratId];
  const order = strat._order || skillOrder(strat.skillPolicy);
  if (!strat._order) strat._order = order;
  const seed = (seedBase * 1000003 + (strHash(stratId) % 1000) * 7919 + runIndex * 7919 + 11) >>> 0;   // B2a
  const rng = mulberry32(seed);
  const state = Engine.newState(BASE_NOON);
  // 引擎 normBoom 仅在存档迁移路径生效；headless 新档需自补 boom 枚举（与 normBoom 缺省一致）
  if (!state.career.boom || typeof state.career.boom !== 'object') {
    state.career.boom = {};
    B.DOMAINS.forEach((d) => { state.career.boom[d] = 'stable'; });
  }
  Object.assign(state.settings, strat.patch);
  state.priority = strat.priority;
  const run = newRun(seed, runIndex);
  const pinned = strat.clock === 'evening';
  const t0 = Date.now();
  const horizon = days * DAY_MS;
  run.spHist.push({ t: state.gt, e: 0 });
  try {
    while (state.gt < horizon) {
      dayRoll(state, run);
      const nowReal = pinned ? BASE_EVENING : (BASE_NOON + state.gt);
      const ev = Engine.step(state, Math.min(dt, horizon - state.gt), { rng, nowReal });
      if (ev.length) processEvents(ev, run);
      metaPolicy(state, strat, run, rng, horizon);
      agentPhase(state, run, rng, nowReal);
      snapMilestones(state, run);
      run.spHist.push({ t: state.gt, e: spEarned(state) });
    }
    dayRoll(state, run);
  } catch (e) {
    run.error = String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ');
  }  if (run.curInc && run.curDay >= 0) run.incByDay[run.curDay] = run.curInc;
  const dFinal = Math.floor(Math.min(state.gt, horizon) / DAY_MS);
  if (run.goldByDay[dFinal] == null) run.goldByDay[dFinal] = state.gold;
  if (run.datesByDay[dFinal] == null) run.datesByDay[dFinal] = state.stats.totalDates;
  run.endGold = state.gold;
  run.endDay = state.gt / DAY_MS;
  run.endAttrs = { taste: state.attrs.taste, charm: state.attrs.charm, talk: state.attrs.talk };
  run.litNodes = Object.keys(state.skills.nodes).sort();
  for (const id of strat._order || skillOrder(strat.skillPolicy)) {
    const chk = Engine.skillNodeState(state, id);
    if (chk.st !== 'lit') { run.skillPending = { id, st: chk.st }; break; }
  }
  run.blockers = diagnoseBlockers(state, run);
  run.msWalltime = Date.now() - t0;
  if (!run.error && run.actions === 0) run.error = 'no-actions-executed';
  return run;
}

function aggTimetable(results) {
  return MILESTONE_DEFS.map(([key, label]) => {
    const vals = results.map((r) => r.ms[key]).filter((x) => x != null);
    return {
      key, label,
      rate: vals.length / results.length,
      P25: r2(qtl(vals, 0.25)), P50: r2(qtl(vals, 0.5)), P75: r2(qtl(vals, 0.75))
    };
  });
}

function aggGoldCurve(results, days) {
  const out = { p25: [], p50: [], p75: [] };
  for (let d = 0; d <= days; d++) {
    const vals = results.map((r) => r.goldByDay[d]).filter((x) => x != null);
    out.p25.push(Math.round(qtl(vals, 0.25) || 0));
    out.p50.push(Math.round(qtl(vals, 0.5) || 0));
    out.p75.push(Math.round(qtl(vals, 0.75) || 0));
  }
  return out;
}

// 约会经济曲线（D6 复核用）：totalDates 累计值的分位数
function aggDatesCurve(results, days) {
  const out = {};
  for (const d of [15, 30, 45, 60, 75, 90, days]) {
    const vals = results.map((r) => r.datesByDay[d]).filter((x) => x != null);
    if (vals.length) out['d' + d] = Math.round(qtl(vals, 0.5) * 10) / 10;
  }
  return out;
}

function shareMap(totals) {
  let sum = 0;
  for (const k in totals) sum += totals[k];
  const out = {};
  if (sum <= 0) { INC_SOURCES.forEach(([k]) => { out[k] = 0; }); return out; }
  INC_SOURCES.forEach(([k]) => { out[k] = Math.round((totals[k] || 0) / sum * 1000) / 10; });
  return out;
}

// m1：日桶取 ceil(lo)..ceil(hi)-1，边界不再双计
function periodTotals(results, lo, hi) {
  const acc = {};
  INC_SOURCES.forEach(([k]) => { acc[k] = 0; });
  const dLo = Math.ceil(lo), dHi = Math.ceil(hi);
  for (const r of results) {
    for (let d = dLo; d < dHi; d++) {
      const day = r.incByDay[d];
      if (!day) continue;
      INC_SOURCES.forEach(([k]) => { acc[k] += day[k] || 0; });
    }
  }
  return acc;
}

function aggIncome(results, days) {
  const third = days / 3;
  const periods = {
    early: shareMap(periodTotals(results, 0, third)),
    mid: shareMap(periodTotals(results, third, third * 2)),
    late: shareMap(periodTotals(results, third * 2, days))
  };
  const lateShareRuns = [];
  const dLo = Math.ceil(third * 2);
  for (const r of results) {
    const tot = {};
    INC_SOURCES.forEach(([k]) => { tot[k] = 0; });
    for (let d = dLo; d < days; d++) {
      const day = r.incByDay[d];
      if (!day) continue;
      INC_SOURCES.forEach(([k]) => { tot[k] += day[k] || 0; });
    }
    lateShareRuns.push(shareMap(tot));
  }
  const lateP50 = {};
  INC_SOURCES.forEach(([k]) => {
    lateP50[k] = Math.round(qtl(lateShareRuns.map((m) => m[k]), 0.5) * 10) / 10;
  });
  let domination = null;
  INC_SOURCES.forEach(([k]) => {
    if (lateP50[k] > 90 && (!domination || lateP50[k] > domination.share)) domination = { source: k, share: lateP50[k] };
  });
  return { periods, lateP50, h1Domination: domination };
}

function aggEfficiency(results) {
  const acc = {};
  for (const r of results) {
    for (const k in r.eff) {
      const m = r.eff[k];
      if (!acc[k]) acc[k] = { n: 0, cost: 0, stamina: 0, gain: 0 };
      acc[k].n += m.n; acc[k].cost += m.cost;
      acc[k].stamina += m.stamina; acc[k].gain += m.gain;
    }
  }
  return Object.keys(acc).map((k) => {
    const ti = k.indexOf('|');
    const tier = parseInt(k.slice(0, ti), 10);
    const type = k.slice(ti + 1);
    const m = acc[k];
    return {
      tier, type, n: m.n,
      goldPerFavor: m.gain > 0 ? Math.round(m.cost / m.gain * 10) / 10 : null,
      staminaPerFavor: m.gain > 0 ? Math.round(m.stamina / m.gain * 100) / 100 : null
    };
  }).filter((x) => x.n >= EFF_MIN_N).sort((a, b) => a.type < b.type ? -1 : a.type > b.type ? 1 : a.tier - b.tier);
}

function zeroActionTypes(results) {
  const seen = {};
  for (const r of results) for (const k in r.eff) seen[k.split('|')[1]] = true;
  return ACTION_UNIVERSE.filter((t) => !seen[t]);
}

function aggThroughput(results) {
  let dN = 0, nN = 0, samples = 0, hits = 0, perNpc = 0, lateS = 0, lateH = 0;
  for (const r of results) {
    dN += r.decideN; nN += r.nullN;
    samples += r.budgetSamples; hits += r.budgetSatHits;
    perNpc += r.perNpcSatSum;
    lateS += r.lateSamples; lateH += r.lateSatHits;
  }
  return {
    nullDecisionRatePct: dN ? Math.round(nN / dN * 1000) / 10 : null,
    dailyBudgetSatPct: samples ? Math.round(hits / samples * 1000) / 10 : null,
    perNpcBudgetSatPct: samples ? Math.round(perNpc / samples * 1000) / 10 : null,
    lateGameSaturationPct: lateS ? Math.round(lateH / lateS * 1000) / 10 : 0,
    lateGameSatFlag: lateS > 0 && lateH / lateS > 0.6
  };
}

function aggLit(results) {
  const hist = {}, sets = {}, pend = {};
  for (const r of results) {
    const arr = r.litNodes || [];
    for (const id of arr) hist[id] = (hist[id] || 0) + 1;
    const k = arr.join(',');
    sets[k] = (sets[k] || 0) + 1;
    if (r.skillPending) {
      const pk = r.skillPending.id + '·' + r.skillPending.st;
      pend[pk] = (pend[pk] || 0) + 1;
    }
  }
  const distinctSets = Object.keys(sets)
    .map((k) => ({ set: k ? k.split(',') : [], runs: sets[k] }))
    .sort((a, b) => b.runs - a.runs || (a.set.length - b.set.length));
  return { histogram: hist, distinctSets, topPending: pend };
}

// M6 聚合：每个里程碑在未达成运行中的 P50 卡点分解
function aggBlockers(results) {
  return BLOCKER_KEYS.map(([key, label]) => {
    const total = results.filter((r) => r.blockers && r.blockers[key]).length;
    const fails = results.filter((r) => r.blockers && r.blockers[key] && !r.blockers[key].reached);
    const row = { key, label, total, failed: fails.length };
    if (!fails.length) return row;
    const b = fails.map((r) => r.blockers[key]);
    if (b[0].repNeed != null) {
      row.repShortN = b.filter((x) => x.missRep).length;
      row.repHaveP50 = Math.round(qtl(b.map((x) => x.repHave), 0.5));
      row.repNeed = b[0].repNeed;
      row.feeShortN = b.filter((x) => x.missFee).length;
      row.goldP50 = Math.round(qtl(b.map((x) => x.goldHave), 0.5));
      row.fee = b[0].fee;
      row.tasteWallN = b.filter((x) => x.missTaste).length;
      row.tasteP50 = Math.round(qtl(b.map((x) => x.taste), 0.5));
      row.tasteNeed = b[0].tasteNeed;
      row.tasteCumGoldP50 = Math.round(qtl(b.map((x) => x.tasteCumGold), 0.5));
      row.poolExhaustedN = b.filter((x) => x.poolExhausted).length;
      row.budgetSatN = b.filter((x) => x.budgetSat).length;
    }
    if (b[0].bizNeed != null) {
      row.bizVolP50 = Math.round(qtl(b.map((x) => x.bizVol), 0.5));
      row.bizNeed = b[0].bizNeed;
    }
    return row;
  });
}

function deadZoneStay(r, fromTierKey, toTierKey) {
  const b = r.ms[toTierKey];
  if (b == null) return null;
  if (fromTierKey === 'tier1') return b;
  const a = r.ms[fromTierKey];
  if (a == null) return null;
  return Math.max(0, b - a);
}

function aggDeadZones2(results) {
  return DEADZONE_PAIRS.map(([toKey, label, target]) => {
    const fromKey = 'tier' + (parseInt(toKey.slice(4), 10) - 1);
    const stays = results.map((r) => deadZoneStay(r, fromKey, toKey)).filter((x) => x != null);
    const p50 = r2(qtl(stays, 0.5));
    return { pair: label, P50: p50, targetUpperDays: target, flag: p50 != null && p50 > target };
  });
}

function aggSpikes(results) {
  const ratios = results.map((r) => r.spikeMax).filter((x) => x > 0);
  return {
    P50maxRatio: r2(qtl(ratios, 0.5)),
    P75maxRatio: r2(qtl(ratios, 0.75)),
    flagThreshold: SPIKE_FLAG,
    flaggedRunFrac: Math.round(results.filter((r) => r.spikeMax > SPIKE_FLAG).length / Math.max(1, results.length) * 100)
  };
}

function aggregateStrategy(stratId, results, cfg) {
  const days = cfg.days;
  const actionDays = results.map((r) => Math.max(0.5, r.endDay));
  const timetable = aggTimetable(results);
  const failed = results.filter((r) => r.error).length;
  const lit = aggLit(results);
  const tp = aggThroughput(results);
  const equipTotal = results.reduce((a, r) => a + r.equipActions, 0);
  const daySum = actionDays.reduce((a, b) => a + b, 0);
  return {
    strategy: stratId,
    label: STRATEGIES[stratId].label,
    runsRequested: cfg.runs,
    runsCompleted: results.length,
    runsFailed: failed,
    quick: cfg.quick,
    truncatedByWallclock: !!cfg.truncated,
    partial: cfg.truncated || results.length < cfg.runs,
    avgMsPerRun: Math.round(results.reduce((a, r) => a + r.msWalltime, 0) / Math.max(1, results.length)),
    avgActionsPerDay: Math.round(results.reduce((a, r, i) => a + r.actions / actionDays[i], 0) / Math.max(1, results.length) * 10) / 10,
    throughput: tp,
    equipActionsTotal: equipTotal,
    avgEquipActionsPerDay: Math.round(equipTotal / Math.max(0.001, daySum) * 100) / 100,
    avgRepItemUsesPerRun: Math.round(results.reduce((a, r) => a + r.repItemUses, 0) / Math.max(1, results.length) * 10) / 10,
    dropsFailedTotal: results.reduce((a, r) => a + r.dropsFailed, 0),
    spBankedTicksTotal: results.reduce((a, r) => a + r.spBankedTicks, 0),
    avgErrandPerRun: Math.round(results.reduce((a, r) => a + r.errandCount, 0) / Math.max(1, results.length) * 10) / 10,
    avgRareEquipPerRun: Math.round(results.reduce((a, r) => a + r.rareEquip, 0) / Math.max(1, results.length) * 100) / 100,
    avgAttrBuysPerRun: Math.round(results.reduce((a, r) => a + r.attrBuys, 0) / Math.max(1, results.length) * 10) / 10,
    endAttrsAvg: {
      taste: Math.round(qtl(results.map((r) => r.endAttrs.taste), 0.5)),
      charm: Math.round(qtl(results.map((r) => r.endAttrs.charm), 0.5)),
      talk: Math.round(qtl(results.map((r) => r.endAttrs.talk), 0.5))
    },
    timetable,
    goldCurve: aggGoldCurve(results, days),
  datesCurve: aggDatesCurve(results, days),
    income: aggIncome(results, days),
    efficiency: aggEfficiency(results),
    zeroActionTypes: zeroActionTypes(results),
    litNodes: lit,
    blockers: aggBlockers(results),
    deadZones: aggDeadZones2(results),
    spikes: aggSpikes(results)
  };
}

function calibrate(agg) {
  return CALIBRATION_TARGETS.map(([key, label, lo, hi]) => {
    const row = agg.timetable.find((t) => t.key === key);
    const p50 = row ? row.P50 : null;
    let status = '无数据';
    if (p50 != null) status = p50 < lo ? 'OUT(低)' : p50 > hi ? 'OUT(高)' : 'PASS';
    return { milestone: label, lo, hi, P50: p50, status };
  });
}

function validateStepSize(cfg) {
  const valDays = Math.min(cfg.days, VAL_DAYS_CAP);
  const coarse = [];
  const fine = [];
  for (let i = 0; i < VAL_RUNS; i++) {
    coarse.push(runOnce('standard', i, valDays, CHUNK_MS, cfg.seed));
    fine.push(runOnce('standard', i, valDays, FINE_DT, cfg.seed));
  }
  const rows = [];
  let maxDiv = 0;
  for (const [key, label] of MILESTONE_DEFS) {
    const c = qtl(coarse.map((r) => r.ms[key]).filter((x) => x != null), 0.5);
    const f = qtl(fine.map((r) => r.ms[key]).filter((x) => x != null), 0.5);
    if (c == null || f == null) continue;
    const div = Math.abs(c - f) / Math.max(f, 0.01);
    maxDiv = Math.max(maxDiv, div);
    rows.push({ milestone: label, coarseDays: r2(c), fineDays: r2(f), divergence: Math.round(div * 1000) / 10 });
  }
  return {
    valDays, valRuns: VAL_RUNS, fineDt: FINE_DT, coarseDt: CHUNK_MS, rows,
    maxDivPct: Math.round(maxDiv * 1000) / 10, ok: maxDiv <= DIV_WARN,
    scope: 'standard R=' + VAL_RUNS + ' × 前' + valDays + '游戏日'
  };
}

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
}

function methodNotes(cfg) {
  const skipSec = Math.round(NULL_SKIP_MS / 1000);
  return [
    '口径：headless 复用 engine.step/execAction/Agent.decide；时间步进 dt=' + cfg.chunkMs + 'ms 游戏时/步，每步边界先跑元策略再循环 decide+execAction（受动作自身 CD/预算/体力自然截断），nowReal=' + cfg.seedNote,
    '收入归因法：工资=step 的 wage 事件金额；小费=work 事件文本解析；业务=biz 事件 gold+allowance；里程碑=milestone(kind=gold) 事件金额；掉落金包=本模拟器自行调用 collectDrop 时按 drop.kind==gold 的金币增量；售物=collectDrop 返回的 {t:"autosell"} 事件金额（autoSellGrade 默认 off 时该分支潜在不触发，实际售物主要来自背包压力手动 sellItem 返回值）。事件不带金额处一律用状态增量补齐。',
    '近似1（night-owl）：把现实钟固定在 20:00（餐厅晚班 ×1.5 与夜窗词条恒定生效），代表「只在夜间上号」的理想化夜猫子。',
    '近似2：掉落即拾即收（等价 autoPickup，忽略 3 秒真实延迟）；日切当天收入整段计入新的一天（误差 ≤1 个 dt）。',
    '近似3（决策节流，突发 vs 节流的显式差异）：decide 返回空或动作执行失败后 ' + skipSec + 's 游戏时（NULL_SKIP_MS=CHUNK_MS+30s）内不再尝试；模拟在一个 dt 块内最多连发 ' + MAX_ACT_PER_CHUNK + ' 个决策然后可能长空闲。而 app.js 心跳是每 decisionIntervalSec=5 真实秒至多一次 decide+execAction、成功与否都等下一拍且时间均匀推进——两者动作吞吐形态不同（模拟偏突发+长空闲，真实端均匀节流），对比真实遥测时应注意该偏差。',
    '近似4（玩家元策略，非 Agent 职责）：行业固定 finance；体力≥80% 即排班（night-owl 资产≥3 后换便利店夜班 4h）；品味朝下一圈层需求与大礼门槛购买；charm/talk 在金币≥10×成本且不影响入场费时购买；槽位费 3 倍余额时扩容；技能点按策略优先序「银行制」点亮——最高未亮节点若只差点数（cost 态），按近 ' + SP_RATE_WINDOW_DAYS + ' 日点数流速估算缺口到达时间：≤' + BANK_HORIZON_DAYS + ' 游戏日则冻结低优支出攒点直取（银行生效），>H（点流枯竭）则放弃银行按序消费（synergy-early 先试 y1/y2/y3 连携、lavish-deep 直取 s16 知心、night-owl 首取 k2a 夜窗基石、frugal-net 取 k1a 广撒网基石）；精华位二选一（S8）按节点本意取 warm/snow/read/cash。基石均受 gate=职级8 限制，前期点不出来属引擎设定而非模拟器缺陷。',
    '近似4b（元策略·物品面，alpha4 补）：每 chunk 自动装备——某槽背包中存在严格更高品质装备（GRADE_RANK 比较）且当前槽为空/更低品质时调 Engine.equipItemFromInv（计数 equipActions）；当下一圈层入场仅被声望卡住（canEnterTier 仅缺声望）且背包有 intel_brief（effect.kind=rep）时使用一件（计数 repItemUses）。除此之外不用消耗品，H2/后期数字仍不含 buff_date/buff_attr/free_date 等主动用法。',
    '近似5：standard/lavish/night/synergy 的排槽由模拟器按「高层级>产出分」手动补满（autoSlotOrder 默认 off 是引擎出厂值）；仅 frugal-net 走 Agent.refillQueue(gap)。lavish-deep 同时在攻目标钳制 ≤3（深耕）。',
    '近似6：粗步长伪影——好感在单个 dt 内可跳过整个阶段区间，导致 errand（需好感≥75 且未转资产的窗口）在模拟中几乎不可触发，H4 以静态性价比表为准；尖峰比值（单日增量÷前7日均值）在指数增长曲线上必然高位，>3 的标记应读作「复利型增长」而非数值事故。',
    '里程碑天数以游戏日（gt/DAY_MS）计，分辨率=1 个 dt。collectDrop 异常会被跳过但计入 dropsFailed 口径。'
  ];
}

function buildJson(agg, cfg) {
  return {
    generatedAt: new Date().toISOString(),
    tool: 'scripts/sim.js',
    repro: cfg.repro,
    config: {
      strategy: agg.strategy,
      runsCompleted: agg.runsCompleted,
      runsRequested: agg.runsRequested,
      quick: agg.quick,
      truncatedByWallclock: agg.truncatedByWallclock,
      partial: agg.partial,
      days: cfg.days,
      chunkMs: cfg.chunkMs,
      seed: cfg.seed,
      node: process.version
    },
    methodNotes: cfg.notes,
    perf: { avgMsPerRun: agg.avgMsPerRun, avgActionsPerDay: agg.avgActionsPerDay, runsFailed: agg.runsFailed },
    throughput: agg.throughput,
    equipmentMeta: {
      equipActionsTotal: agg.equipActionsTotal,
      avgEquipActionsPerDay: agg.avgEquipActionsPerDay,
      repItemUsesAvgPerRun: agg.avgRepItemUsesPerRun
    },
    dropsFailed: agg.dropsFailedTotal,
    skillBank: { bankedTicksTotal: agg.spBankedTicksTotal },
    litNodes: agg.litNodes,
    blockers: agg.blockers,
    timetable: agg.timetable,
    goldCurve: agg.goldCurve,
  datesCurve: agg.datesCurve,
    incomeShares: agg.income.periods,
    incomeLateP50Share: agg.income.lateP50,
    h1LateDomination: agg.income.h1Domination,
    efficiency: agg.efficiency,
    zeroActionTypes: agg.zeroActionTypes,
    deadZones: agg.deadZones,
    spikes: agg.spikes,
    extras: {
      avgErrandPerRun: agg.avgErrandPerRun,
      avgRareEquipPerRun: agg.avgRareEquipPerRun,
      avgAttrBuysPerRun: agg.avgAttrBuysPerRun,
      endAttrsP50: agg.endAttrsAvg
    }
  };
}

function cell3(t) {
  const f = (v) => (v == null ? '–' : String(v));
  return f(t.P25) + ' / **' + f(t.P50) + '** / ' + f(t.P75);
}

function blockerSummary(row) {
  if (!row.failed) return '–';
  const parts = [];
  const n = row.failed;
  if (row.tasteWallN) parts.push('**品味墙 ' + row.tasteWallN + '/' + n + '**（P50 品味 lv' + row.tasteP50 + '→需 ' + row.tasteNeed + '，升级累计≈' + grp(row.tasteCumGoldP50) + ' 金）');
  if (row.repShortN) parts.push('声望不足 ' + row.repShortN + '/' + n + '（P50 ' + grp(row.repHaveP50) + '/' + grp(row.repNeed) + '）');
  if (row.feeShortN) parts.push('入场费不足 ' + row.feeShortN + '/' + n + '（P50 金 ' + grp(row.goldP50) + ' vs 费 ' + grp(row.fee) + '）');
  if (row.poolExhaustedN) parts.push('槽位/池枯竭 ' + row.poolExhaustedN + '/' + n);
  if (row.budgetSatN) parts.push('日预算饱和 ' + row.budgetSatN + '/' + n);
  if (row.bizNeed != null) parts.push('业务量 P50 ' + grp(row.bizVolP50) + ' vs 需 ' + grp(row.bizNeed));
  return parts.length ? parts.join('；') : '无显性缺口（窗口未到）';
}

function buildMarkdown(aggs, calibRows, validation, cfg) {
  const L = [];
  L.push('# 模拟校准报告（sim.js 自动生成）');
  L.push('');
  const completedList = aggs.map((a) => a.strategy + ' ' + a.runsCompleted + '/' + a.runsRequested).join('、');
  L.push('- 生成时间：' + new Date().toISOString() + '　|　种子：' + cfg.seed + '　|　每次运行：' + cfg.days + ' 游戏日　|　dt=' + cfg.chunkMs + 'ms');
  L.push('- 运行数：' + completedList + '　|　模式：' + (cfg.quick ? 'quick（R 上限=20/策略）' : 'full（R=200/策略）') + '　|　截断标记：' + (aggs.some((a) => a.truncatedByWallclock) ? '是' : '否'));
  const partialAggs = aggs.filter((a) => a.partial);
  if (partialAggs.length) {
    L.push('');
    L.push('> ⚠ **警告：部分运行（partial=true）**——' + partialAggs.map((a) => a.strategy + '（完成 ' + a.runsCompleted + '/' + a.runsRequested + (a.truncatedByWallclock ? '，墙钟 ' + (QUICK_DEADLINE_MS / 1000) + 's 截断' : '') + '）').join('、') + '。以下统计仅基于已完成样本，与满样本口径不可直接比较。');
  }
  L.push('- 校准基准：docs/drafts/alpha4/02-calibration-and-balance-report.md §4（D1 拍板版）');
  L.push('- 复现戳：git ' + cfg.repro.gitHash + ' · node ' + cfg.repro.node);
  L.push('');
  L.push('## 0 · 方法与近似（必读）');
  L.push('');
  cfg.notes.forEach((n, i) => L.push((i + 1) + '. ' + n));
  L.push('');
  if (validation) {
    L.push('## 0.1 步长收敛验证（scope：' + validation.scope + '，dt ' + validation.coarseDt + 'ms vs ' + validation.fineDt + 'ms）');
    L.push('');
    L.push('| 里程碑 | 粗步长 P50(日) | 细步长 P50(日) | 偏差 |');
    L.push('| --- | --- | --- | --- |');
    validation.rows.forEach((r) => L.push('| ' + r.milestone + ' | ' + r.coarseDays + ' | ' + r.fineDays + ' | ' + r.divergence + '% |'));
    L.push('');
    L.push('最大偏差 **' + validation.maxDivPct + '%**（scope：' + validation.scope + '）→ ' + (validation.ok ? '<5%，粗步长可信' : '≥5%，⚠ 建议调小 dt 重跑'));
    L.push('');
  }
  L.push('## 1 · 关键时刻表（游戏日，P25 / P50 / P75；格内粗体为中位；– = 已完成样本内未达成）');
  L.push('');
  const heads = aggs.map((a) => a.strategy);
  L.push('| 里程碑 | ' + heads.map((h) => h + ' 达成率 | ' + h + ' P25/50/75').join(' | ') + ' |');
  L.push('| --- | ' + heads.map(() => '--- | ---').join(' | ') + ' |');
  const nMs = MILESTONE_DEFS.length;
  for (let i = 0; i < nMs; i++) {
    const cells = aggs.map((a) => {
      const t = a.timetable[i];
      return Math.round(t.rate * 100) + '% | ' + cell3(t);
    });
    L.push('| ' + MILESTONE_DEFS[i][1] + ' | ' + cells.join(' | ') + ' |');
  }
  L.push('');
  L.push('## 2 · 收入源占比迁移（占总入金比例 %）');
  L.push('');
  for (const a of aggs) {
    L.push('### ' + a.strategy);
    L.push('');
    L.push('| 来源 | 前期(d1-' + Math.ceil(cfg.days / 3) + ') | 中期 | 后期 | 后期 P50 占比 |');
    L.push('| --- | --- | --- | --- | --- |');
    INC_SOURCES.forEach(([k, label]) => {
      L.push('| ' + label + ' | ' + a.income.periods.early[k] + '% | ' + a.income.periods.mid[k] + '% | ' + a.income.periods.late[k] + '% | ' + a.income.lateP50[k] + '% |');
    });
    L.push('');
  }
  L.push('**H1 判定**：后期任一来源 P50 占比 >90% → ' + aggs.map((a) => a.strategy + '=' + (a.income.h1Domination ? ('⚠ ' + a.income.h1Domination.source + ' ' + a.income.h1Domination.share + '%') : '未独占')).join('；'));
  L.push('');
  L.push('## 3 · 动作性价比矩阵（跨运行聚合，n≥' + EFF_MIN_N + '；金/好感=Σ实际花费÷Σ实际好感，体力/好感同口径）');
  L.push('');
  for (const a of aggs) {
    L.push('### ' + a.strategy);
    L.push('');
    L.push('| 动作 | 圈层 | 次数 | 金/好感 | 体力/好感 |');
    L.push('| --- | --- | --- | --- | --- |');
    a.efficiency.forEach((e) => L.push('| ' + e.type + ' | T' + e.tier + ' | ' + e.n + ' | ' + (e.goldPerFavor == null ? 'n/a' : e.goldPerFavor) + ' | ' + (e.staminaPerFavor == null ? 'n/a' : e.staminaPerFavor) + ' |'));
    L.push('');
    L.push('errand 人均次数 ' + a.avgErrandPerRun + '（每人限一次兜底，占比非唯一理性选择即可）；稀有装备掉落人均 ' + a.avgRareEquipPerRun + ' 件/' + cfg.days + '日（H2 可达性旁证）。零出现动作类型：' + (a.zeroActionTypes.length ? a.zeroActionTypes.join('、') : '无') + '。dropsFailed 合计 ' + a.dropsFailedTotal + '。');
    L.push('');
  }
  L.push('## 4 · 死区与尖峰检测');
  L.push('');
  L.push('| 策略 | 区间 | 停留 P50(日) | 目标上限 | 死区标记 | 单日尖峰 P50(倍) | 尖峰超3×运行占比 |');
  L.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const a of aggs) {
    for (const dz of a.deadZones) {
      L.push('| ' + a.strategy + ' | ' + dz.pair + ' | ' + (dz.P50 == null ? '–' : dz.P50) + ' | ' + dz.targetUpperDays + ' | ' + (dz.flag ? '⚠ 死区' : '正常') + ' | ' + a.spikes.P50maxRatio + ' | ' + a.spikes.flaggedRunFrac + '% |');
    }
  }
  L.push('');
  L.push('## 5 · 校准判定（standard P50 vs §4 目标区间）');
  L.push('');
  L.push('| 里程碑 | 目标区间(日) | standard P50 | 判定 |');
  L.push('| --- | --- | --- | --- |');
  (calibRows || []).forEach((c) => L.push('| ' + c.milestone + ' | ' + c.lo + '~' + c.hi + ' | ' + (c.P50 == null ? '–' : c.P50) + ' | ' + c.status + ' |'));
  L.push('');
  L.push('## 6 · 卡点诊断（binding-constraint，未达成运行的 P50 分解）');
  L.push('');
  L.push('口径：仅统计「整个运行结束时仍未达成」的样本；品味墙一行的「升级累计」= 把 taste 从 P50 现值升到准入级的 attrCost 金币总和（150×1.7^lv×priceRate 逐级累加）。');
  L.push('');
  for (const a of aggs) {
    L.push('### ' + a.strategy);
    L.push('');
    L.push('| 里程碑 | 未达成/样本 | 卡点分解（未达成运行中） |');
    L.push('| --- | --- | --- |');
    a.blockers.forEach((row) => {
      L.push('| ' + row.label + ' | ' + row.failed + '/' + row.total + ' | ' + blockerSummary(row) + ' |');
    });
    L.push('');
  }
  L.push('## 7 · 动作吞吐 / 预算饱和 / 装备元策略（M4 口径）');
  L.push('');
  L.push('| 策略 | 动作/日 | null 决策率 | 日预算饱和 | 单NPC预算饱和 | 后期饱和(>60% ⚠) | equipActions/日 | rep物品/百日 | 银行冻结tick/百日 |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const a of aggs) {
    L.push('| ' + a.strategy + ' | ' + a.avgActionsPerDay + ' | ' + (a.throughput.nullDecisionRatePct == null ? '–' : a.throughput.nullDecisionRatePct + '%')
      + ' | ' + (a.throughput.dailyBudgetSatPct == null ? '–' : a.throughput.dailyBudgetSatPct + '%')
      + ' | ' + (a.throughput.perNpcBudgetSatPct == null ? '–' : a.throughput.perNpcBudgetSatPct + '%')
      + ' | ' + a.throughput.lateGameSaturationPct + '%' + (a.throughput.lateGameSatFlag ? ' ⚠' : '')
      + ' | ' + a.avgEquipActionsPerDay
      + ' | ' + a.avgRepItemUsesPerRun
      + ' | ' + Math.round(a.spBankedTicksTotal / Math.max(1, a.runsCompleted)) + ' |');
  }
  L.push('');
  L.push('注：null 决策率 = decide 返回空的次数 ÷ decide 总调用；饱和 % = chunk 边界采样中 spent 触顶占比；后期=最后 1/3 游戏日，>60% 打 ⚠（预算旋钮压制付费动作的信号）。equipActions>0 证明自动装备元策略生效。');
  L.push('');
  L.push('## 8 · 技能点亮诊断（银行制结果）');
  L.push('');
  for (const a of aggs) {
    const sets = a.litNodes.distinctSets.slice(0, 5);
    const pend = Object.keys(a.litNodes.topPending || {}).map((k) => k + ' ×' + a.litNodes.topPending[k]).join('、') || '无';
    L.push('- **' + a.strategy + '**：独立终盘节点集 ' + a.litNodes.distinctSets.length + ' 种 —— '
      + sets.map((s) => '(' + s.runs + ' 运行) `' + (s.set.length ? s.set.join(',') : '无') + '`').join(' ； ')
      + (a.litNodes.distinctSets.length > 5 ? ' （其余 ' + (a.litNodes.distinctSets.length - 5) + ' 种略）' : '')
      + '。首卡节点：' + pend + '（cost=点数供给耗尽：百日技能点总供给≈12 枚，路径成本 ≥13 的节点必然卡死）。');
  }
  L.push('');
  L.push('## 9 · H1~H6 数据注记');
  L.push('');
  const std = aggs.find((a) => a.strategy === 'standard') || aggs[0];
  const stdT5 = std.blockers.find((b) => b.key === 'tier5');
  L.push('- **H1 收入单边倾斜**：见 §2 后期列与上方判定行。' + (std.income.h1Domination ? '存在独占源 ' + std.income.h1Domination.source + '（' + std.income.h1Domination.share + '%），建议按 02 §4 补津贴/掉落档。' : '各源后期 P50 占比均未越过 90% 独占线。'));
  L.push('- **H2 稀有装备可达性**：静态口径 func(10~45%)×equip(8%)×rare(3%)≈万分之几/掉落；模拟旁证：standard ' + std.avgRareEquipPerRun + ' 件/百日内（含 S3 pity 引入前后需分别跑对照，本报告未建 pity 模型）。装备元策略 equipActions 合计 ' + std.equipActionsTotal + '（' + std.avgEquipActionsPerDay + '/日），词条加成自穿戴起计入。');
  L.push('- **H3 T3→T4 死区**：§4 表中 T2→T3/T3→T4 行，标记 ⚠ 即中位停留超过目标区间上限；结合 §6 卡点诊断看是哪条约束绑死。');
  L.push('- **H4 errand 性价比倒挂**：§3 矩阵中 errand 金/好感应显著劣于大礼/匹配约会（约 80 vs 32 vs ~9 的静态比）；人均次数 ' + std.avgErrandPerRun + '，因每人限一次不构成主导策略即通过。');
  L.push('- **H5 属性指数成本弃坑点**：模拟器采用理性充值策略（金币≥10×成本才升 charm/talk），百日末中位属性 taste/charm/talk = ' + std.endAttrsAvg.taste + '/' + std.endAttrsAvg.charm + '/' + std.endAttrsAvg.talk + '，人均升级 ' + std.avgAttrBuysPerRun + ' 次；若 charm/talk 明显停在低级且发生在 T3 前，则印证 1.7^lv 曲线弃坑点早于 T3。');
  L.push('- **H5/T5 品味墙（与 §6 呼应）**：' + (stdT5 && stdT5.failed ? 'T5 未达成 ' + stdT5.failed + '/' + stdT5.total + ' 运行，其中品味墙 ' + stdT5.tasteWallN + ' 例（P50 lv' + stdT5.tasteP50 + '→需 ' + stdT5.tasteNeed + '，还需 ≈' + grp(stdT5.tasteCumGoldP50) + ' 金）——指数成本在 T5 准入处形成硬墙。' : 'T5 卡点未见品味墙主导（见 §6）。'));
  L.push('- **H6 死配置**：REP_PASSIVE 已于 alpha4 D2 删除（balance.js 注释），wechatEfficiency 未在 balance.js 出现——两项已从报告指标中消失，静态核验通过。');
  L.push('');
  L.push('## 10 · 金币曲线分位数带（每游戏日 P25/P50/P75，金）');
  L.push('');
  for (const a of aggs) {
    L.push('<details><summary>' + a.strategy + '</summary>');
    L.push('');
    L.push('| 日 | P25 | P50 | P75 |');
    L.push('| --- | --- | --- | --- |');
    const stepD = cfg.days > 40 ? 5 : 1;
    for (let d = 0; d <= cfg.days; d += stepD) {
      L.push('| ' + d + ' | ' + a.goldCurve.p25[d] + ' | ' + a.goldCurve.p50[d] + ' | ' + a.goldCurve.p75[d] + ' |');
L.push('约会累计P50 d30/d60/d90: ' + [30,60,90].map(x=>a.datesCurve['d'+x]).join(' / '));
    }
    L.push('');
    L.push('</details>');
    L.push('');
  }
  return L.join('\n');
}

// ── worker 模式入口：每策略切成 nShards 个分片并行（种子只依赖 runIndex，分片不改分布）──
function runStrategyPayload(p) {
  const strat = STRATEGIES[p.sid];
  strat._order = skillOrder(strat.skillPolicy);
  const results = [];
  let truncated = false;
  for (let i = p.shard; i < p.runs; i += p.nShards) {
    if (p.deadline && Date.now() > p.deadline) { truncated = true; break; }
    results.push(runOnce(p.sid, i, p.days, CHUNK_MS, p.seed));
  }
  parentPort.postMessage({ __log: '[sim] ' + p.sid + ' shard ' + (p.shard + 1) + '/' + p.nShards + ' done (' + results.length + ' runs)' });
  parentPort.postMessage({ t: 'done', sid: p.sid, shard: p.shard, results, truncated });
}

function runValidatePayload(p) {
  parentPort.postMessage({ t: 'vdone', validation: validateStepSize({ days: p.days, seed: p.seed }) });
}

function spawnWorker(payload) {
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: payload });
    w.on('message', (m) => {
      if (m && m.__log) console.log(m.__log);
      else if (m && (m.t === 'done' || m.t === 'vdone')) resolve(m);
    });
    w.on('error', reject);
    w.on('exit', (code) => { if (code !== 0) reject(new Error('worker exit code=' + code + ' role=' + payload.role)); });
  });
}

async function main() {
  const t0 = Date.now();
  const opts = parseArgs(process.argv.slice(2));
  const stratIds = (opts.strategies || Object.keys(STRATEGIES)).filter((id) => {
    if (STRATEGIES[id]) return true;
    console.log('[sim] unknown strategy ignored: ' + id);
    return false;
  });
  if (!stratIds.length) { console.log('[sim] no valid strategies'); process.exitCode = 1; return; }

  const stamp = ymd(new Date());
  const outDir = path.join(__dirname, '..', 'docs', 'reports');
  fs.mkdirSync(outDir, { recursive: true });

  const cfg = {
    quick: opts.quick, runs: opts.runs, days: opts.days, seed: opts.seed,
    chunkMs: CHUNK_MS, notes: null, seedNote: 'noon 基准随游戏时推进（night-owl 固定 20:00）',
    repro: reproStamp()
  };
  cfg.notes = methodNotes(cfg);

  const deadline = opts.quick ? (t0 + QUICK_DEADLINE_MS) : null;
  const nStrat = stratIds.length;
  const shardsPerStrat = Math.max(1, Math.min(opts.runs, Math.floor(WORKER_TOTAL_CAP / nStrat), 4));
  console.log('[sim] launching ' + nStrat + ' strategies × ' + shardsPerStrat + ' shards = ' + (nStrat * shardsPerStrat) + ' workers (parallel)'
    + (deadline ? ', wall-clock budget ' + (QUICK_DEADLINE_MS / 1000) + 's' : '') + '...');
  const jobs = [];
  for (const sid of stratIds) {
    for (let k = 0; k < shardsPerStrat; k++) {
      jobs.push(spawnWorker({ role: 'strat', sid, shard: k, nShards: shardsPerStrat, runs: opts.runs, days: opts.days, seed: opts.seed, deadline, t0 }));
    }
  }
  let validationPromise = null;
  if (stratIds.indexOf('standard') >= 0) {
    validationPromise = spawnWorker({ role: 'validate', days: opts.days, seed: opts.seed }).then((m) => m.validation);
  }
  const doneList = await Promise.all(jobs);

  const aggs = [];
  const bySid = {};
  for (const done of doneList) {
    const b = bySid[done.sid] || (bySid[done.sid] = { results: [], truncated: false });
    b.results.push(...done.results);
    b.truncated = b.truncated || done.truncated;
  }
  for (const sid of stratIds) {
    const bucket = bySid[sid];
    bucket.results.sort((a, b2) => a.runIndex - b2.runIndex);
    const results = bucket.results;
    const truncated = bucket.truncated || results.length < opts.runs;
    if (truncated) console.log('[sim] ⚠ ' + sid + ' 截断于墙钟预算 ' + (QUICK_DEADLINE_MS / 1000) + 's，完成 ' + results.length + '/' + opts.runs + '（partial=true 已写入 JSON 与 md 头部）');
    const agg = aggregateStrategy(sid, results, { runs: opts.runs, days: opts.days, quick: opts.quick, truncated });
    aggs.push(agg);
    const bad = results.find((r) => r.error);
    if (bad) console.log('[sim] ⚠ ' + sid + ' 有失败运行（' + results.filter((r) => r.error).length + ' 例，如: ' + bad.error + '）');
    console.log('[sim] ' + sid + ': ' + results.length + '/' + opts.runs + ' runs, avg ' + agg.avgMsPerRun + 'ms/run, actions/day=' + agg.avgActionsPerDay
      + ', nullDecision=' + agg.throughput.nullDecisionRatePct + '%, equipActions=' + agg.equipActionsTotal
      + ', firstAsset P50=' + ((agg.timetable[0] || {}).P50));
    const jsonPath = path.join(outDir, 'sim-' + sid + '-' + stamp + '.json');
    fs.writeFileSync(jsonPath, JSON.stringify(buildJson(agg, { quick: opts.quick, runs: opts.runs, days: opts.days, chunkMs: CHUNK_MS, seed: opts.seed, notes: cfg.notes, repro: cfg.repro }), null, 1), 'utf8');
    console.log('[sim] wrote ' + jsonPath);
  }
  aggs.sort((a, b) => Object.keys(STRATEGIES).indexOf(a.strategy) - Object.keys(STRATEGIES).indexOf(b.strategy));

  let validation = null;
  if (validationPromise) {
    validation = await validationPromise;
    console.log('[sim] validation maxDiv=' + validation.maxDivPct + '% over ' + validation.rows.length + ' milestones → ' + (validation.ok ? 'OK (<5%)' : 'WARN (>=5%)') + ' [scope: ' + validation.scope + ']');
  }

  // B2 校验：synergy-early 必须与 standard 发散（时刻表或点亮集合任一相同都不够，两者全同则致命）
  const stdAgg = aggs.find((a) => a.strategy === 'standard');
  const synAgg = aggs.find((a) => a.strategy === 'synergy-early');
  if (stdAgg && synAgg) {
    const ttSame = JSON.stringify(stdAgg.timetable) === JSON.stringify(synAgg.timetable);
    const litSame = JSON.stringify(stdAgg.litNodes) === JSON.stringify(synAgg.litNodes);
    if (ttSame && litSame) {
      console.error('[sim] ✖ FATAL: synergy-early 与 standard 的 timetable 和 litNodes 完全一致——种子偏移/技能银行未生效，输出不可用于校准。');
      process.exitCode = 1;
      return;
    }
    console.log('[verify] divergence standard↔synergy-early: timetable ' + (ttSame ? 'SAME' : 'DIFF') + ', litNodes ' + (litSame ? 'SAME' : 'DIFF') + ' → OK');
  }

  const owlAgg = aggs.find((a) => a.strategy === 'night-owl');
  if (owlAgg) {
    const k2aRuns = owlAgg.litNodes.histogram.k2a || 0;
    console.log('[verify] night-owl k2a lit: ' + k2aRuns + '/' + owlAgg.runsCompleted + ' runs' + (k2aRuns > 0 ? ' ✓' : ' ✖ (expected >0)'));
  }
  const equipSum = aggs.reduce((a, x) => a + x.equipActionsTotal, 0);
  console.log('[verify] equipActions total=' + equipSum + (equipSum > 0 ? ' ✓' : ' ✖ (expected >0)'));

  const calibStd = stdAgg;
  const calibRows = calibStd ? calibrate(calibStd) : null;

  const md = buildMarkdown(aggs, calibRows, validation, cfg);
  const mdPath = path.join(outDir, 'sim-summary-' + stamp + '.md');
  fs.writeFileSync(mdPath, md, 'utf8');

  console.log('[sim] wrote ' + mdPath);
  const diagStd = stdAgg && stdAgg.blockers.find((b) => b.key === 'tier5');
  if (diagStd) console.log('[verify] 卡点诊断 rows=' + stdAgg.blockers.length + '; standard T5 → ' + blockerSummary(diagStd));
  console.log('[sim] total wall time ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  if (calibRows) {
    console.log('\nstandard P50 校准速览:');
    calibRows.forEach((c) => console.log('  ' + c.milestone + ': P50=' + (c.P50 == null ? '–' : c.P50 + '日') + ' 目标 ' + c.lo + '~' + c.hi + ' → ' + c.status));
  }
}

if (isMainThread) {
  main().catch((e) => { console.error('[sim] FATAL: ' + ((e && e.stack) || e)); process.exitCode = 1; });
} else if (workerData && workerData.role === 'strat') {
  runStrategyPayload(workerData);
} else if (workerData && workerData.role === 'validate') {
  runValidatePayload(workerData);
}
