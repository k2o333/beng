// 引擎自测（纯 node，无外部依赖）：数值依据 docs/drafts/alpha/02-numbers.md
'use strict';

require('../src/js/data/balance.js');
require('../src/js/data/npcs.js');
const Engine = require('../src/js/engine.js');

const B = globalThis.BALANCE;
const DEF = globalThis.NPC_BY_ID;

let passed = 0;
let failed = 0;
const failedNames = [];

function ok(cond, name) {
  if (cond) { passed++; return true; }
  failed++;
  failedNames.push(name);
  console.log('FAIL ' + name);
  return false;
}
function eq(actual, want, name) {
  ok(actual === want, name + ' [want=' + JSON.stringify(want) + ' got=' + JSON.stringify(actual) + ']');
}
function near(actual, want, tol, name) {
  ok(Math.abs(actual - want) <= tol, name + ' [want~' + want + '(±' + tol + ') got=' + actual + ']');
}

const NOW = 1750000000000;
function fresh() { return Engine.newState(NOW); }

// ── 1. newState 初始值 ──
(function () {
  const st = fresh();
  eq(st.tier, 1, 'newState: tier=1');
  eq(st.slotCount, 3, 'newState: slotCount=3');
  eq(st.stamina, 100, 'newState: stamina=100');
  eq(st.gold, 0, 'newState: gold=0');
})();

// ── 2. statusOf 状态机 ──
(function () {
  const st = fresh();
  eq(Engine.statusOf(st, DEF.t1_lin), 'available', 'statusOf: T1 available');
  eq(Engine.statusOf(st, DEF.t2_lu), 'locked', 'statusOf: T2 locked');
  ok(Engine.addToSlot(st, 't1_lin').ok, 'addToSlot 成功');
  eq(Engine.statusOf(st, DEF.t1_lin), 'courting', 'statusOf: 入槽 courting');
  ok(Engine.removeFromSlot(st, 't1_lin').ok, 'removeFromSlot 成功');
  eq(Engine.statusOf(st, DEF.t1_lin), 'available', 'statusOf: 出槽回 available');
})();

// ── 3. 自动好感：60 分钟 ≈ 30 点 ──
(function () {
  const st = fresh();
  near(Engine.autoFavorPerMin(st, DEF.t1_lin), 0.5, 1e-9, 'T1 无魅力自动好感 0.5/分');
  ok(Engine.addToSlot(st, 't1_lin').ok, 'slot lin');
  Engine.tick(st, NOW + 60 * 60000);
  near(st.npcs.t1_lin.favor, 30, 0.1, 'tick 60 分钟 favor≈30');
  eq(st.lastSeen, NOW + 60 * 60000, 'lastSeen 前移');
})();

// ── 4. 魅力加成与 T2 矜持 ──
(function () {
  const st = fresh();
  st.attrs.charm = 10;
  near(Engine.autoFavorPerMin(st, DEF.t1_lin), 0.5 * 1.8, 1e-9, 'charm=10 → ×1.8');
  near(Engine.autoFavorPerMin(st, DEF.t2_bai), 0.5 * 1.8 / 1.2, 1e-9, 'T2 矜持 1.2 → 再÷1.2');
})();

// ── 5. interact ──
(function () {
  const st = fresh();
  ok(Engine.addToSlot(st, 't1_lin').ok, 'slot lin');
  const r = Engine.interact(st, 't1_lin', NOW + 1000);
  ok(r.ok, 'interact 成功');
  eq(st.stamina, 90, 'interact 耗 10 体力');
  near(r.gain, 0.5 * 5 * 1.0, 1e-9, 'T1 基础互动收益 2.5');
  st.stamina = 5;
  const r2 = Engine.interact(st, 't1_lin', NOW + 2000);
  ok(!r2.ok, '体力不足 ok:false');
  eq(st.stamina, 5, '体力不足不扣');
})();

// ── 6. 里程碑（金钱型 +300 / 声望型 +8），claimed 防重复 ──
(function () {
  const st = fresh();
  Engine.npc(st, 't1_gu').favor = 24;
  const ev = [];
  Engine.grantFavor(st, DEF.t1_gu, 2, ev);
  near(st.npcs.t1_gu.favor, 26, 1e-9, '金钱型 favor 24→26');
  const ms = ev.filter((e) => e.t === 'milestone');
  eq(ms.length, 1, '触发 1 个里程碑');
  eq(ms[0].kind, 'gold', '金钱型里程碑 kind=gold');
  eq(ms[0].amount, 300, 'T1 金币里程碑 +300');
  eq(st.gold, 300, '金币到账');
  ok(st.npcs.t1_gu.claimed.indexOf(25) >= 0, 'claimed 记录 25');

  Engine.npc(st, 't1_gu').favor = 24;
  const ev2 = [];
  Engine.grantFavor(st, DEF.t1_gu, 2, ev2);
  eq(ev2.filter((e) => e.t === 'milestone').length, 0, '重复跨 25 不再触发');
  eq(st.gold, 300, '重复不重复发钱');

  Engine.npc(st, 't1_lin').favor = 24;
  const ev3 = [];
  Engine.grantFavor(st, DEF.t1_lin, 2, ev3);
  const ms3 = ev3.filter((e) => e.t === 'milestone');
  eq(ms3.length, 1, '声望型触发 1 个里程碑');
  eq(ms3[0].kind, 'rep', '声望型里程碑 kind=rep');
  eq(ms3[0].amount, 8, 'T1 声望型里程碑 +8');
  eq(st.rep, 8, '声望到账');
})();

// ── 7. 满级转化：asset=true、移出 slots、满级声望 ──
(function () {
  const st = fresh();
  ok(Engine.addToSlot(st, 't1_lin').ok, 'slot lin');
  Engine.npc(st, 't1_lin').favor = 99;
  const ev = [];
  Engine.grantFavor(st, DEF.t1_lin, 1, ev);
  eq(st.npcs.t1_lin.favor, 100, '满级 favor=100');
  eq(st.npcs.t1_lin.asset, true, 'asset=true');
  eq(st.slots.indexOf('t1_lin'), -1, '移出 slots');
  eq(st.rep, B.FULL_REP[1] * 2, 'rep 型满级声望 5×2=10');
  ok(ev.some((e) => e.t === 'full' && e.id === 't1_lin' && e.rep === 10), 'full 事件');

  const st2 = fresh();
  Engine.npc(st2, 't1_gu').favor = 99;
  Engine.grantFavor(st2, DEF.t1_gu, 1, []);
  eq(st2.rep, B.FULL_REP[1], '非 rep 型满级声望 5');
  eq(Engine.statusOf(st2, DEF.t1_gu), 'asset', '状态 asset');
})();

// ── 8. 引荐：t1_shen 满级 → t2_lu available ──
(function () {
  const st = fresh();
  Engine.npc(st, 't1_shen').favor = 99;
  Engine.grantFavor(st, DEF.t1_shen, 1, []);
  eq(st.npcs.t2_lu.referred, true, 't2_lu 被标记引荐');
  eq(Engine.statusOf(st, DEF.t2_lu), 'available', 't2_lu 变为 available');
  eq(st.tier, 1, '圈层仍为 1');
})();

// ── 9. 资产产出 ──
(function () {
  const st = fresh();
  Engine.npc(st, 't1_gu').asset = true;
  near(Engine.incomePerSec(st), 1.0 * 1 * 1.2, 1e-9, 't1_gu 资产 1.2 金/秒');
  const st2 = fresh();
  Engine.npc(st2, 't1_lin').asset = true;
  near(Engine.repPerMin(st2), 0.10, 1e-9, 't1_lin 资产 repPerMin+=0.10');
})();

// ── 10. tick 挂机 1 小时 ──
// 槽内放 rep 型（里程碑发声望），保证金币增量只来自资产
(function () {
  const st = fresh();
  Engine.npc(st, 't1_gu').asset = true;
  ok(Engine.addToSlot(st, 't1_lin').ok, 'slot lin');
  const g0 = st.gold;
  const r0 = st.rep;
  const f0 = st.npcs.t1_lin.favor;
  Engine.tick(st, NOW + 3600 * 1000);
  near(st.gold - g0, 1.2 * 3600, 0.5, '挂机 1h 金币≈4320');
  near(st.npcs.t1_lin.favor - f0, 0.5 * 60, 0.1, '挂机 1h 好感≈30');
  eq(st.rep - r0, 8, '挂机跨 25 触发声望型里程碑 +8');
})();

// ── 11. 送礼 ──
(function () {
  const st = fresh();
  ok(Engine.addToSlot(st, 't1_gu').ok, 'slot gu');
  st.gold = 10000;
  let r = Engine.gift(st, 't1_gu', 'small');
  ok(r.ok, '小礼成功');
  eq(r.cost, 80, '小礼花费 80');
  near(r.gain, 4, 1e-9, '小礼 +4 好感');
  r = Engine.gift(st, 't1_gu', 'mid');
  ok(r.ok, '中礼成功');
  eq(r.cost, 250, '中礼花费 250');
  near(r.gain, 10, 1e-9, '中礼 +10 好感');
  eq(st.gold, 10000 - 80 - 250, '礼物累计扣费');

  st.tier = 3; // 构造：解锁 T3
  st.attrs.taste = 0;
  ok(Engine.addToSlot(st, 't3_fu').ok, 'slot fu（构造 tier=3）');
  st.gold = 1000000;
  r = Engine.gift(st, 't3_fu', 'large');
  ok(!r.ok, 'T3 大礼品味不足 ok:false');

  st.gold = 79;
  r = Engine.gift(st, 't1_gu', 'small');
  ok(!r.ok, '金币不足 ok:false');
  eq(st.gold, 79, '失败不扣费');
})();

// ── 12. 属性升级成本 ──
(function () {
  eq(Engine.attrCost(0), 150, 'attrCost(0)=150');
  eq(Engine.attrCost(1), 255, 'attrCost(1)=round(150×1.7)=255');
  eq(Engine.attrCost(3), 737, 'attrCost(3)=round(150×1.7³)=737');
  const st = fresh();
  st.gold = 100;
  ok(!Engine.upgradeAttr(st, 'charm').ok, '金币不足升级失败');
  st.gold = 150;
  const r = Engine.upgradeAttr(st, 'charm');
  ok(r.ok, '金币足够升级成功');
  eq(st.attrs.charm, 1, 'charm 升至 1');
  eq(st.gold, 0, '扣费 150');
})();

// ── 13. 槽位扩容 ──
(function () {
  const st = fresh();
  st.gold = 50000;
  const r = Engine.expandSlot(st);
  ok(r.ok, '扩容成功');
  eq(st.slotCount, 4, 'slotCount 3→4');
  eq(r.cost, 50000, '第 4 槽花 50000');
  eq(B.SLOT_COSTS[5], 500000, 'SLOT_COSTS[5]=500000');
  st.slotCount = 7;
  st.gold = 1e9;
  ok(!Engine.expandSlot(st).ok, '7 槽时扩容失败');
})();

// ── 14. 圈层进入 ──
(function () {
  const st = fresh();
  st.rep = 99;
  st.gold = 100000;
  ok(!Engine.enterTier(st, 2).ok, 'rep<100 进 T2 失败');
  eq(st.tier, 1, '圈层未变');
  st.rep = 100;
  const r = Engine.enterTier(st, 2);
  ok(r.ok, 'rep=100 且 gold 足够 → 成功');
  eq(st.tier, 2, 'tier=2');
  eq(st.gold, 90000, '扣入场费 10000');
  ok(!Engine.enterTier(st, 4).ok, '跳级进 T4 失败');
  st.rep = 600;
  st.gold = 100000;
  st.attrs.taste = 0;
  ok(!Engine.enterTier(st, 3).ok, 'T3 品味不足失败');
  st.attrs.taste = 10;
  ok(Engine.enterTier(st, 3).ok, '品味 10 达标进 T3');
  eq(st.tier, 3, 'tier=3');
})();

// ── 15. 辅助型资产加成与封顶 ──
(function () {
  const st = fresh();
  ['t1_he', 't1_jiang', 't2_qin'].forEach((id) => { Engine.npc(st, id).asset = true; });
  near(Engine.auxBonus(st), 0.15, 1e-9, '3 个 aux 资产 auxBonus=0.15');
  near(Engine.autoFavorPerMin(st, DEF.t1_lin), 0.5 * 1.15, 1e-9, '自动好感 ×1.15');

  // 全游戏仅 8 名 aux NPC，临时扩充 NPC_BY_ID 构造 11 个 aux 资产以验证封顶
  const saved = globalThis.NPC_BY_ID;
  globalThis.NPC_BY_ID = Object.assign({}, saved);
  ['x_aux_a', 'x_aux_b', 'x_aux_c'].forEach((id) => {
    globalThis.NPC_BY_ID[id] = { id: id, name: id, tier: 1, type: 'aux', coef: 1 };
  });
  try {
    ['t1_he', 't1_jiang', 't2_qin', 't2_xu', 't3_li', 't3_jiangsheng', 't4_guan', 't5_nan',
      'x_aux_a', 'x_aux_b', 'x_aux_c'].forEach((id) => { Engine.npc(st, id).asset = true; });
    near(Engine.auxBonus(st), 0.5, 1e-9, '11 个 aux 封顶 0.5');
    near(Engine.autoFavorPerMin(st, DEF.t1_lin), 0.5 * 1.5, 1e-9, '封顶后速率 ×1.5');
  } finally {
    globalThis.NPC_BY_ID = saved;
  }
})();

// ── 16. 离线结算 ──
// 槽内放 rep 型（里程碑发声望），保证金币口径纯净；好感速率用 2h 窗口验证（8h 会撞 FAVOR_MAX=100 封顶）
(function () {
  const st = fresh(); // 2 小时：验证 ×50% 效率
  Engine.npc(st, 't1_gu').asset = true;
  ok(Engine.addToSlot(st, 't1_lin').ok, 'slot lin (2h)');
  st.lastSeen = NOW - 2 * 3600000;
  const rep = Engine.settleOffline(st, NOW);
  ok(!rep.capped, '2 小时未触顶');
  eq(rep.favors.length, 1, '结算 1 名槽内 NPC');
  eq(rep.favors[0].id, 't1_lin', '结算对象 t1_lin');
  near(rep.favors[0].gained, 0.5 * 120 * 0.5, 0.1, '离线好感=在线速率×50%');

  const st1 = fresh(); // 8 小时
  Engine.npc(st1, 't1_gu').asset = true;
  ok(Engine.addToSlot(st1, 't1_lin').ok, 'slot lin (8h)');
  st1.lastSeen = NOW - 8 * 3600000;
  const g0 = st1.gold;
  const r0 = st1.rep;
  const res8 = Engine.settleOffline(st1, NOW);
  ok(!res8.capped, '8 小时未触顶(时长上限)');
  near(res8.gold, 1.2 * 8 * 3600, 0.5, '离线金币≈1.2×8h');
  near(st1.gold - g0, 1.2 * 8 * 3600, 0.5, '离线金币入账');
  eq(st1.rep - r0, 34, '槽内跨 25/50/75 里程碑 +24，且满级转化 rep 型 +10');
  eq(st1.npcs.t1_lin.asset, true, '8h 离线好感满级自动转化资产');
  eq(st1.slots.indexOf('t1_lin'), -1, '满级后移出 slots');
  near(st1.npcs.t1_lin.favor, B.FAVOR_MAX, 0.1, '8h 好感累计撞 FAVOR_MAX=100');
  eq(st1.lastSeen, NOW, 'lastSeen 归位');

  const st2 = fresh(); // 30 小时 → 12h 上限
  Engine.npc(st2, 't1_gu').asset = true;
  ok(Engine.addToSlot(st2, 't1_lin').ok, 'slot lin (30h)');
  st2.lastSeen = NOW - 30 * 3600000;
  const res30 = Engine.settleOffline(st2, NOW);
  ok(res30.capped, '30 小时触顶 capped=true');
  near(res30.ms, 12 * 3600000, 1, '只结算 12 小时');
  near(res30.gold, 1.2 * 12 * 3600, 0.5, '触顶金币=12h 上限量');
  near(res30.favors[0].gained, B.FAVOR_MAX, 0.1, '触顶好感封顶于 FAVOR_MAX');
})();

// ── 17. fmtMoney ──
(function () {
  eq(Engine.fmtMoney(999), '999', 'fmtMoney(999)→"999"');
  eq(Engine.fmtMoney(12345), '1.23万', 'fmtMoney(12345)→"1.23万"');
  eq(Engine.fmtMoney(1234567), '123万', 'fmtMoney(1234567)→"123万"（实现口径：≥100万 取整）');
  eq(Engine.fmtMoney(3e8), '3亿', 'fmtMoney(3e8)→"3亿"');
})();

// ── 18. 体力回复 ──
(function () {
  const st = fresh();
  st.stamina = 50;
  st.stamTs = NOW - 9 * 60000;
  Engine.tick(st, NOW);
  eq(st.stamina, 53, '9 分钟回复 3 点体力');
})();

console.log('');
console.log('总计 ' + (passed + failed) + ' 项，通过 ' + passed + '，失败 ' + failed);
if (failed > 0) {
  console.log('失败用例:');
  failedNames.forEach((n) => console.log('  - ' + n));
  process.exit(1);
}
