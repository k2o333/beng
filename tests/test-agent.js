// 决策器自测 v2（04-idle-courting 方案 C）+ 开局红线集成模拟（00-overview §4）
'use strict';

require('../src/js/data/balance.js');
require('../src/js/data/npcs.js');
require('../src/js/data/items.js');
require('../src/js/data/texts.js');
const Engine = require('../src/js/engine.js');
const Agent = require('../src/js/agent.js');

const B = globalThis.BALANCE;
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
function eq(a, w, n) { ok(a === w, n + ' [want=' + JSON.stringify(w) + ' got=' + JSON.stringify(a) + ']'); }

const NOW = 1750000000000;
function fresh() { return Engine.newState(NOW); }
function isPaid(a) { return a && ['gift', 'date', 'errand'].indexOf(a.act) >= 0; }

// ── 1. 破冰期只出免费动作（L1 白名单）──
(function () {
  const st = fresh();
  st.settings.spendStyle = 'generous';   // 即使大方也跳不过破冰的产品解锁逻辑外：阶段门对 generous 跳过，
                                         // 但付费仍受产品好感门槛约束——顾言好感 0 时轻约可买，
                                         // 因此这里用标准风格验证纯白名单
  st.settings.spendStyle = 'standard';
  for (let i = 0; i < 100; i++) {
    const a = Agent.decide(st, NOW + i * 61000);
    if (isPaid(a)) { ok(false, '破冰期出付费动作: ' + JSON.stringify(a)); return; }
  }
  ok(true, '破冰期只出免费动作');
})();

// ── 2. 节俭风格：免费+小礼 ──
(function () {
  const st = fresh();
  st.gold = 1e7;
  Engine.npc(st, 't1_gu').favor = 30;
  st.settings.spendStyle = 'frugal';
  for (let i = 0; i < 120; i++) {
    const a = Agent.decide(st, NOW + i * 47000);
    if (a && (['date', 'errand'].indexOf(a.act) >= 0 || (a.act === 'gift' && a.size !== 'small'))) {
      ok(false, '节俭越界: ' + JSON.stringify(a)); return;
    }
  }
  ok(true, '节俭风格边界');
})();

// ── 3. 预算超线切免费池（04 §2.4 行为兜底）──
(function () {
  const st = fresh();
  st.gold = 1e9;
  st.spent.global = st.settings.dailyBudget;
  for (let i = 0; i < 150; i++) {
    const a = Agent.decide(st, NOW + i * 53000);
    if (isPaid(a)) { ok(false, '超线出付费: ' + JSON.stringify(a)); return; }
  }
  ok(true, '预算超线切免费池');
})();

// ── 4. 在岗渠道感知（02 §4 / 04 §5）──
(function () {
  const st = fresh();
  Engine.startShift(st, 8);
  let sawWorkplace = false, sawOfflinePaidOrInteract = false;
  for (let i = 0; i < 400; i++) {
    const t = NOW + i * 30000;
    const a = Agent.decide(st, t);
    if (!a) continue;
    if (a.act === 'workplace') {
      sawWorkplace = true;
      if (NPC_BY_ID[a.id].tier !== 1) { ok(false, '职场互动给了非 T1'); return; }
    }
    if (['gift', 'date', 'errand', 'interact'].indexOf(a.act) >= 0) { sawOfflinePaidOrInteract = true; break; }
    Engine.execAction(st, a, t);          // 执行才有冷却推进
  }
  ok(sawWorkplace, '在岗期间使用职场互动');
  ok(!sawOfflinePaidOrInteract, '在岗不做线下动作');
})();

// ── 5. 体力分配 reserve（02 §4.2 三档优先级）──
(function () {
  const st = fresh();
  st.priority = 'work_first';
  st.stamina = 50;                        // < 75% 上限
  st.settings.decisionIntervalSec = 60;
  for (let i = 0; i < 40; i++) {
    const a = Agent.decide(st, NOW + i * 61000);
    if (a && a.stamina > 0 && a.act !== 'item') { ok(false, 'reserve 内耗体: ' + JSON.stringify(a)); return; }
  }
  st.priority = 'social_first';
  st.cds.t1_gu = { wx: st.gt + 999 * 3600000, mo: st.gt + 999 * 3600000, wp: 0 };  // 屏蔽零体力动作
  const a = Agent.decide(st, NOW);
  ok(a && a.stamina > 0, '先社交后工作放行耗体');
})();

// ── 6. 候补队列自动补位排序 ──
(function () {
  const st = fresh();
  st.slotCount = 5;
  st.slots = [];
  st.settings.autoSlotOrder = 'output';
  Agent.refillQueue(st);
  eq(st.slots[0], 't1_gu', '产出优先：顾言(1.2)第一');
  const outs = st.slots.map((id) => B.BASE_OUTPUT[NPC_BY_ID[id].type] * B.TIERS[NPC_BY_ID[id].tier - 1].mult * NPC_BY_ID[id].coef);
  let sorted = true;
  for (let i = 1; i < outs.length; i++) if (outs[i] > outs[i - 1] + 1e-9) sorted = false;
  ok(sorted, '产出降序');

  st.slots = [];
  st.settings.autoSlotOrder = 'refer';
  Agent.refillQueue(st);
  eq(st.slots[0], 't1_shen', '引荐优先：穆成（refer 陆之衍）第一');

  st.slots = ['t1_gu'];
  st.settings.autoSlotOrder = 'off';
  ok(Agent.refillQueue(st) === false, 'off 模式不自动补位');
})();

// ── 7. pauseReason 角标 ──
(function () {
  const st = fresh();
  eq(Agent.pauseReason(st, 't1_gu'), '破冰期', '破冰期角标');
  Engine.npc(st, 't1_gu').favor = 60;
  st.spent.global = st.settings.dailyBudget;
  eq(Agent.pauseReason(st, 't1_gu'), '预算', '预算角标');
  st.spent.global = 0;
  st.priority = 'work_first';
  st.stamina = 10;
  eq(Agent.pauseReason(st, 't1_gu'), '体力', '体力角标');
})();

// ── 8. 物品决策：缺体力吃咖啡 ──
(function () {
  const st = fresh();
  st.priority = 'social_first';
  st.stamina = 15;
  st.inv.push({ it: 'energy_coffee', q: 'common' });
  let hit = null;
  for (let i = 0; i < 30 && !hit; i++) {
    const t = NOW + i * 20000;
    const a = Agent.decide(st, t);
    if (a) {
      if (a.act === 'item' && a.reason.indexOf('咖啡') >= 0) hit = a;
      else Engine.execAction(st, a, t);      // 执行推进零体力动作的冷却
    }
  }
  ok(hit && hit.invIdx === 0, '低体力优先掏咖啡');
})();

// ── 9. 红线集成模拟（00 §4）：全自动不碰按钮，首个资产上线 ──
function redLine(style, maxGameMin, label) {
  const st = fresh();
  st.settings.spendStyle = style;
  st.settings.decisionIntervalSec = 5;
  const dt = 5000;
  const steps = Math.ceil(maxGameMin * 60000 / dt);
  for (let i = 0; i < steps; i++) {
    Engine.step(st, dt);
    const act = Agent.decide(st, NOW + i * dt, Math.random);
    if (act) Engine.execAction(st, act, NOW + i * dt, Math.random);
    Agent.refillQueue(st);
    if (st.npcs.t1_gu.asset) break;
  }
  ok(st.npcs.t1_gu.asset,
    label + '：' + Math.round(st.gt / 60000) + ' 游戏分钟资产上线（剩余金 ' +
    Math.round(st.gold) + '，风格 ' + style + '）');
}
redLine('generous', 14, '大方流红线（目标 ≤14 分钟）');
redLine('standard', 20, '标准流节奏（目标 ≤20 分钟）');

console.log('');
console.log('总计 ' + (passed + failed) + ' 项，通过 ' + passed + '，失败 ' + failed);
if (failed > 0) {
  console.log('失败用例:');
  failedNames.forEach((n) => console.log('  - ' + n));
  process.exit(1);
}
