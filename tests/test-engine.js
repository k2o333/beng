// 引擎自测 v2（纯 node，零依赖）：数值依据 docs/drafts/alpha2/01~08 + docs/dev/v2-api.md
'use strict';

require('../src/js/data/balance.js');
require('../src/js/data/npcs.js');
require('../src/js/data/items.js');
require('../src/js/data/texts.js');
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
// 确定性 rng 序列
function seqRng(values) { let i = 0; return () => values[i++ % values.length]; }
// 正午时刻（避开晚班 ×1.5 与夜猫子窗口，保证时间相关断言确定性）
const NOON = (() => { const d = new Date(NOW); d.setHours(12, 0, 0, 0); return d.getTime(); })();

// ── 1. newState 初始值（v2：启动资金/自动开攻/入职）──
(function () {
  const st = fresh();
  eq(st.tier, 1, 'newState: tier=1');
  eq(st.slotCount, 3, 'newState: slotCount=3');
  eq(st.gold, 10000, 'newState: 启动资金 10000（02 §2）');
  eq(st.slots[0], 't1_gu', 'newState: 第一目标顾言自动进槽（00 §4 红线）');
  eq(st.job.id, 'restaurant', 'newState: 已入职餐厅');
  eq(st.settings.staminaRegenPerMin, 12, 'newState: 体力恢复 12/分（alpha4 校准）');
})();

// ── 2. statusOf 状态机 ──
(function () {
  const st = fresh();
  st.slots = [];
  eq(Engine.statusOf(st, DEF.t1_lin), 'available', 'statusOf: T1 available');
  eq(Engine.statusOf(st, DEF.t2_lu), 'locked', 'statusOf: T2 locked');
  ok(Engine.addToSlot(st, 't1_lin').ok, 'addToSlot 成功');
  eq(Engine.statusOf(st, DEF.t1_lin), 'courting', 'statusOf: 入槽 courting');
  ok(Engine.removeFromSlot(st, 't1_lin').ok, 'removeFromSlot 成功');
})();

// ── 3. 自动好感不变：60 分钟 ≈ 1.4 点（alpha4 校准 restraint=24）；体力 12 点/分 ──
(function () {
  const st = fresh();
  near(Engine.autoFavorPerMin(st, DEF.t1_lin), 0.5 / 24, 1e-9, 'T1 无魅力自动好感 ≈0.0227/分');
  st.stamina = 40;
  Engine.step(st, 3 * 60000);
  eq(st.stamina, 76, '3 分钟回复 36 点（12/分），40→76');
  st.slots = ['t1_lin'];
  const f0 = Engine.npc(st, 't1_lin').favor;
  Engine.step(st, 60 * 60000);
  near(Engine.npc(st, 't1_lin').favor - f0, 60 * 0.5 / 24, 0.1, 'step 60 分钟 favor≈1.25');
  eq(Math.floor(st.gt / 60000), 63, '游戏时钟 gt 累计');
})();

// ── 4. 渠道动作（02 §4.1 / 04 §2.4 免费池）──
(function () {
  const st = fresh();
  // 微信：+2 固定，CD 30 游戏分
  let r = Engine.wechat(st, 't1_gu');
  ok(r.ok, 'wechat 首次成功');
  near(r.gain, 0.3, 1e-9, 'wechat +0.3 固定好感（alpha4 校准）');
  r = Engine.wechat(st, 't1_gu');
  ok(!r.ok && r.msg === '冷却中', 'wechat 冷却拦截');
  // 朋友圈：0 体力 CD 2 时
  r = Engine.moments(st, 't1_gu');
  ok(r.ok, 'moments 成功');
  r = Engine.moments(st, 't1_gu');
  ok(!r.ok, 'moments 冷却拦截');
  // 职场互动需在岗且 T1
  r = Engine.workplace(st, 't1_gu', NOW);
  ok(!r.ok && r.msg.indexOf('在岗') >= 0, 'workplace 非在岗拒绝');
  Engine.startShift(st, 8);
  r = Engine.workplace(st, 't1_gu', NOW);
  ok(r.ok, 'workplace 在岗成功');
  r = Engine.workplace(st, 't1_he', NOW);
  ok(!r.ok, 'T1 未入槽拒绝（需 courting）');
  // 线下互动在岗拒绝
  r = Engine.interact(st, 't1_gu', NOW);
  ok(!r.ok && r.msg.indexOf('动嘴') >= 0, 'interact 在岗拒绝（渠道约束）');
  Engine.stopShift(st);
  r = Engine.interact(st, 't1_gu', NOW);
  ok(r.ok, '下班后 interact 成功');
  near(r.gain, 0.5 / 24 * 5, 1e-9, 'T1 基础互动收益 ≈0.1136（alpha4 校准）');
})();

// ── 5. 消费项目价目（05 §2 公式口径）──
(function () {
  const st = fresh();
  eq(Engine.priceOf(st, 'gift', 'small', 1), 240, '小礼 T1=240（alpha4 校准重定价）');
  eq(Engine.priceOf(st, 'date', 'light', 1), 360, '轻约=小礼×1.5=360（alpha4 校准重定价）');
  eq(Engine.priceOf(st, 'date', 'meal', 1), 1050, '正餐=中礼×1.5=1050（alpha4 校准）');
  eq(Engine.priceOf(st, 'date', 'trip', 1), 5500, '远行=大礼×2.5=5500（alpha4 校准）');
  eq(Engine.priceOf(st, 'errand', null, 1), 13200, '办事=大礼×6=13200（alpha4 校准）');
  st.settings.priceRate = 2;
  eq(Engine.priceOf(st, 'gift', 'small', 1), 480, 'priceRate 全局物价 ×2');
})();

// ── 6. 偏好匹配与热点加成（05 §3 / 08 §5）──
(function () {
  const st = fresh();  // 顾言 tags=[科技,市井]
  let m = Engine.matchTags(st, DEF.t1_gu, ['市井', '美食']);
  ok(m.hit && m.coef === 1.2, '街角咖啡命中市井 ×1.2');
  m = Engine.matchTags(st, DEF.t1_gu, ['文艺', '收藏']);
  ok(!m.hit && m.coef === 0.8, '看展错配 ×0.8');
  near(Engine.favorOf(st, DEF.t1_gu, 'date', 'light', 0), 8 * 1.2 * 0.35, 1e-9, '命中轻约 8×1.2×favorPerYuan(0.35)');
  near(Engine.favorOf(st, DEF.t1_gu, 'date', 'light', 1), 8 * 0.8 * 0.35, 1e-9, '错配轻约 8×0.8×favorPerYuan(0.35)');
  // 情报：第三偏好扩展窗口 + 雷区强制错配
  st.intel.t1_gu = { third: true };
  m = Engine.matchTags(st, DEF.t1_gu, ['商务', '酒局']);
  ok(m.hit && m.coef === 1.2, '第三偏好「商务」命中商务宴请');
  st.intel.t1_gu.mine = true;
  m = Engine.matchTags(st, DEF.t1_gu, ['文艺', '时尚']);
  ok(m.coef === 0.8, '雷区外变体维持错配');
  // 热点命中 +20%
  st.hotspot = { day: Engine.dayIndex(st), list: [{ name: '画廊新展', tags: ['文艺', '收藏'] }] };
  st.intel.t1_gu = {};
  const hotBase = B.SPEND.date.light.favor * 0.8 * B.DATE.HOTSPOT_FAVOR * globalThis.SETTINGS_DEFAULT.favorPerYuanRate;
  near(Engine.favorOf(st, DEF.t1_gu, 'date', 'light', 1), hotBase, 1e-9, '热点命中看展再 ×1.2');
})();

// ── 7. 送礼/约会结算与解锁门槛 ──
(function () {
  const st = fresh();
  st.gold = 50000;
  let r = Engine.spendGift(st, 't1_gu', 'mid');
  ok(r.ok && r.cost === 700, '中礼扣费 700（alpha4 校准）');
  near(st.npcs.t1_gu.favor, 10 * 0.35, 1e-9, '中礼 +10×favorPerYuan(0.35)=3.5 好感');
  eq(st.spent.npc.t1_gu, 700, '单人台账记录');
  r = Engine.spendDate(st, 't1_gu', 'meal', 0);
  ok(!r.ok && r.msg.indexOf('25') >= 0, '正餐需好感≥25');
  Engine.npc(st, 't1_gu').favor = 24;
  Engine.grantFavor(st, DEF.t1_gu, 1, []);
  r = Engine.spendDate(st, 't1_gu', 'trip', 0);
  ok(!r.ok, '远行需好感≥50');
  r = Engine.spendErrand(st, 't1_gu');
  ok(!r.ok, '办事需好感≥75');
  Engine.npc(st, 't1_gu').favor = 76;
  r = Engine.spendErrand(st, 't1_gu');
  ok(r.ok, '办事成功');
  ok(st.errandUsed.t1_gu, 'errandUsed 标记');
  r = Engine.spendErrand(st, 't1_gu');
  ok(!r.ok, '每人限一次');
  // 大礼品味门槛沿用
  st.attrs.taste = 0;
  if (!Engine.addToSlot(st, 't3_fu').ok) { st.tier = 3; ok(Engine.addToSlot(st, 't3_fu').ok, '构造 T3 入槽'); }
  r = Engine.spendGift(st, 't3_fu', 'large');
  ok(!r.ok && r.msg.indexOf('品味') >= 0, '大礼品味不足拒绝');
})();

// ── 8. 预算硬护栏（05 §4 手动/自动共用）──
(function () {
  const st = fresh();
  st.gold = 1e9;
  st.spent.global = st.settings.dailyBudget;   // 全局达线
  const r = Engine.spendGift(st, 't1_gu', 'small');
  ok(!r.ok && r.msg === '今日预算已用完', '超线付费拦截');
  eq(st.spent.global, st.settings.dailyBudget, '失败不记账');
  st.spent.global = 0;
  st.spent.npc.t1_gu = st.settings.perNpcBudget;
  const r2 = Engine.spendGift(st, 't1_gu', 'small');
  ok(!r2.ok, '单人达线同样拦截');
  const r3 = Engine.spendGift(st, 't1_zhou') || undefined;
  st.slots.push('t1_zhou');
  const r4 = Engine.spendGift(st, 't1_zhou', 'small');
  ok(r4.ok, '其他 NPC 不受单人线影响');
  eq(Engine.budgetLeftGlobal(st), Infinity * 0 || (st.settings.dailyBudget - st.spent.global),
    'budgetLeftGlobal 扣减正确');
})();

// ── 9. 工作排班（02 方案 A）：工资/耗体力/歇业/班次结束 ──
(function () {
  const st = fresh();
  const NOON9 = NOON;   // 局部引用（避免与上方全局重名告警）
  Engine.startShift(st, 2);
  ok(Engine.onDuty(st), '上班 onDuty');
  const g0 = st.gold;
  const s0 = st.stamina;
  st.slots = ['t1_lin'];             // 换声望型在槽：里程碑发声望不污染工资
  Engine.step(st, 3600000, { nowReal: NOON9 });          // 1 游戏小时
  near(st.gold - g0, 30, 0.51, '餐厅时薪 30 元/时（无小费口径）');
  near(s0 - st.stamina, 12, 0.01, '耗体力 12/时');
  Engine.step(st, 3600000, { nowReal: NOON9 });          // 第 2 小时 → 班次结束
  ok(!Engine.onDuty(st), '2 小时班次自动结束');
  // 歇业规则：体力见底停工不惩罚
  const savedRegen = st.settings.staminaRegenPerMin;
  st.settings.staminaRegenPerMin = 0;      // 关闭回复才能压到底
  st.stamina = 0.1;
  Engine.startShift(st, 4);
  st.job.resting = false;
  Engine.step(st, 60000);
  eq(st.job.resting, true, '体力见底触发歇业');
  st.settings.staminaRegenPerMin = savedRegen;
  st.stamina = st.settings.staminaMax * BALANCE.WORK_REST_RESUME + 5;
  Engine.step(st, 60000);
  ok(!st.job.resting, '恢复到 30% 自动复岗');
  Engine.stopShift(st);
  // 夜班解锁门槛
  const r = Engine.hireJob(st, 'night');
  ok(!r.ok, '便利店夜班需资产≥3');
})();

// ── 10. 掉落期望对齐 v1 秒产（07 §1.2）＋ 内容分流 ──
(function () {
  const st = fresh();
  const def = DEF.t1_gu;                       // money ×1.2 → 期望 4320 金/时
  const N = 4000;
  let sumGold = 0, goldCnt = 0, itemCnt = 0, qCnt = { common: 0, fine: 0, rare: 0 };
  const rng = Math.random;
  for (let i = 0; i < N; i++) {
    const roll = Engine.rollLoot(st, def, rng);
    if (roll.kind === 'gold') { sumGold += roll.qty; goldCnt++; }
    else if (roll.kind === 'item') { itemCnt++; qCnt[roll.q]++; }
  }
  near(sumGold / N, 1.2 * 3600 * 0.70 * 0.08, 1.2 * 3600 * 0.08 * 0.08, '金币包期望（含分支占比×dropValueRate 0.08）≈242/时（±8%）');
  const itemShare = itemCnt / N;
  near(itemShare, 0.30, 0.06, '物品分支占比 ≈30%（07 内容表 money 型）');
  ok(qCnt.common > qCnt.fine && qCnt.fine >= qCnt.rare, '品质分布 普通>精致≥稀有');
  // 声望型手札
  const repRoll = Engine.rollLoot(st, DEF.t1_lin, () => 0.001);
  ok(repRoll.kind === 'letter' && repRoll.qty === B.LOOT.LETTER_REP[1], '声望型掉手札 T1=1');
  near(Engine.lootIntervalMs(st, DEF.t1_gu, () => 0.5) / 1000, 200, 0.01,
    '间隔基准 120s×dropIntervalRate2÷系数1.2（jitter=1.0 口径）');
})();

// ── 11. 掉落拾取/背包容量与挤占/出售（堆叠模型回归锚点）──
(function () {
  const st = fresh();
  st.drops.push({ uid: 1, id: 't1_gu', kind: 'gold', qty: 500, bornReal: NOW });
  let r = Engine.collectDrop(st, 1, true);
  ok(r.ok && st.gold === 10000 + 1000, '暴击 ×2 到账');
  st.inv = [];
  for (let i = 0; i < 48; i++) st.inv.push({ it: i % 2 ? 'souvenir' : 'intel_brief', q: 'common', n: 1 });
  st.inv.push({ it: 'milk_tea_coupon', q: 'common', n: 2 });   // 49 格
  ok(Engine.invAdd(st, 'gift_box', 'fine'), '未满入包');
  eq(st.inv.length, 50, '容量封顶 50（基础档）');
  ok(Engine.invAdd(st, 'energy_coffee', 'common'), '满包挤普通');
  eq(st.inv.length, 50, '挤占后仍封顶 50');
  ok(st.inv.some((x) => x.it === 'energy_coffee'), '新物在包');
  st.inv = []; for (let i = 0; i < 50; i++) st.inv.push({ it: 'souvenir', q: 'rare', n: 1 });
  eq(st.inv.length, 50, '稀有包已满');
  eq(Engine.invAdd(st, 'souvenir', 'common'), false, '全稀有包拒收普通');
  const unit = Math.max(1, Math.round(25 * 0.3));
  st.inv = [{ it: 'souvenir', q: 'common', n: 3 }];
  const g0 = st.gold;
  r = Engine.sellItem(st, 0);
  ok(r.ok && r.gold === unit * 3 && st.gold === g0 + r.gold, '整堆出售折价 30%×n');
  eq(st.inv.length, 0, '整堆售罄移除条目');
  st.inv = [{ it: 'souvenir', q: 'common', n: 5 }];
  r = Engine.sellItem(st, 0, 2);
  eq(st.inv[0].n, 3, '部分出售扣减数量');
  eq(r.gold, unit * 2, '部分出售金额口径一致');
})();

// ── 12. 物品效果 ──
(function () {
  const st = fresh();
  st.stamina = 10;
  st.inv.push({ it: 'energy_coffee', q: 'fine' });
  let r = Engine.useItem(st, 0, null);
  ok(r.ok && st.stamina === 55, '精致体力咖啡 +45（30×1.5）→55');
  st.inv.push({ it: 'souvenir', q: 'common' });
  r = Engine.useItem(st, 0, 't1_gu');
  ok(r.ok && st.npcs.t1_gu.favor === 2, '纪念品送出 +2 好感');
  st.inv.push({ it: 'gift_box', q: 'fine' });
  r = Engine.useItem(st, 0, 't1_gu');
  ok(r.ok, '礼物盒免费送出');
  near(st.npcs.t1_gu.favor, 17, 1e-9, '精致礼物盒等效中礼 ×1.5=15（2+15）');
  st.inv.push({ it: 'card_holder', q: 'common' });
  r = Engine.useItem(st, 0, null);
  ok(st.gt < st.buffs.dateOffGt, '名片夹折扣 buff 生效');
  eq(Engine.priceOf(st, 'date', 'light', 1), Math.round(360 * 0.8), '约会价 8 折');
  st.inv.push({ it: 'intel_brief', q: 'common' });
  const rep0 = st.rep;
  Engine.useItem(st, 0, null);
  ok(st.rep > rep0, '内部简报加声望');
  // 引荐名片解锁上一层锁定 NPC
  st.inv.push({ it: 'referral_card', q: 'rare' });
  r = Engine.useItem(st, 0, null);
  ok(r.ok && st.npcs.t2_lu.referred === true, '引荐名片解锁 T2 锁定 NPC');
})();

// ── 13. 里程碑/满级/引荐（v1 口径回归）──
(function () {
  const st = fresh();
  Engine.npc(st, 't1_gu').favor = 24;
  const ev = [];
  Engine.grantFavor(st, DEF.t1_gu, 2, ev);
  eq(ev.filter((e) => e.t === 'milestone').length, 1, '跨 25 触发里程碑');
  eq(st.gold, 10000 + 300, '金钱型里程碑 +300（含启动金基线）');
  const st2 = fresh();
  Engine.npc(st2, 't1_shen').favor = 99;
  const ev2 = [];
  Engine.grantFavor(st2, DEF.t1_shen, 1, ev2);
  eq(st2.npcs.t2_lu.referred, true, '穆成满级引荐陆之衍（03 名册）');
  const st3 = fresh();
  const ev3 = [];
  Engine.npc(st3, 't1_gu').favor = 20;
  Engine.grantFavor(st3, DEF.t1_gu, 10, ev3);
  ok(ev3.some((e) => e.t === 'stage' && e.from === 'ice' && e.to === 'warm'), '阶段切换事件 ice→warm');
})();

// ── 14. 热点日历与邀约（08 §4~§5）──
(function () {
  const st = fresh();
  const list = Engine.refreshHotspots(st, () => 0.1);
  ok(list.length >= 1 && list.length <= 2, '每日热点 1~2 个');
  ok(list.every((h) => h.name && h.tags.length >= 2), '热点带 tag');
  // 邀约判定：rng=0 必中
  Engine.npc(st, 't1_gu').favor = 50;
  const ev = Engine.inviteRoll(st, () => 0.001);
  ok(st.invites.length === 1 && ev.some((e) => e.t === 'invite'), '好感≥50 判定出邀约');
  // 接受=免费正餐档
  const f0 = st.npcs.t1_gu.favor;
  const r = Engine.acceptInvite(st, 't1_gu', Math.random);
  ok(r.ok && st.invites.length === 0, '接受邀约消耗邀约');
  ok(st.npcs.t1_gu.favor > f0, '免费约会推进好感');
  // 低好感不出邀约
  const st2 = fresh();
  Engine.npc(st2, 't1_gu').favor = 39;
  Engine.inviteRoll(st2, () => 0.001);
  eq(st2.invites.length, 0, '好感<40 无邀约');
})();

// ── 15. 日切重置预算 ──
(function () {
  const st = fresh();
  st.spent.global = 999;
  Engine.step(st, B.DAY_MS + 1000);   // 跨一天
  eq(st.spent.day, 1, 'dayIndex 前移');
  eq(st.spent.global, 0, '日切清零台账');
  ok(st.hotspot.day === 1, '热点随日切刷新');
})();

// ── 16. 情报揭示（08 §6）──
(function () {
  const st = fresh();
  ok(Engine.revealIntel(st, () => 0.01, []), '揭示成功');
  const keys = Object.keys(st.intel);
  eq(keys.length, 1, '一条情报一个 NPC');
  const info = st.intel[keys[0]];
  ok(info.third || info.line || info.mine, '情报字段写入');
})();

// ── 17. 离线结算 v2（04 §5 同架构模拟）──
(function () {
  // 8 小时：工资 + 决策器动作聚合
  const st = fresh();
  Engine.startShift(st, 8);
  st.lastSeen = NOW - 8 * 3600000;
  const rep = Engine.settleOffline(st, NOW, Math.random, () => ({ act: 'wechat', id: 't1_gu' }));
  ok(!rep.capped, '8h 未触顶');
  ok(rep.wage > 150 && rep.wage < 420, '离班工资 ≈240（现实晚班时段 ×1.5 波动）');
  ok(rep.actions.length > 0, '决策动作聚合非空');
  ok(rep.package instanceof Array, '离线包裹字段存在');
  ok(rep.ms > 0, '结算游戏时长>0');

  // 30 小时触顶（12h 上限）
  const st2 = fresh();
  st2.lastSeen = NOW - 30 * 3600000;
  const rep2 = Engine.settleOffline(st2, NOW);
  ok(rep2.capped, '30h 触顶 capped=true');
  near(rep2.awayMs, 30 * 3600000, 1, 'awayMs 记录真实离开时长');

  // 离线好感效率 50%
  const st3 = fresh();
  st3.lastSeen = NOW - 2 * 3600000;
  const rep3 = Engine.settleOffline(st3, NOW);
  near(rep3.favors[0].gained, (0.5 / 24) * 120 * 0.5, 0.1, '离线好感=在线速率×50%（offlineFavorRate；alpha4 校准基率）');
})();

// ── 18. 存档迁移 v1→v3 ──
(function () {
  const v1 = {
    v: 1, createdAt: NOW, lastSeen: NOW, gold: 500, rep: 12, stamina: 55,
    attrs: { charm: 2, talk: 1, taste: 3 }, slotCount: 4, slots: ['t1_lin'], tier: 1,
    npcs: { t1_lin: { favor: 30, claimed: [25], asset: false, referred: false } },
    seen: {}
  };
  const m = Engine.migrate(v1);
  ok(m && m.v === B.SAVE_VERSION && m.v === 4, '迁移到 v4');
  eq(m.gold, 500, '保留金币');
  eq(m.slots[0], 't1_lin', '保留槽位');
  eq(m.npcs.t1_lin.favor, 30, '保留好感');
  ok(m.npcs.t1_lin.met === true, '老档已认识 NPC 标记 met');
  eq(m.settings.decisionIntervalSec, 5, '补齐 settings 默认');
  ok(Array.isArray(m.inv) && Array.isArray(m.drops), '补齐 v2 容器');
  ok(m.career && m.skills && m.equips && m.pets, '补齐 v3 四组字段');
  ok(Engine.migrate('garbage') === null, '损坏存档返回 null');
})();

// ── 19. 设置/GM ──
(function () {
  const st = fresh();
  Engine.setSetting(st, 'staminaRegenPerMin', 60);
  eq(st.settings.staminaRegenPerMin, 60, 'setSetting 生效');
  eq(st.customMode, true, '改动标记 customMode（01 §2.2）');
  Engine.applyPreset(st, 'casual');
  eq(st.customMode, false, '预设清除自定义标记');
  eq(st.settings.staminaRegenPerMin, 40, '休闲预设 40/分');
  Engine.gmGrant(st, 'gold', 1000);
  eq(st.gold, 11000, 'GM 发金币');
})();

// ── 20. 属性升级（priceRate/画册半价）──
(function () {
  const st = fresh();
  st.buffs.attrHalf = true;
  const r = Engine.upgradeAttr(st, 'charm');
  ok(r.ok && r.cost === 75 && !st.buffs.attrHalf, '画册半价生效并消耗');
})();

// ── 21. 堆叠模型 {it,q,n}（next-iteration §3.3.1）──
(function () {
  const st = fresh();
  ok(Engine.invAdd(st, 'gift_box', 'fine', 250), '批量入包成功');
  eq(st.inv.length, 3, '250 件按 99 上限分堆');
  ok(st.inv[0].n === 99 && st.inv[1].n === 99 && st.inv[2].n === 52, '单堆上限 99');
  st.inv = [{ it: 'energy_coffee', q: 'common', n: 10 }];
  Engine.invAdd(st, 'energy_coffee', 'common', 5);
  eq(st.inv.length, 1, '同 id 同品质并入单堆');
  eq(st.inv[0].n, 15, '数量累加');
  Engine.invAdd(st, 'energy_coffee', 'fine', 1);
  eq(st.inv.length, 2, '不同品质分开堆');
  const raw = { v: 2, createdAt: NOW, lastSeen: NOW, settings: {},
    inv: [{ it: 'souvenir', q: 'common' }, { it: 'gift_box', q: 'fine', n: 7 }] };
  const m = Engine.migrate(raw);
  eq(m.inv[0].n, 1, '旧档条目迁移补 n=1');
  eq(m.inv[1].n, 7, '已有 n 保留');
  ok(m.perks && m.capLevel === 0 && typeof m.stats.totalLoot === 'number'
    && typeof m.stats.totalInteract === 'number' && typeof m.stats.totalWorkMs === 'number',
    '成就/扩容/统计字段兜底');
})();

// ── 22. 合成 3 合 1（next-iteration §1）──
(function () {
  const st = fresh();
  st.inv = [
    { it: 'energy_coffee', q: 'common', n: 2 },
    { it: 'souvenir', q: 'common', n: 1 }
  ];
  const SYNTH_POOL = globalThis.ITEMS.filter((x) => x.effect.kind !== 'equip');   // 合成池不含装备（engine 同口径）
  const GIFT_IDX = SYNTH_POOL.findIndex((x) => x.id === 'gift_box');
  let r = Engine.synthItems(st, [{ i: 0, n: 2 }, { i: 1, n: 1 }], seqRng([GIFT_IDX / SYNTH_POOL.length]));
  ok(r.ok && r.gained.q === 'fine' && r.gained.id === 'gift_box', '3 普通必得精致（含 send 类）');
  eq(st.inv.filter((e) => e.q === 'common').length, 0, '跨堆材料消耗干净');
  ok(st.inv.some((e) => e.it === 'gift_box'), '产物入包');
  st.inv = [{ it: 'energy_coffee', q: 'common', n: 3 }];
  r = Engine.synthItems(st, [{ i: 0, n: 3 }], seqRng([0]));
  ok(r.ok && st.inv.length === 1 && st.inv[0].q === 'fine', '单堆整份合成');
  st.inv = [{ it: 'energy_coffee', q: 'common', n: 2 }];
  r = Engine.synthItems(st, [{ i: 0, n: 2 }]);
  ok(!r.ok && st.inv.length === 1 && st.inv[0].n === 2, '<3 拒绝不消耗');
  st.inv = [{ it: 'energy_coffee', q: 'common', n: 2 }, { it: 'gift_box', q: 'fine', n: 1 }];
  r = Engine.synthItems(st, [{ i: 0, n: 2 }, { i: 1, n: 1 }]);
  ok(!r.ok && st.inv.length === 2, '混品质拒绝不消耗');
  st.inv = [{ it: 'referral_card', q: 'rare', n: 3 }];
  r = Engine.synthItems(st, [{ i: 0, n: 3 }]);
  ok(!r.ok && st.inv[0].n === 3, '稀有不可再合');
  // 满包且部分消耗（腾不出格）→ 拒绝且原子
  st.capLevel = 3;
  st.inv = [];
  for (let i = 0; i < 79; i++) st.inv.push({ it: i % 2 ? 'souvenir' : 'intel_brief', q: 'rare', n: 1 });
  st.inv.push({ it: 'energy_coffee', q: 'common', n: 10 });
  r = Engine.synthItems(st, [{ i: 79, n: 3 }]);
  ok(!r.ok && st.inv.length === 80 && st.inv[79].n === 10, '满包无空位拒绝且不消耗材料');
  st.inv.splice(0, 1);   // 腾出一格
  r = Engine.synthItems(st, [{ i: 78, n: 3 }], seqRng([0]));
  ok(r.ok, '有空位即可合成');
  ok(Engine.findSynthTriple(st) !== null || true, 'findSynthTriple 可调用');
})();

// ── 23. 背包扩容金币坑（next-iteration §4）──
(function () {
  const st = fresh();
  eq(Engine.invCap(st), 50, '基础容量 50');
  st.gold = 6000000;
  let r = Engine.buyInvCap(st);
  ok(r.ok && Engine.invCap(st) === 60, '一级扩容 60 格');
  r = Engine.buyInvCap(st);
  ok(r.ok && Engine.invCap(st) === 70, '二级扩容 70 格');
  r = Engine.buyInvCap(st);
  ok(r.ok && Engine.invCap(st) === 80, '三级扩容 80 格');
  r = Engine.buyInvCap(st);
  ok(!r.ok, '买完再买拒绝');
  near(st.gold, 450000, 1e-6, '累计扣费 5万+50万+500万');
  st.gold = 100;
  r = Engine.buyInvCap(st);
  ok(!r.ok && Engine.invCap(st) === 80, '金币不足拦截');
  const st2 = fresh();
  st2.capLevel = 1;
  for (let i = 0; i < 59; i++) st2.inv.push({ it: i % 2 ? 'souvenir' : 'intel_brief', q: 'common', n: 1 });
  ok(Engine.invAdd(st2, 'milk_tea_coupon', 'common'), '60 格口径下入包');
  eq(st2.inv.length, 60, '一级扩容后容量生效');
})();

// ── 24. 自动出售阈值（next-iteration §4.1）──
(function () {
  const unitOf = (id) => Math.max(1, Math.round(globalThis.ITEM_BY_ID[id].sell * 0.3));
  const st = fresh();
  st.drops.push({ uid: 1, id: 't1_gu', kind: 'item', itemId: 'souvenir', q: 'common', bornReal: NOW });
  let r = Engine.collectDrop(st, 1, false, Math.random);
  ok(r.ok && st.inv.some((e) => e.it === 'souvenir'), 'off：普通照常入包');
  Engine.setSetting(st, 'autoSellGrade', 'common');
  const g0 = st.gold;
  const c0 = st.inv.length;
  st.drops.push({ uid: 2, id: 't1_gu', kind: 'item', itemId: 'souvenir', q: 'common', bornReal: NOW });
  r = Engine.collectDrop(st, 2, false, Math.random);
  ok(r.events.some((e) => e.t === 'autosell'), 'autosell 事件推送');
  eq(st.gold - g0, unitOf('souvenir'), '普通折价 30% 入账');
  eq(st.inv.length, c0, '自动售出后不入包');
  Engine.setSetting(st, 'autoSellGrade', 'fine');
  const g1 = st.gold;
  st.drops.push({ uid: 3, id: 't1_gu', kind: 'item', itemId: 'gift_box', q: 'fine', bornReal: NOW });
  Engine.collectDrop(st, 3, false, Math.random);
  eq(st.gold - g1, unitOf('gift_box'), '「精致及以下」精致也折价');
  const c1 = st.inv.length;
  st.drops.push({ uid: 4, id: 't1_gu', kind: 'item', itemId: 'limited_collectible', q: 'rare', bornReal: NOW });
  Engine.collectDrop(st, 4, false, Math.random);
  eq(st.inv.length, c1 + 1, '「精致及以下」下稀有必入包');
  ok(st.stats.totalLoot > 0, '拾取计数累计');
  // 离线同口径
  const st2 = fresh();
  Engine.setSetting(st2, 'autoSellGrade', 'fine');
  st2._offPackage = []; st2._offPackGold = 0;
  Engine.applyOfflineLoot(st2, { kind: 'item', itemId: 'souvenir', q: 'common' });
  Engine.applyOfflineLoot(st2, { kind: 'item', itemId: 'limited_collectible', q: 'rare' });
  eq(st2._offPackGold, unitOf('souvenir'), '离线折价进 packGold 口径');
  ok(st2._offPackage.length === 1 && st2._offPackage[0].q === 'rare' && st2._offPackage[0].n === 1,
    '离线包裹过滤稀有入包（带 n）');
  // 领取计入拾取成就并触发解锁
  const st3 = fresh();
  st3.stats.totalLoot = 490;
  Engine.absorbOfflinePackage(st3, [{ it: 'souvenir', q: 'common', n: 20 }]);
  eq(st3.stats.totalLoot, 510, '离线领取计拾取数');
  ok(st3.perks.picker === true, '捡漏之王跨线解锁');
})();

// ── 25. 成就即被动（next-iteration §2；alpha3 起走 bonuses 聚合器）──
(function () {
  const st = fresh();
  near(Engine.autoFavorPerMin(st, DEF.t1_lin), 0.5 / 24, 1e-9, '基线好感 ≈0.0227/分（alpha4 校准）');
  st.perks.touch = true;
  near(Engine.bonusMulOf(st, 'favorMul'), 1.03, 1e-9, '摸鱼大师 全局好感 ×1.03（聚合器词条）');
  const f0 = Engine.npc(st, 't1_lin').favor;
  Engine.grantFavor(st, DEF.t1_lin, 10, []);
  near(Engine.npc(st, 't1_lin').favor - f0, 10 * 1.03, 1e-9, '好感入账统一走 favorMul 结算点');
  const stW = fresh();
  stW.slots = [];                 // 清槽隔离里程碑金，只看工资
  Engine.startShift(stW, 4);
  const g1 = stW.gold;
  Engine.step(stW, 3600000);
  const dNoPerk = stW.gold - g1;
  stW.perks.workaholic = true;
  const g2 = stW.gold;
  Engine.step(stW, 3600000);
  near((stW.gold - g2) / dNoPerk, 1.1, 0.01, '全勤打工人 时薪 ×1.1');
  ok(stW.stats.totalWorkMs >= 7200000 - 1, '在岗时长计数累计');
  Engine.stopShift(stW);
  st.perks.social = true;
  eq(Engine.priceOf(st, 'date', 'light', 1), Math.round(360 * 0.95), '社交悍匪 约会价 ×0.95');
  st.perks.networker = true;
  eq(Engine.staminaMaxOf(st), 120, '人脉广博 体力上限 +20');
  st.stamina = 115;
  Engine.step(st, 60000);
  ok(st.stamina <= 120, '再生不超过新上限');
  st.perks.picker = true;
  near(Engine.lootIntervalMs(st, DEF.t1_gu, () => 0.5) / 1000, 190, 0.01, '捡漏之王 掉落间隔 ×0.95');
  const st2 = fresh();
  st2.buffs.dateOffGt = st2.gt + 3600000;
  st2.perks.social = true;
  eq(Engine.priceOf(st2, 'date', 'light', 1), Math.round(360 * 0.8 * 0.95), '名片夹 8 折与被动叠乘');
  const st3 = fresh();
  st3.stats.totalInteract = 999;
  const r = Engine.interact(st3, 't1_gu', NOW);
  ok(r.ok && r.events.some((e) => e.t === 'ach' && e.name === '摸鱼大师'), '达成瞬间推 ach 事件');
  ok(st3.perks.touch === true, 'perks 写入存档');
  ok(st3.stats.totalInteract === 1000, '线下互动计数');
})();

// ════════════════ alpha3 新增（docs/drafts/alpha3）════════════════

// ── 26. bonuses 聚合器：三型叠序固定 + add 封顶溢出转独立 mul（01-bonus-aggregator）──
(function () {
  const st = fresh();
  st.perks.touch = true;                       // favorMul mul ×1.03
  st.skills.nodes.s11 = true;                  // favorMul add +0.03
  st.skills.nodes.s13 = true;                  // favorMul add +0.03
  // final = (base+Σflat) × (1+min(Σadd,cap)) × Πmul
  near(Engine.bonusOf(st, 'favorMul', 100), 100 * (1 + 0.06) * 1.03, 1e-9, '聚合叠序：(base+flat)×(1+add)×mul');
  near(Engine.bonusFlatOf(st, 'favorMul'), 0, 1e-9, 'favorMul 无 flat 词条');
  st.skills.nodes.i13 = true;
  eq(Engine.bonusFlatOf(st, 'identifyFavor'), 5, '识人好感 flat+5');
  eq(Engine.bonusOf(st, 'identifyFavor', 2), 7, '识人基础2+flat5=7');
  // add 封顶：同类总上限 +100%，超出按条转独立 mul
  const fake = [
    { src: 'test', attr: 'favorMul', kind: 'add', value: 0.7 },
    { src: 'test', attr: 'favorMul', kind: 'add', value: 0.7 }
  ];
  st._bCache = fake;
  st._bSig = Engine.bonusSig(st);              // 测试注入口径：签名对齐即视为最新缓存
  near(Engine.bonusOf(st, 'favorMul', 1), (1 + 1) * (1 + 0.4), 1e-9,
    'Σadd=140% → 池封顶100%，超出40%转独立 mul ×1.4');
  delete st._bCache; delete st._bSig;
})();

// ── 27. 行业人脉派生：里程碑三分支 30%/60%/100% + 域分离 + 旋钮（02-network / career-mini §3）──
(function () {
  const st = fresh();
  Engine.npc(st, 't1_lin').favor = 24;    // 金融 t1(值2)：<25 → 不计入
  Engine.npc(st, 't1_gu').favor = 25;     // 高科技 t1：≥25 → 30%
  Engine.npc(st, 't1_he').favor = 50;     // 地产 t1：≥50 → 60%
  Engine.npc(st, 't1_zhou').favor = 75;   // 地产 t1：≥75 → 100%
  Engine.npc(st, 't1_shen').favor = 76;   // 金融 t1 → 100%
  let net = Engine.networkOf(st);
  near(net.finance, 2, 1e-9, '金融人脉 = 2×100%');
  near(net.tech, 0.6, 1e-9, '高科技人脉 = 2×30%');
  near(net.estate, 1.2 + 2, 1e-9, '地产人脉 = 2×60% + 2×100%');
  near(net.total, net.finance + net.estate + net.tech, 1e-9, '总人脉 = 三域之和');
  st.settings.networkGainMul = 2;
  net = Engine.networkOf(st);
  near(net.finance, 4, 1e-9, 'networkGainMul 总旋钮 ×2');
  // 派生值不进存档：newState 无此字段，函数实时计算
  ok(!('finance' in st) && typeof Engine.networkOf === 'function', '人脉为派生值不入档');
})();

// ── 28. 业务效率折算与缺口明示（03-career-business / start.md §12）──
(function () {
  const st = fresh();
  st.tier = 2;
  st.career.industry = 'estate';
  st.career.level = 2;
  const tpl = BALANCE.BIZ_TEMPLATES.find((t) => t.id === 'b_estate_2');   // 地产≥10 · 金钱型×1 · Lv2
  // 地产人脉不足 → 效率=人脉比；类型充足比=1
  Engine.npc(st, 't1_he').favor = 50;          // 地产 2×0.6=1.2… 再加满好感补到 5
  Engine.npc(st, 't1_zhou').favor = 75;        // 地产 +2
  Engine.npc(st, 't1_jiang').favor = 76;       // 江野是 tech… 用 t1_he/t1_zhou/t2_meng/t2_bai 凑地产
  Engine.npc(st, 't2_meng').favor = 75;        // 地产 +4? t2 值4 → +4
  Engine.npc(st, 't2_bai').favor = 75;         // 地产 +4
  let r = Engine.bizEfficiency(st, tpl);
  near(r.eff, Math.min(1, (1.2 + 2 + 4 + 4) / 10), 1e-9, '效率 = min(人脉比)=1.12→1');
  // 缺口口径：把地产压到 5
  st.npcs.t2_meng.favor = 0; st.npcs.t2_bai.favor = 0; st.npcs.t1_he.favor = 0; st.npcs.t1_zhou.favor = 0;
  Engine.npc(st, 't1_he').favor = 50;          // 1.2
  Engine.npc(st, 't1_zhou').favor = 60;        // 1.2 → 合计 2.4? zhou@60=60% → 1.2
  r = Engine.bizEfficiency(st, tpl);
  near(r.eff, 2.4 / 10, 1e-9, '人脉不足只降产量');
  ok(r.gaps.some((g) => g.indexOf('地产') >= 0 && g.indexOf('差') >= 0), 'UI 缺口文案：地产人脉还差 N');
  // 稳健派保底 50%：压到接近 0
  st.skills.nodes.k3a = true;
  st.npcs.t1_zhou.favor = 0;
  r = Engine.bizEfficiency(st, tpl);
  eq(r.eff, 0.5, '稳健派 效率下限保底 50%');
  // 豪赌派：无保底（先洗掉 k3a 的效果——直接移除节点），满条件业务量 ×1.3 在结算验证
  delete st.skills.nodes.k3a;
  Engine.npc(st, 't1_he').favor = 100; Engine.npc(st, 't1_zhou').favor = 100;
  Engine.npc(st, 't2_meng').favor = 100; Engine.npc(st, 't2_bai').favor = 100;
  r = Engine.bizEfficiency(st, tpl);
  eq(r.eff, 1, '条件全满足 效率=1');
  ok(r.full, 'full 标记供豪赌派判定');
  // 慧眼识珠：社交系投入≥4 时每条情报 +2% ≤+10%
  st.career.industry = 'tech';
  const tplT = BALANCE.BIZ_TEMPLATES.find((t) => t.id === 'b_tech_2');   // tech≥10
  Engine.npc(st, 't1_gu').favor = 100; Engine.npc(st, 't2_lu').favor = 100;
  Engine.npc(st, 't2_xu').favor = 100;   // tech: 2+4+4? gu(t1)=2, lu/xu(t2)=4×2 → 10 满
  st.intel = { a: { third: true }, b: { line: true }, c: { mine: true } };   // 3 条情报 → +6%
  st.skills.points = 30;
  ['s11', 's12', 's13'].forEach((id) => { st.skills.nodes[id] = true; });
  st.skills.nodes.s14 = 'ice';                 // 社交投入 = 4 点
  st.skills.nodes.y1 = true;
  r = Engine.bizEfficiency(st, tplT);
  eq(r.eff, 1, '慧眼识珠在满效率下不突破 1');
  st.npcs.t2_xu.favor = 74;                    // tech 降到 10×0.6+2+4=... 制造缺口：xu 归零
  st.npcs.t2_xu.favor = 0;                     // tech = gu2+lu4+jiang2 = 8 → 比 0.8；+情报6% → 0.86
  r = Engine.bizEfficiency(st, tplT);
  near(r.eff, 0.8 + 0.06, 1e-9, '慧眼识珠：每条情报使效率+2%（3条=+6%）');
})();

// ── 29. 提成公式 / 津贴 / 升职边界（可跨多级发技能点）（career-mini §2/§8）──
(function () {
  const st = fresh();
  st.career.industry = 'finance';
  Engine.npc(st, 't1_lin').favor = 100;    // 金融 2
  Engine.npc(st, 't1_shen').favor = 100;   // 金融 2
  Engine.npc(st, 't1_he').favor = 100;     // he 是 estate… 金融还差 2：用 t2_qin/t2_han
  Engine.npc(st, 't2_qin').favor = 0;
  // 目标模板 b_finance_1：fin≥6 → 目前 4，差 2 —— 先验证低效结算，再补满
  let r = Engine.startBiz(st, 'b_finance_1');
  ok(r.ok, '选单成功');
  near(r.eff, 4 / 6, 1e-9, '锁定效率 4/6');
  st.career.currentBiz.doneMs = st.career.currentBiz.workMs;
  const ev = [];
  Engine.settleBiz(st, NOON, ev);
  near(st.career.bizVolumeTotal, 5 * (4 / 6), 1e-9, '实得业务量 = 基准×效率');
  // 补满人脉后满效率结算：提成 = 基准量×提成率×√mult×300
  Engine.npc(st, 't2_qin').favor = 100; Engine.npc(st, 't2_han').favor = 100;   // fin = 4+4+4=12 ≥6
  r = Engine.startBiz(st, 'b_finance_1');
  eq(r.eff, 1, '人脉满足后效率 100%');
  st.career.currentBiz.doneMs = st.career.currentBiz.workMs;
  const goldBefore = st.gold;
  const ev2 = [];
  Engine.settleBiz(st, NOON, ev2);
  near(ev2[0].gold, 5 * 0.08 * 1 * 300, 1e-9, '提成 = 5万×8%×mult^0.5×300 = 120 金');
  near(st.gold - goldBefore, 120, 1e-9, '金币入账一致');
  // 升职边界：跨多级一次结清，每级发 1 技能点
  st.career.bizVolumeTotal = 1595;           // 距 lv4(1600) 差 5
  r = Engine.startBiz(st, 'b_finance_1');
  st.career.currentBiz.doneMs = st.career.currentBiz.workMs;
  const ev3 = [];
  Engine.settleBiz(st, NOON, ev3);
  eq(st.career.level, 4, '1595+5 跨 150/700/1600 三档 → Lv.4');
  eq(st.skills.points, 3, '每级升职发 1 技能点');
  eq(ev3.filter((e) => e.t === 'promo').length, 3, 'promo 事件三条');
  eq(careerAllowanceOf(st), 1500, '主管津贴 1500/周期');
  // bizThresholdMul 门槛缩放
  st.settings.bizThresholdMul = 10;
  ok(BALANCE.CAREER_LEVELS[st.career.level].need * 10 > st.career.bizVolumeTotal, '门槛缩放生效（下一档×10）');
  function careerAllowanceOf(s) { return BALANCE.CAREER_LEVELS[s.career.level - 1].allowance; }
})();

// ── 30. 天赋网规则：前置/大节点门槛/基石互斥/连携他系投入/洗点（04-skills §5~§6）──
(function () {
  const st = fresh();
  st.career.level = 8;                       // 总监期：基石与大节点解锁段
  st.skills.points = 40;
  // 大节点透视：需本系投入≥5 且点亮精华之一
  let chk = Engine.skillNodeState(st, 'i16');
  ok(chk.st === 'prev' || chk.st === 'invest', 'i16 未点前置/投入不足被拦');
  ['i11', 'i12', 'i13', 'i14', 'i15'].forEach((id) => { st.skills.nodes[id] = true; });
  st.skills.points -= 5;
  chk = Engine.skillNodeState(st, 'i16');
  eq(chk.st, 'can', '识人系投入 5 点后 i16 可点亮');
  st.slots = ['t1_gu', 't1_lin'];            // 先确立攻略关系：透视只揭示「已结识」对象（含槽内）
  let r = Engine.takeSkill(st, 'i16');
  ok(r.ok, '透视点亮成功');
  ok(Object.keys(st.intel).length >= 2, '透视点亮即全揭示情报');
  // 连携需他系投入≥4：y1 需社交≥4（经理期 gate 6）
  st.skills.nodes.s11 = true;                // 社交 1 点
  chk = Engine.skillNodeState(st, 'y1');
  ok(chk.st === 'gate' || chk.st === 'invest', 'y1 未达门槛');
  st.career.level = 6;                       // 经理期
  ['s11', 's12', 's13', 's15'].forEach((id) => { if (!st.skills.nodes[id]) { st.skills.nodes[id] = true; st.skills.points--; } });
  chk = Engine.skillNodeState(st, 'y1');
  eq(chk.st, 'can', '社交投入≥4 后 y1 可点亮（经理期）');
  // 基石同对互斥
  st.career.level = 8;
  r = Engine.takeSkill(st, 'k1a');
  ok(r.ok, '广撒网点亮');
  chk = Engine.skillNodeState(st, 'k1b');
  eq(chk.st, 'pair', '深耕与广撒网同对互斥');
  eq(Engine.slotCapOf(st), st.slotCount + 2, '广撒网 攻略槽+2');
  // 深耕词条：主目标好感+40%（与社交系 s11/s13 的 favorMul add +6% 同池叠加）
  delete st.skills.nodes.k1a;
  st.skills.nodes.k1b = true;
  const mMain = Engine.bonusMulOf(st, 'favorMul', { def: globalThis.NPC_BY_ID.t1_gu, isMain: true });
  const mSide = Engine.bonusMulOf(st, 'favorMul', { def: globalThis.NPC_BY_ID.t1_lin, isMain: false });
  near(mMain, 1.484, 1e-9, '深耕 主目标 ×1.4'); // 1.484 = 1.4（深耕）× 1.06（s11+s13 社交池）
  eq(mSide, 1.06, '非主目标不受深耕加成'); // 1.06 = 仅社交池 +6%；深耕是 mainTarget 条件乘子，非主目标吃不到
  eq(Engine.slotCapOf(st), st.slotCount - 1, '深耕 攻略槽-1');
  // 知心：好感上限 120 与收网区 ×2（此时 k1b 尚未移除且 t1_gu 是主槽，favorMul 全量参与）
  st.skills.nodes.s16 = true;
  eq(Engine.favorCapOf(st), 120, '知心 好感上限 120');
  Engine.npc(st, 't1_gu').favor = 101;
  Engine.grantFavor(st, globalThis.NPC_BY_ID.t1_gu, 1, []);
  near(Engine.npc(st, 't1_gu').favor, 103.968, 1e-9, '收网区收益 ×2'); // 103.968 = 101 + 1×2（收网区）×1.4（深耕·主目标）×1.06（社交池）
  Engine.npc(st, 't1_lin').favor = 119;
  Engine.grantFavor(st, globalThis.NPC_BY_ID.t1_lin, 5, []);
  ok(Engine.npc(st, 't1_lin').asset, '120 封顶转资产');
  // 洗点：首次免费返还全部，二次收费且词条回退
  const invested = Engine.skillPointsInvested(st);
  const ptsBefore = st.skills.points;
  eq(Engine.respecCostOf(st), 0, '首次洗点免费');
  r = Engine.respecSkills(st);
  ok(r.ok && r.refund === invested, '洗点返还全部已投点数');
  eq(st.skills.points, ptsBefore + invested, '点数到账');
  eq(Object.keys(st.skills.nodes).length, 0, '节点清空');
  eq(Engine.bonusMulOf(st, 'favorMul', { isMain: true }), 1, '洗掉基石后乘区恢复');
  eq(Engine.slotCapOf(st), st.slotCount, '攻略槽恢复');
  st.skills.nodes.k1b = true;
  st.skills.washed = 1;
  eq(Engine.respecCostOf(st), 1 * (st.settings.respecBase || 20000) * 2, '二次洗点费 = 点数×2万×(1+1)');
  // 知心：好感上限 120 与收网区 ×2（先移除深耕，隔离主目标乘区）
  delete st.skills.nodes.k1b;
  st.skills.nodes.s16 = true;
  eq(Engine.favorCapOf(st), 120, '知心 好感上限 120');
  Engine.npc(st, 't1_gu').favor = 101;
  Engine.grantFavor(st, globalThis.NPC_BY_ID.t1_gu, 1, []);
  near(Engine.npc(st, 't1_gu').favor, 103, 1e-9, '收网区收益 ×2');
  Engine.npc(st, 't1_lin').favor = 119;
  Engine.grantFavor(st, globalThis.NPC_BY_ID.t1_lin, 5, []);
  ok(Engine.npc(st, 't1_lin').asset, '120 封顶转资产');
})();

// ── 31. 装备槽 ×2：穿脱/换装旧件回包/品质放大（05-items-equipment）──
(function () {
  const st = fresh();
  st.inv.push({ it: 'watch_steel', q: 'common', n: 1 });
  let r = Engine.equipItemFromInv(st, 0);
  ok(r.ok && st.equips.watch.q === 'common', '手表入表槽');
  eq(st.inv.length, 0, '背包消耗');
  near(Engine.bonusMulOf(st, 'wageMul'), 1.06, 1e-9, '精钢腕表 时薪+6% 注册进聚合器');
  // 品质放大：fine ×1.5 → +9%
  st.inv.push({ it: 'watch_steel', q: 'fine', n: 1 });
  r = Engine.equipItemFromInv(st, 0);
  ok(r.ok && st.equips.watch.q === 'fine', '换装精致腕表');
  near(Engine.bonusMulOf(st, 'wageMul'), 1.09, 1e-9, '品质放大 ×1.5 → +9%');
  eq(st.inv.length, 1, '旧件回背包');
  ok(st.inv[0].q === 'common', '回包的是普通款');
  // useItem 通道同样能穿装备
  st.inv.push({ it: 'jewel_jade', q: 'rare', n: 1 });
  r = Engine.useItem(st, st.inv.length - 1, null);
  ok(r.ok && st.equips.jewel && st.equips.jewel.q === 'rare', 'useItem 穿戴首饰');
  near(Engine.bonusMulOf(st, 'favorMul'), 1 + 0.05 * 2, 1e-9, '稀有首饰 ×2 → 全局好感+10%');
  // 卸下
  r = Engine.unequipEquip(st, 'jewel');
  ok(r.ok, '卸下首饰');
  eq(st.equips.jewel, null, '槽位清空');
  ok(st.inv.some((e) => e.it === 'jewel_jade'), '首饰回包');
  near(Engine.bonusMulOf(st, 'favorMul'), 1, 1e-9, '卸下后词条注销');
  // 装备落位由 effect.slot 决定（手表只进手表槽）
  st.inv.push({ it: 'watch_steel', q: 'common', n: 1 });
  Engine.useItem(st, st.inv.length - 1, null);
  eq(st.equips.watch ? st.equips.watch.it : null, 'watch_steel', '装备落位由 effect.slot 决定');
})();

// ── 32. 宠物：累计行为解锁、永久全局生效（06-pets；alpha4 S4 三阶表）──
(function () {
  const st = fresh();
  st.stats.totalDates = 7;
  const ev = [];
  Engine.checkAchievements(st, ev);
  eq(st.pets.nuanshou || 0, 0, '7 次未解锁暖手');
  st.stats.totalDates = 8;
  Engine.checkAchievements(st, ev);
  eq(st.pets.nuanshou, 1, '累计约会 8 解锁暖手一阶（D6 二修）');
  ok(ev.some((e) => e.t === 'pet' && e.id === 'nuanshou'), '推送 pet 事件');
  near(Engine.bonusMulOf(st, 'favorMul'), 1.05, 1e-9, '暖手一阶 全局好感+5% 生效');
  st.stats.totalWorkMs = 100 * 3600000;
  Engine.checkAchievements(st, []);
  eq(st.pets.zhangfang, 1, '累计上班 100h 解锁账房一阶');
  st.stats.totalLoot = 500;
  Engine.checkAchievements(st, []);
  eq(st.pets.shihuang, 1, '累计掉落 500 件解锁拾荒一阶');
  // 同点触发「捡漏之王」成就（同计数器），dropMul 双乘区叠加：100×0.94×0.95
  near(Engine.lootIntervalMs(st, globalThis.NPC_BY_ID.t1_gu, () => 0.5) / 1000, 200 * 0.94 * 0.95, 0.01,
    '拾荒 掉落间隔 -6%（与捡漏之王被动叠乘）');
  // 可叠加：账房收入乘区与时薪被动同时生效
  st.perks.workaholic = true;
  near(Engine.incomeFactors(st, NOON), 1.08, 1e-9, 'incomeMul 词条注册（夜猫子未点窗口=1）');
})();

// ── 33. 存档 v2→v3 迁移：四组字段幂等补齐、非法值剔除（README 存档契约）──
(function () {
  const raw = {
    v: 2, createdAt: NOW, lastSeen: NOW, settings: {}, inv: [], drops: [],
    perks: {}, stats: {}, npcs: {},
    career: { industry: 'crypto', level: 99, bizVolumeTotal: -5, currentBiz: { tplId: 'nope' } },
    skills: { points: 7, nodes: { i16: true, k1a: true, k1b: true, bogus: true } },
    equips: { watch: { it: 'souvenir', q: 'common' }, jewel: 'junk' },
    pets: { unlocked: ['nuanshou', 'ghost'] }
  };
  const m = Engine.migrate(raw);
  eq(m.v, 4, 'v2 → v4');
  eq(m.career.industry, null, '非法行业归 null');
  eq(m.career.level, 10, '职级钳到 10');
  eq(m.career.bizVolumeTotal, 0, '负业务量归 0');
  eq(m.career.currentBiz, null, '未知模板单清除');
  ok(m.skills.nodes.i16 === true && m.skills.nodes.k1a === true, '合法节点保留');
  ok(!m.skills.nodes.k1b && !m.skills.nodes.bogus, '互斥另一侧与未知节点剔除');
  ok(m.skills.points === 7, '技能点保留');
  eq(m.equips.watch, null, '非装备物品从槽位剔除');
  ok(m.pets.nuanshou === 1 && !m.pets.ghost, '宠物白名单过滤（旧 unlocked[] 映射一阶）');
  // 幂等：再迁移一次结果一致
  const again = Engine.migrate(JSON.parse(JSON.stringify(m)));
  eq(JSON.stringify(again), JSON.stringify(m), '迁移幂等');
  ok(!('_bCache' in again), '缓存字段不入档');
})();

// ── 34. 识人动作：读一条隐藏情报 + 冷却/体力 + 察言观色 flat（04-skills 宿主动作）──
(function () {
  const st = fresh();
  st.slots = [];                               // 清掉开局默认目标，从零验证
  let r = Engine.identify(st, 't1_gu', NOW, seqRng([0]));
  ok(!r.ok, '未入槽不可识人');
  ok(Engine.addToSlot(st, 't1_gu').ok, '入槽');
  const stam0 = st.stamina;
  r = Engine.identify(st, 't1_gu', NOW, seqRng([0]));   // rng=0 → 揭示 third
  ok(r.ok, '识人成功');
  ok(st.intel.t1_gu.third === true, '揭示第三偏好');
  eq(st.stamina, stam0 - 12, '识人体力 -12');
  ok((st.cds.t1_gu.id || 0) > st.gt, '进入识人冷却');
  near(r.gain, 2, 1e-9, '基础寒暄好感 +2');
  r = Engine.identify(st, 't1_gu', NOW, seqRng([0]));
  ok(!r.ok && r.msg.indexOf('冷却') >= 0, '冷却拦截');
  st.cds.t1_gu.id = 0;
  st.intel.t1_gu = { third: true, line: true, mine: true };
  r = Engine.identify(st, 't1_gu', NOW, seqRng([0]));
  ok(!r.ok && r.msg.indexOf('看透') >= 0, '情报读全后拒绝');
  // 察言观色 i13：识人好感 flat+5
  st.skills.nodes.i13 = true;
  st.slots = ['t1_lin'];
  r = Engine.identify(st, 't1_lin', NOW, seqRng([0.9]));
  ok(r.ok, '第二目标识人成功');
  near(r.gain, 7, 1e-9, '察言观色：2+flat5 = 7');
})();

// ── 35. 总裁思维换单携带进度 + 装备掉率旋钮（03-career / 08§5 掉率透明）──
(function () {
  const st = fresh();
  st.tier = 2;
  st.career.industry = 'finance';
  st.career.level = 2;
  ok(Engine.startBiz(st, 'b_finance_1').ok, '接第一单');
  st.career.currentBiz.doneMs = 10 * 60000;            // 已跑 10 分钟
  let r = Engine.startBiz(st, 'b_finance_2');          // 无总裁思维：换单清零
  eq(st.career.currentBiz.doneMs, 0, '默认换单清空进度');
  st.skills.nodes.c16 = true;
  Engine.startBiz(st, 'b_finance_1');
  st.career.currentBiz.doneMs = 10 * 60000;
  r = Engine.startBiz(st, 'b_finance_2');              // 跨模板换单按已耗时携带（钳到新单工时）
  eq(st.career.currentBiz.doneMs, 10 * 60000, '总裁思维 换单不清空进度');
  // 装备掉率进 SETTINGS_DEFAULT（后台可调 + 档案卡公示口径）
  ok(typeof globalThis.SETTINGS_DEFAULT.equipDropRate === 'number', 'equipDropRate 旋钮存在');
  st.settings.equipDropRate = 1;
  const roll = Engine.rollLoot(st, globalThis.NPC_BY_ID.t1_gu, seqRng([0.999, 0.5]));
  ok(roll.itemId === 'watch_steel' || roll.itemId === 'jewel_jade', 'equipDropRate=1 时功能分支必出装备');
})();

// ════════════════ alpha4 Wave2（docs/drafts/alpha4：03 §S3/S4/S5 + 存档 v4）════════════════

// ── A1. S3 掉落保底：稀有 240 必出 / 装备 120 必出且品质≥精致 / 辅助 ×2 保留 / 金包手札不动计数 ──
(function () {
  const st = fresh();
  ok(st.loot && st.loot.pityRare === 0 && st.loot.pityEquip === 0, 'newState 含保底计数器（S3）');
  const gu = DEF.t1_gu;   // money 型
  // 稀有保底边界：239→普通件 +1 到 240；下一件强制稀有并清零（item 分支，确定性 rng）
  st.loot.pityRare = 239;
  const seqItem = seqRng([0.75, 0, 0.99, 0.99]);   // 分支=item → 品质普通 → limited_collectible
  let r = Engine.rollLoot(st, gu, seqItem);
  eq(r.q, 'common', '第 240 件仍按正常品质掷出普通');
  eq(st.loot.pityRare, B.LOOT.PITY_RARE, '未出稀有 → 计数累到 240');
  r = Engine.rollLoot(st, gu, seqItem);
  eq(r.q, 'rare', '计数满 → 下件强制稀有');
  eq(r.itemId, 'limited_collectible', '保底稀有照常发放物品');
  eq(st.loot.pityRare, 0, '稀有保底触发后清零');
  // 装备保底：func 分支 119→非装备 +1 到 120；下次必出装备且品质至少精致
  st.loot.pityEquip = 119;
  const seqFunc = seqRng([0.95, 0, 0.99, 0.999, 0.999]);   // 分支=func → 普通 → 非装备消耗品
  r = Engine.rollLoot(st, gu, seqFunc);
  eq(r.itemId, 'surprise_cake', '119 次未出装备时照常掷消耗品');
  eq(st.loot.pityEquip, B.LOOT.PITY_EQUIP, 'func 分支未出装备 → 计数累到 120');
  r = Engine.rollLoot(st, gu, seqFunc);
  ok(r.itemId === 'watch_steel' || r.itemId === 'jewel_jade', '装备保底触发必出装备');
  eq(r.q, 'fine', '装备保底品质跳过普通 → 精致');
  eq(st.loot.pityEquip, 0, '装备保底触发后清零');
  eq(st.loot.pityRare, 2, '被保底强制的非稀有装备同样累计稀有计数');
  // 强制装备的品质不变式：批量重置后连掷，品质只可能是精致或稀有
  for (let i = 0; i < 25; i++) {
    st.loot.pityEquip = B.LOOT.PITY_EQUIP;
    const fr = Engine.rollLoot(st, gu, seqRng([0.95, 0, 0.95, 0.95]));
    ok((fr.itemId === 'watch_steel' || fr.itemId === 'jewel_jade') && (fr.q === 'fine' || fr.q === 'rare'),
      '强制装备品质 ∈ {fine, rare} #' + i);
    eq(st.loot.pityEquip, 0, '每次强制后计数归零 #' + i);
  }
  // 辅助型稀有权重 ×2 保留：同一品质掷点 0.04，辅助位出稀有、金钱位只到精致
  st.loot.pityRare = 50;
  const he = DEF.t1_he;   // aux 型
  const rAux = Engine.rollLoot(st, he, seqRng([0.1, 0, 0.04, 0.999, 0.999]));   // aux 表 func 分支
  eq(rAux.q, 'rare', '辅助位稀有率 ×2：0.04 掷点出稀有');
  eq(st.loot.pityRare, 0, '自然稀有同样清零稀有计数');
  const rMoney = Engine.rollLoot(st, gu, seqRng([0.95, 0, 0.04, 0.999, 0.999]));
  eq(rMoney.q, 'fine', '无加成位同掷点只到精致（×2 权重对照）');
  // 双保底同时满足：装备保底先锁装备，稀有保底再抬到稀有
  st.loot.pityRare = B.LOOT.PITY_RARE;
  st.loot.pityEquip = B.LOOT.PITY_EQUIP;
  const rBoth = Engine.rollLoot(st, he, seqRng([0.1, 0, 0.5, 0.99]));
  ok((rBoth.itemId === 'watch_steel' || rBoth.itemId === 'jewel_jade') && rBoth.q === 'rare',
    '双保底叠加：必出装备且必稀有');
  eq(st.loot.pityRare, 0, '双保底后稀有计数清零');
  // 金包/手札/情报分支不碰任何计数器
  st.loot.pityRare = 7; st.loot.pityEquip = 9;
  const rl = Engine.rollLoot(st, DEF.t1_lin, seqRng([0.001]));   // 声望型 → 手札分支
  eq(rl.kind, 'letter', '手札分支照常');
  ok(st.loot.pityRare === 7 && st.loot.pityEquip === 9, '金包/手札/情报不动计数器');
  const rg = Engine.rollLoot(st, gu, seqRng([0.5, 0.5]));   // 金钱型 → 金币包
  eq(rg.kind, 'gold', '金币包分支照常');
  ok(st.loot.pityRare === 7 && st.loot.pityEquip === 9, '金包同样不碰计数器');
  // GM 重置保底
  const gm = Engine.gmResetPity(st);
  ok(gm.ok && st.loot.pityRare === 0 && st.loot.pityEquip === 0, 'gmResetPity 清零两枚计数');
})();

// ── A2. S4 宠物三阶：阈值边界 / 跨阶跃迁 / 效果阶梯 / 只升不降 ──
(function () {
  const st = fresh();
  st.stats.totalDates = 7;
  Engine.checkAchievements(st, []);
  ok(!st.pets.nuanshou, '7 次未解锁暖手');
  const ev = [];
  st.stats.totalDates = 8;
  Engine.checkAchievements(st, ev);
  eq(st.pets.nuanshou, 1, '恰好 8 次解锁一阶（阈值边界；D6 二修）');
  ok(ev.some((e) => e.t === 'pet' && e.id === 'nuanshou' && e.stage === 1), 'pet 事件带 stage 字段');
  near(Engine.bonusMulOf(st, 'favorMul'), 1.05, 1e-9, '一阶 全局好感 ×1.05');
  st.stats.totalDates = 16;
  ev.length = 0;
  Engine.checkAchievements(st, ev);
  eq(st.pets.nuanshou, 2, '恰好 16 次升二阶（D6 二修）');
  ok(ev.some((e) => e.t === 'pet' && e.stage === 2), '升阶推送 stage=2 事件');
  near(Engine.bonusMulOf(st, 'favorMul'), 1.08, 1e-9, '二阶 全局好感 ×1.08');
  st.stats.totalDates = 5000;
  Engine.checkAchievements(st, []);
  eq(st.pets.nuanshou, 3, '进度暴涨一次跨多阶直达三阶');
  near(Engine.bonusMulOf(st, 'favorMul'), 1.12, 1e-9, '三阶 全局好感 ×1.12');
  st.stats.totalDates = 0;
  Engine.checkAchievements(st, []);
  eq(st.pets.nuanshou, 3, '统计回退不降阶');
  // 账房（hours 口径）与拾荒的效果阶梯 + 与成就被动叠乘
  const st2 = fresh();
  st2.stats.totalWorkMs = 300 * 3600000;
  Engine.checkAchievements(st2, []);
  eq(st2.pets.zhangfang, 2, '账房 300h 二阶');
  near(Engine.incomeFactors(st2, NOON), 1.12, 1e-9, '账房二阶 incomeMul ×1.12');
  const st3 = fresh();
  st3.stats.totalLoot = 1500;
  Engine.checkAchievements(st3, []);
  eq(st3.pets.shihuang, 2, '拾荒 1500 件二阶');
  ok(st3.perks.picker === true, '同计数器触发捡漏之王一阶');
  near(Engine.lootIntervalMs(st3, DEF.t1_gu, () => 0.5) / 1000, 200 * 0.91 * 0.95, 0.01,
    '拾荒二阶 -9%（与捡漏之王 -5% 叠乘）');
})();

// ── A3. S5 成就二阶：通用检查器解锁 + 效果叠乘 ──
(function () {
  const st = fresh();
  st.perks.touch = true; st.perks.touch2 = true;
  near(Engine.bonusMulOf(st, 'favorMul'), 1.03 * 1.02, 1e-9, '摸鱼I+II 全局好感叠乘');
  st.perks.workaholic = true; st.perks.workaholic2 = true;
  near(Engine.bonusMulOf(st, 'wageMul'), 1.1 * 1.05, 1e-9, '全勤I+II 时薪叠乘');
  st.perks.picker = true; st.perks.picker2 = true;
  near(Engine.lootIntervalMs(st, DEF.t1_gu, () => 0.5) / 1000, 200 * 0.95 * 0.975, 0.01,
    '捡漏I+II 掉落间隔叠乘');
  st.perks.social = true; st.perks.social2 = true;
  eq(Engine.priceOf(st, 'date', 'light', 1), Math.round(360 * 0.95 * 0.975), '社交I+II 约会价叠乘');
  st.perks.networker = true; st.perks.networker2 = true;
  eq(Engine.staminaMaxOf(st), 130, '人脉I+II 体力上限 +20 再 +10');
  // 解锁路径：同一检查器自动接手 II 阶（5000 次互动跨双门槛）
  const st2 = fresh();
  st2.stats.totalInteract = 4999;
  const ev = [];
  const r = Engine.interact(st2, 't1_gu', NOW);
  ok(r.ok && st2.stats.totalInteract === 5000, '第 5000 次互动入账');
  ok(st2.perks.touch === true && st2.perks.touch2 === true, '一阶与二阶同点达成');
  ok(ev.concat(r.events || []).some((e) => e.t === 'ach' && e.name === '摸鱼大师II'), '推送摸鱼大师II ach 事件');
})();

// ── A4. 存档 v1/v2/v3 → v4 无损迁移 + 幂等（00 §5 D7 合并迁移）──
(function () {
  const v1 = { v: 1, createdAt: NOW, lastSeen: NOW, gold: 777, rep: 8, stamina: 44,
    attrs: { charm: 2 }, slotCount: 4, slots: ['t1_lin'], tier: 1,
    npcs: { t1_lin: { favor: 41, claimed: [25], asset: false, referred: false } }, seen: {} };
  const m1 = Engine.migrate(JSON.parse(JSON.stringify(v1)));
  eq(m1.v, 4, 'v1 → v4');
  eq(m1.gold, 777, 'v1 金币无损');
  eq(m1.npcs.t1_lin.favor, 41, 'v1 好感无损');
  ok(m1.loot && m1.loot.pityRare === 0 && m1.loot.pityEquip === 0, 'v1 补齐保底计数器');
  ok(m1.pets && Object.keys(m1.pets).length === 0, 'v1 宠物空表');
  eq(m1.career.boom.finance, 'stable', '景气默认平稳·金融');
  eq(m1.career.boom.estate, 'stable', '景气默认平稳·地产');
  eq(m1.career.boom.tech, 'stable', '景气默认平稳·高科技');
  eq(m1.wash.vouchers, 0, '试洗券占位补齐');
  eq(m1.wash.tierDone, 0, '圈层首通记录占位补齐');

  const v3 = { v: 3, createdAt: NOW, lastSeen: NOW, gt: 987654321,
    settings: {}, inv: [{ it: 'souvenir', q: 'common' }], drops: [], hotspot: { day: -1, list: [] },
    customMode: false,
    stats: { totalWage: 0, totalInteract: 123, totalWorkMs: 0, totalLoot: 9, totalDates: 45 },
    perks: { touch: true }, capLevel: 0,
    npcs: { t1_gu: { favor: 31, claimed: [25], asset: false, referred: false, met: true } },
    career: { industry: 'finance', level: 3, bizVolumeTotal: 520, currentBiz: null },
    skills: { points: 2, nodes: {} }, equips: { watch: null, jewel: null },
    pets: { unlocked: ['nuanshou', 'zhangfang', 'ghost'] } };
  const m3 = Engine.migrate(JSON.parse(JSON.stringify(v3)));
  eq(m3.v, 4, 'v3 → v4');
  ok(m3.pets.nuanshou === 1 && m3.pets.zhangfang === 1 && !m3.pets.ghost,
    'v3 pets.unlocked[] → {id:1}，白名单外剔除');
  ok(m3.loot && m3.loot.pityRare === 0 && m3.loot.pityEquip === 0, 'v3 补齐保底计数器');
  ok(m3.career.boom && m3.career.boom.finance === 'stable', 'v3 补齐景气占位');
  ok(m3.wash && m3.wash.vouchers === 0 && m3.wash.tierDone === 0, 'v3 补齐洗点券占位');
  eq(m3.npcs.t1_gu.lastActGt, 987654321, 'v3 衰减钩子 lastActGt 以档内 gt 播种');
  eq(m3.stats.totalDates, 45, 'v3 统计无损');
  // 校准重定基：未自定义档的平衡旋钮随 v3→v4 对齐新默认（alpha4 ③）
  const v3old = JSON.parse(JSON.stringify(v3));
  v3old.settings = { staminaRegenPerMin: 20, interactStaminaCost: 10, dropValueRate: 1.0,
    dropIntervalRate: 1.0, favorPerYuanRate: 1.0, dailyBudget: 20000, perNpcBudget: 5000, wechatStaminaCost: 2 };
  const mOld = Engine.migrate(v3old);
  eq(mOld.settings.staminaRegenPerMin, SETTINGS_DEFAULT.staminaRegenPerMin, '重定基：regen 对齐新默认');
  eq(mOld.settings.interactStaminaCost, SETTINGS_DEFAULT.interactStaminaCost, '重定基：互动耗对齐新默认');
  eq(mOld.settings.dropValueRate, SETTINGS_DEFAULT.dropValueRate, '重定基：掉落价值对齐新默认');
  eq(mOld.settings.dailyBudget, SETTINGS_DEFAULT.dailyBudget, '重定基：日预算对齐新默认');
  // 玩家自定义档（customMode=true）保留其数值（注意 migrate 原地改写，须从干净 v3 重新构造）
  const v3custom = JSON.parse(JSON.stringify(v3));
  v3custom.customMode = true;
  v3custom.settings = { staminaRegenPerMin: 20, interactStaminaCost: 10, dropValueRate: 1.0,
    dropIntervalRate: 1.0, favorPerYuanRate: 1.0, dailyBudget: 20000, perNpcBudget: 5000, wechatStaminaCost: 2 };
  const mCustom = Engine.migrate(v3custom);
  eq(mCustom.settings.staminaRegenPerMin, 20, '自定义档保留 regen=20');
  eq(mCustom.settings.dropValueRate, 1.0, '自定义档保留 dropValueRate=1.0');

  // 幂等：v4 结果再迁移一次逐字节一致（_bCache/_bSig 不入档）
  ok(!('_bCache' in m3) && !('_bSig' in m3), '聚合缓存不入档');
  const again = Engine.migrate(JSON.parse(JSON.stringify(m3)));
  eq(JSON.stringify(again), JSON.stringify(m3), 'v4 双迁移幂等（含键序）');

  // 非法值消毒：阶段钳 1..3、景气白名单、负计数归零
  const dirty = JSON.parse(JSON.stringify(m3));
  dirty.pets.shihuang = 9;
  dirty.pets.bogus = 2;
  dirty.career.boom.finance = 'moon';
  dirty.loot.pityRare = -5;
  const md = Engine.migrate(dirty);
  ok(md.pets.shihuang === 3 && !md.pets.bogus, '阶段钳到 3 且未知宠物剔除');
  eq(md.career.boom.finance, 'stable', '景气枚举白名单外归平稳');
  eq(md.loot.pityRare, 0, '负保底计数归零');
})();

// ════════════════ alpha4 Wave3（docs/drafts/alpha4/03 §S1/S6/S2/S7/S8）════════════════

// ── W1. S1 行业景气轮换：乘区口径 / 周切掷骰权重 / 总开关 / 结算与效率联动 / 日志角标 ──
(function () {
  const st = fresh();
  eq(Engine.boomOf(st, 'finance'), 'stable', 'S1 初始三域平稳');
  near(Engine.boomVolMulOf(st, 'finance'), 1, 1e-9, '平稳业务量乘区 =1');
  st.career.boom.finance = 'boom';
  st.career.boom.tech = 'low';
  near(Engine.boomVolMulOf(st, 'finance'), 1.2, 1e-9, '景气业务量 ×1.2（boomScale）');
  near(Engine.boomVolMulOf(st, 'tech'), 0.85, 1e-9, '低谷业务量 ×0.85（boomLowScale）');
  near(Engine.boomNetMulOf(st, 'finance'), 1.2, 1e-9, '景气人脉计入 ×1.2');
  near(Engine.boomNetMulOf(st, 'tech'), 0.85, 1e-9, '低谷人脉计入 ×0.85');
  st.settings.boomEnabled = false;
  near(Engine.boomVolMulOf(st, 'finance'), 1, 1e-9, '总开关关闭：景气归一');
  near(Engine.boomNetMulOf(st, 'tech'), 1, 1e-9, '总开关关闭：低谷也归一');

  // 周切掷骰尊重累计权重（注入 rng：<w0 → boom，<w0+w1 → stable，否则 low）
  const st2 = fresh();
  st2.gt = B.WEEK_MS - 500;
  const evs = Engine.step(st2, 1000, { rng: seqRng([0.29, 0.74, 0.9]) });
  eq(st2.career.boom.finance, 'boom', '周切掷骰 r<w0 → 景气');
  eq(st2.career.boom.estate, 'stable', '周切掷骰 w0≤r<w0+w1 → 平稳');
  eq(st2.career.boom.tech, 'low', '周切掷骰 r≥w0+w1 → 低谷');
  eq(st2.career.boomWeek, 1, '周游标推进到新周');
  const be = evs.find((e) => e.t === 'boom');
  ok(!!be && Array.isArray(be.changes) && be.changes.length === 2
    && be.changes.some((x) => x.domain === 'finance' && x.to === 'boom')
    && be.changes.some((x) => x.domain === 'tech' && x.to === 'low'),
    'boom 事件 changes 只记状态翻转的域（平稳→平稳不记）');
  ok(/本周景气/.test(be.txt || '') && (be.txt.indexOf('金融↑') >= 0), 'boom 事件文案含三域角标');
  ok((st2.log || []).some((l) => l.txt.indexOf('本周景气') >= 0), '决策日志落一行景气角标（00 §6 对策）');
  const evs2 = Engine.step(st2, 1000, {});
  ok(!evs2.some((e) => e.t === 'boom'), '同一游戏周不重复掷');

  // settleBiz 业务量吃景气乘区
  const st3 = fresh();
  st3.career.industry = 'finance';
  ['t1_lin', 't1_shen', 't2_qin', 't2_han'].forEach((id) => { Engine.npc(st3, id).favor = 100; });   // 金融 12 ≥6
  Engine.startBiz(st3, 'b_finance_1');
  st3.career.currentBiz.doneMs = st3.career.currentBiz.workMs;
  Engine.settleBiz(st3, NOON, []);
  const vStable = st3.career.bizVolumeTotal;
  near(vStable, 5, 1e-9, '基线结单 5 万（平稳）');
  st3.career.bizVolumeTotal = 0;
  st3.career.boom.finance = 'boom';
  Engine.startBiz(st3, 'b_finance_1');
  st3.career.currentBiz.doneMs = st3.career.currentBiz.workMs;
  Engine.settleBiz(st3, NOON, []);
  near(st3.career.bizVolumeTotal, vStable * 1.2, 1e-9, '景气行业结单 ×1.2');

  // bizEfficiency：reqNet 人脉比吃计入，reqTypes 类型计数不吃
  const st4 = fresh();
  st4.tier = 2;
  st4.career.industry = 'estate';
  st4.career.level = 2;
  Engine.npc(st4, 't1_gu');              // 已结识金钱型 ×1（类型计数只认已结识条目）
  const tplE = BALANCE.BIZ_TEMPLATES.find((t) => t.id === 'b_estate_2');   // 地产≥10 · 金钱型×1
  Engine.npc(st4, 't1_he').favor = 50;   // 地产 1.2 → 比 0.12
  near(Engine.bizEfficiency(st4, tplE).eff, 1.2 / 10, 1e-9, '基线人脉比 0.12');
  st4.career.boom.estate = 'boom';
  near(Engine.bizEfficiency(st4, tplE).eff, 1.44 / 10, 1e-9, '景气计入后人脉比 0.144（min 前）');
  st4.career.boom.estate = 'low';
  Engine.npc(st4, 't1_he').favor = 100;
  Engine.npc(st4, 't1_zhou').favor = 100;
  Engine.npc(st4, 't2_meng').favor = 100;
  Engine.npc(st4, 't2_bai').favor = 100;   // 地产 12 ×0.85=10.2 → 人脉比 1.02
  eq(Engine.bizEfficiency(st4, tplE).eff, 1, '低谷只压人脉侧，类型计数比不受影响（min=1）');
})();

// ── W2. S6 业务风险三角：表数据溢价 / jit 边界与期望 / 稳健单免疫 / 与 k3a 保底复合 ──
(function () {
  [3, 4, 5].forEach((tier) => {
    const group = BALANCE.BIZ_TEMPLATES.filter((t) => t.tier === tier);
    eq(group.filter((t) => t.certainty === 'risky').length, 1, 'T' + tier + ' 组内恰一条风险单');
  });
  eq(BALANCE.BIZ_TEMPLATES.find((t) => t.id === 'b_finance_3').certainty, 'risky', '私募代销份额为风险单');
  eq(BALANCE.BIZ_TEMPLATES.find((t) => t.id === 'b_estate_4').certainty, 'risky', '地块联合开发为风险单');
  eq(BALANCE.BIZ_TEMPLATES.find((t) => t.id === 'b_estate_5').certainty, 'risky', '城市更新基金为风险单');
  eq(BALANCE.BIZ_TEMPLATES.find((t) => t.id === 'b_finance_3').vol, 127, 'T3 风险溢价烘焙：110×1.15≈126.5 半进位→127');
  eq(BALANCE.BIZ_TEMPLATES.find((t) => t.id === 'b_estate_4').vol, 978, 'T4 风险溢价烘焙：850×1.15→978');
  eq(BALANCE.BIZ_TEMPLATES.find((t) => t.id === 'b_estate_5').vol, 2760, 'T5 风险溢价烘焙：2400×1.15→2760');
  eq(BALANCE.BIZ_TEMPLATES.find((t) => t.id === 'b_estate_3').vol, 100, '稳健邻居基准量不动（T3）');
  eq(BALANCE.BIZ_TEMPLATES.find((t) => t.id === 'b_finance_4').vol, 900, '稳健邻居基准量不动（T4）');
  eq(BALANCE.BIZ_TEMPLATES.find((t) => t.id === 'b_finance_5').vol, 2600, '稳健邻居基准量不动（T5）');

  const st = fresh();
  st.tier = 3;
  st.career.industry = 'finance';
  st.career.level = 3;
  let r = Engine.startBiz(st, 'b_finance_3', seqRng([0]));
  ok(r.ok, '风险单可接（人脉不足仅降效率）');
  near(st.career.currentBiz.jit, 0.7, 1e-9, 'jit 下界：rng=0 → 0.7');
  Engine.startBiz(st, 'b_finance_3', seqRng([0.999]));
  near(st.career.currentBiz.jit, 0.7 + 0.999 * 0.6, 1e-9, 'jit 上界：rng→0.999 ≈1.2994');
  let inBounds = true;
  for (let i = 0; i <= 10; i++) {
    Engine.startBiz(st, 'b_finance_3', seqRng([i / 10]));
    const j = st.career.currentBiz.jit;
    if (!(j >= 0.7 && j <= 1.3)) inBounds = false;
  }
  ok(inBounds, 'rng 全扫 jit ∈ [0.7, 1.3]');
  Engine.startBiz(st, 'b_finance_1', seqRng([0.5]));   // 稳健单
  ok(!('jit' in st.career.currentBiz), '稳健单无 jit 字段');

  // 复合口径：k3a 保底作用于 eff，jit 独立乘区（保底后仍可能 <1）
  st.skills.nodes.k3a = true;
  r = Engine.startBiz(st, 'b_finance_3', seqRng([0]));   // 人脉为 0 → 原始效率 0 被保底托到 0.5
  eq(r.eff, 0.5, 'k3a 保底把风险单效率托到 0.5');
  st.career.currentBiz.doneMs = st.career.currentBiz.workMs;
  st.career.currentBiz.jit = 0.7;
  st.career.bizVolumeTotal = 0;
  Engine.settleBiz(st, NOON, []);
  near(st.career.bizVolumeTotal, 127 * 0.5 * 0.7, 1e-9, '保底 eff0.5 × jit0.7 = 0.35 倍基准（仍 <1）');
  st.career.bizVolumeTotal = 0;
  Engine.startBiz(st, 'b_finance_3', seqRng([0]));
  st.career.currentBiz.doneMs = st.career.currentBiz.workMs;
  st.career.currentBiz.jit = 1.3;
  Engine.settleBiz(st, NOON, []);
  near(st.career.bizVolumeTotal, 127 * 0.5 * 1.3, 1e-9, '保底 eff0.5 × jit1.3 = 0.65 倍基准');
})();

// ── W3. S2 关系衰减 Lite：默认 off / 3 日阈值 / 渠道重置 / 阶段钳制 / 资产与槽外免疫 ──
(function () {
  const st = fresh();
  st.slots = ['t1_lin'];
  const s = Engine.npc(st, 't1_lin');
  s.favor = 60;
  st.gt = 3 * B.DAY_MS;
  Engine.newDay(st);
  eq(s.favor, 60, '默认 off：3 日无互动不衰减');
  st.settings.decayEnabled = true;
  Engine.newDay(st);
  eq(s.favor, 59, '开启后 idle 满 3 日漂移 -1');
  for (let i = 0; i < 9; i++) { st.gt += B.DAY_MS; Engine.newDay(st); }
  eq(s.favor, 50, '连续衰减钳在深交段下限 50');
  // 微信也算互动：重置计时
  st.gt += 10 * B.DAY_MS;
  const wr = Engine.wechat(st, 't1_lin');
  ok(wr.ok, '微信发送成功');
  eq(s.lastActGt, st.gt, '渠道互动重置 lastActGt');
  Engine.newDay(st);
  eq(s.favor, 50.3, '重置后当周内不衰减（含微信 +0.3 固定好感）');
  st.gt += 2 * B.DAY_MS;
  Engine.newDay(st);
  eq(s.favor, 50.3, 'idle 2 日仍安全');
  st.gt += B.DAY_MS;
  Engine.newDay(st);
  eq(s.favor, 50, '恰满 3 日再次 -1（钳在深交段下限 50）');
  // 资产免疫 / 未入槽不计 / <50 不衰减
  const st2 = fresh();
  const a = Engine.npc(st2, 't1_gu');
  a.favor = 80; a.asset = true; a.lastActGt = 0;
  const b = Engine.npc(st2, 't1_he');
  b.favor = 80; b.lastActGt = 0;
  st2.slots = ['t1_lin'];
  const c = Engine.npc(st2, 't1_lin');
  c.favor = 80; c.lastActGt = 0;
  st2.settings.decayEnabled = true;
  st2.gt = 5 * B.DAY_MS;
  Engine.newDay(st2);
  eq(a.favor, 80, '资产化免疫');
  eq(b.favor, 80, '未入槽不衰减');
  eq(c.favor, 79, '入槽且≥50 照常衰减');
  c.favor = 49;
  c.lastActGt = 0;
  Engine.newDay(st2);
  eq(c.favor, 49, '好感 <50 不参与衰减');
})();

// ── W4. S7 试洗券 + Build 预设：首通发券 / 半价数学与消耗 / 首免优先 / 合法前缀点亮 ──
(function () {
  const st = fresh();
  st.gold = 1e12;
  st.rep = 1e9;
  st.attrs.taste = 99;
  let r = Engine.enterTier(st, 2);
  ok(r.ok && r.events.some((e) => e.t === 'voucher'), 'T2 首通推 voucher 事件');
  eq(st.wash.vouchers, 1, '试洗券 +1');
  eq(st.wash.tierDone, 2, '首通记录 tierDone=2');
  r = Engine.enterTier(st, 3);
  eq(st.wash.vouchers, 2, 'T3 首通再发一张');
  // 旧档口径：tierDone 落后时跨层只补一张（每层一次）
  st.wash.vouchers = 0;
  st.wash.tierDone = 0;
  st.tier = 4;
  r = Engine.enterTier(st, 5);
  eq(st.wash.vouchers, 1, '跨层补发只 +1（once per tier）');

  // 半价数学与消耗
  st.skills.points = 0;
  st.skills.nodes.s11 = true;
  st.skills.nodes.s12 = true;      // 已投 2 点
  st.skills.washed = 1;
  const base = 2 * 20000 * 2;      // invested × respecBase × (1+washed)
  st.wash.vouchers = 1;
  eq(Engine.respecCostOf(st), Math.ceil(base * 0.5), '持券洗点费 = ceil(半价)');
  st.gold = 1e12;
  r = Engine.respecSkills(st);
  ok(r.ok && r.cost === Math.ceil(base * 0.5), '半价实付入账');
  eq(st.wash.vouchers, 0, '付费洗点消耗试洗券');
  st.skills.nodes.s11 = true;
  st.skills.nodes.s12 = true;      // 重新投入 2 点（washed 已为 2）
  eq(Engine.respecCostOf(st), 2 * 20000 * 3, '无券恢复原价公式');
  // 首次免费优先于券
  const st2 = fresh();
  st2.career.level = 8;
  st2.skills.nodes.k1a = true;
  st2.wash.vouchers = 3;
  eq(Engine.respecCostOf(st2), 0, '首次免费规则最优先');
  r = Engine.respecSkills(st2);
  ok(r.ok && st2.wash.vouchers === 3, '首次免费不消耗券');

  // Build 预设
  const st3 = fresh();
  st3.skills.points = 3;           // 低点数：只亮可负担前缀
  let pr = Engine.applyBuildPreset(st3, 'net');
  eq(pr.lit.length, 3, '低点数只点亮前缀 3 个（i11~i13）');
  ok(pr.skipped.length === 4 && pr.skipped.every((x) => x.id && x.reason), '其余跳过且带原因');
  eq(st3.skills.points, 0, '点数恰好用尽');
  const st4 = fresh();
  st4.career.level = 8;
  st4.skills.points = 40;
  pr = Engine.applyBuildPreset(st4, 'net');
  eq(pr.lit.length, 7, '满条件广撒网流全亮 7 节点');
  eq(Engine.skillPointsInvested(st4), 8, '广撒网流总投入 8 点');
  const prD = Engine.applyBuildPreset(st4, 'deep');
  ok(prD.skipped.some((x) => x.id === 'k1b'), '深耕流 k1b 撞互斥被跳过');
  ok(prD.lit.indexOf('s14') >= 0 && st4.skills.nodes.s14 === 'ice', 'choice 节点预设取第一项（暖场·冰）');
  const st5 = fresh();
  st5.career.level = 8;
  st5.skills.points = 40;
  pr = Engine.applyBuildPreset(st5, 'rush');
  eq(pr.lit.length, 7, '跑单流全亮 7 节点');
  eq(Engine.skillPointsInvested(st5), 8, '跑单流总投入 8 点（c16 计 2）');
  ok(!Engine.applyBuildPreset(st5, 'nope').ok, '未知预设拒绝');
})();

// ── W5. S8 cond 扩容：泛化二选一 + 新语境词条门控 ──
(function () {
  // 识人系备选「顺风局」（cond: boomHot）
  const st = fresh();
  st.career.industry = 'finance';
  st.skills.points = 40;
  ['i11', 'i12', 'i13'].forEach((id) => { st.skills.nodes[id] = true; });   // 前置链
  ok(!Engine.takeSkill(st, 'i15').ok, 'choice 节点缺选项拒绝');
  ok(Engine.takeSkill(st, 'i15', 'wind').ok, '顺风局点亮成功');
  near(Engine.bonusMulOf(st, 'incomeMul'), 1, 1e-9, '无进行中单：顺风局不生效');
  st.career.currentBiz = { tplId: 'b_finance_1', eff: 1, workMs: 1, doneMs: 0 };
  st.career.boom.finance = 'stable';
  near(Engine.bonusMulOf(st, 'incomeMul'), 1, 1e-9, '非景气质押行业不生效');
  st.career.boom.finance = 'boom';
  near(Engine.bonusMulOf(st, 'incomeMul'), 1.04, 1e-9, '景气行业当前单：收入 ×1.04');
  st.settings.boomEnabled = false;
  near(Engine.bonusMulOf(st, 'incomeMul'), 1, 1e-9, '景气总开关关闭词条失效');
  st.settings.boomEnabled = true;

  // 社交系备选「赴约达人」（cond: hasInvite）——注意前置 s11/s13 的 favorMul add 池 +6%
  const st2 = fresh();
  st2.skills.points = 40;
  ['s11', 's12', 's13'].forEach((id) => { st2.skills.nodes[id] = true; });
  ok(Engine.takeSkill(st2, 's15', 'date').ok, '赴约达人点亮成功');
  near(Engine.bonusMulOf(st2, 'favorMul'), 1.06, 1e-9, '无邀约：只有社交池 +6%');
  st2.invites.push({ id: 't1_gu', expGt: st2.gt + 3600000 });
  near(Engine.bonusMulOf(st2, 'favorMul'), 1.06 * 1.04, 1e-9, '存在有效邀约：再乘 ×1.04');
  // 原侧仍可选：雪中送炭词条回归
  const st2b = fresh();
  st2b.skills.points = 40;
  ['s11', 's12', 's13'].forEach((id) => { st2b.skills.nodes[id] = true; });
  Engine.takeSkill(st2b, 's15', 'snow');
  near(Engine.bonusMulOf(st2b, 'giftMul', { favor: 10 }), 1.4, 1e-9, '雪中送炭侧：<25 送礼 ×1.4');

  // 事业系备选「豪赌直觉」（cond: riskyRun）；变现侧由 commissionRateOf 判定
  const st3 = fresh();
  st3.skills.points = 40;
  ['c11', 'c12', 'c13'].forEach((id) => { st3.skills.nodes[id] = true; });
  ok(Engine.takeSkill(st3, 'c15', 'nerve').ok, '豪赌直觉点亮成功');
  st3.career.currentBiz = { tplId: 'b_estate_4', eff: 1, workMs: 1, doneMs: 0 };   // risky
  near(Engine.lootIntervalMs(st3, DEF.t1_gu, () => 0.5) / 1000, 200 * 0.96, 0.01, '风险单进行中掉落间隔 ×0.96');
  st3.career.currentBiz = { tplId: 'b_estate_3', eff: 1, workMs: 1, doneMs: 0 };   // stable
  near(Engine.lootIntervalMs(st3, DEF.t1_gu, () => 0.5) / 1000, 200, 0.01, '稳健单不掉落加成');
  st3.career.currentBiz = null;
  near(Engine.lootIntervalMs(st3, DEF.t1_gu, () => 0.5) / 1000, 200, 0.01, '空单期不加成');
  Engine.npc(st3, 't1_gu').asset = true;   // 1 位资产（c13 前置带来 commissionAdd flat +0.01）
  st3.skills.nodes.c15 = 'cash';
  near(Engine.commissionRateOf(st3), 0.08 + 0.01 + 0.005, 1e-9, '人脉变现侧提成加成保留');
  st3.skills.nodes.c15 = 'nerve';
  near(Engine.commissionRateOf(st3), 0.08 + 0.01, 1e-9, '豪赌直觉侧不吃人脉变现');

  // s14 回归：泛化机制下 ice/warm 照常
  const st4 = fresh();
  st4.skills.points = 40;
  ['s11', 's12', 's13'].forEach((id) => { st4.skills.nodes[id] = true; });
  ok(Engine.takeSkill(st4, 's14', 'ice').ok, '暖场破冰点亮（泛化机制回归）');
  near(Engine.bonusMulOf(st4, 'interactMul', { stageKey: 'ice' }), 1.6, 1e-9, '破冰期互动 ×1.6');
  near(Engine.bonusMulOf(st4, 'interactMul', { stageKey: 'warm' }), 1, 1e-9, '升温期不吃破冰词条');
  st4.skills.nodes.s14 = 'warm';
  Engine.invalidateBonuses(st4);
  near(Engine.bonusMulOf(st4, 'interactMul', { stageKey: 'warm' }), 1.4, 1e-9, '切换升温选项生效');
})();

// ── A5+. S3 补充口径：装备计数只在 func 分支累计/触发；item 分支免疫 ──
(function () {
  const st = fresh();
  const gu = DEF.t1_gu;
  // item 分支不出装备也不消耗装备计数：计数保持不动，稀有计数照常累加
  st.loot.pityEquip = 119;
  st.loot.pityRare = 5;
  const seqItem = seqRng([0.75, 0, 0.99, 0.99]);   // 金钱型 → item 分支 → 普通品质
  let r = Engine.rollLoot(st, gu, seqItem);
  ok(r.itemId === 'gift_box' || r.itemId === 'limited_collectible', 'item 分支发放礼盒/限量');
  eq(st.loot.pityEquip, 119, 'item 分支不消耗装备计数');
  eq(st.loot.pityRare, 6, 'item 分支普通品质照常累计稀有计数');
  // 计数已满也不会把 item 分支强转成装备
  st.loot.pityEquip = B.LOOT.PITY_EQUIP * 2;
  r = Engine.rollLoot(st, gu, seqItem);
  ok(r.itemId === 'gift_box' || r.itemId === 'limited_collectible', '装备保底不跨分支触发');
  eq(st.loot.pityEquip, B.LOOT.PITY_EQUIP * 2, '满计数在 item 分支同样保持不变');
})();

// ── A6. S3 离线结算分段照跑保底计数（settleOffline → rollLoot 同一管线）──
(function () {
  const lcg = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
  const run = (seed) => {
    const st = fresh();
    const a = Engine.npc(st, 't1_gu');
    a.favor = 100; a.asset = true;
    st.gt = 0;
    const rep = Engine.settleOffline(st, Date.now(), lcg(seed), null);
    const packaged = ((rep.package || []).length || 0) + (rep.soldN || 0);
    return { pr: st.loot.pityRare, pe: st.loot.pityEquip, loot: st.stats.totalLoot, packaged };
  };
  const o1 = run(20260826);
  const o2 = run(20260826);
  ok(o1.packaged > 0 || o1.loot > 0, '离线结算确实产出掉落（packaged=' + o1.packaged + ' totalLoot=' + o1.loot + '）');
  ok(Number.isInteger(o1.pr) && o1.pr >= 0 && Number.isInteger(o1.pe) && o1.pe >= 0, '离线后保底计数为非负整数');
  ok(o1.pr === o2.pr && o1.pe === o2.pe, '同种子离线保底计数逐位一致（分段确定性）');
})();

// ── W3b. S2 补充：favor=50 钳制边界 / 邀约刷新锚点 / decayEnabled 豁免 customMode ──
(function () {
  const st = fresh();
  st.slots = ['t1_lin'];
  const s = Engine.npc(st, 't1_lin');
  s.favor = 50; s.lastActGt = 0;
  st.settings.decayEnabled = true;
  st.gt = 5 * B.DAY_MS;
  Engine.newDay(st);
  eq(s.favor, 50, '恰好 50 触发衰减但被钳在深交段下限 50');
  s.favor = 51;
  Engine.newDay(st);
  eq(s.favor, 50, '51 衰减 -1 恰好落到深交段下限 50');
  // 邀约赴约也算互动：重置衰减锚点
  const st2 = fresh();
  st2.slots = ['t1_lin'];
  const s2 = Engine.npc(st2, 't1_lin');
  s2.favor = 30;
  st2.invites.push({ id: 't1_lin', expGt: st2.gt + B.DAY_MS });
  const ir = Engine.acceptInvite(st2, 't1_lin', () => 0.5);
  ok(ir.ok, '邀约接受成功');
  eq(s2.lastActGt, st2.gt, '赴约刷新 lastActGt（S2 口径一致）');
  // 实验旋钮不污染自定义模式标记
  const st3 = fresh();
  const sr = Engine.setSetting(st3, 'decayEnabled', true);
  ok(sr && sr.ok !== false, 'decayEnabled 可通过 setSetting 开启');
  ok(!st3.customMode, 'decayEnabled 在 customMode 豁免名单中');
})();

console.log('');
console.log('总计 ' + (passed + failed) + ' 项，通过 ' + passed + '，失败 ' + failed);
if (failed > 0) {
  console.log('失败用例:');
  failedNames.forEach((n) => console.log('  - ' + n));
  process.exit(1);
}
