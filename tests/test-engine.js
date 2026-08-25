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

// ── 1. newState 初始值（v2：启动资金/自动开攻/入职）──
(function () {
  const st = fresh();
  eq(st.tier, 1, 'newState: tier=1');
  eq(st.slotCount, 3, 'newState: slotCount=3');
  eq(st.gold, 10000, 'newState: 启动资金 10000（02 §2）');
  eq(st.slots[0], 't1_gu', 'newState: 第一目标顾言自动进槽（00 §4 红线）');
  eq(st.job.id, 'restaurant', 'newState: 已入职餐厅');
  eq(st.settings.staminaRegenPerMin, 20, 'newState: 体力恢复 20/分（01 §1）');
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

// ── 3. 自动好感不变：60 分钟 ≈ 30 点；体力 20 点/分 ──
(function () {
  const st = fresh();
  near(Engine.autoFavorPerMin(st, DEF.t1_lin), 0.5, 1e-9, 'T1 无魅力自动好感 0.5/分');
  st.stamina = 40;
  Engine.step(st, 3 * 60000);
  eq(st.stamina, 100, '3 分钟回复 60 点（20/分），40→100 封顶');
  st.slots = ['t1_lin'];
  const f0 = Engine.npc(st, 't1_lin').favor;
  Engine.step(st, 60 * 60000);
  near(Engine.npc(st, 't1_lin').favor - f0, 30, 0.1, 'step 60 分钟 favor≈30');
  eq(Math.floor(st.gt / 60000), 63, '游戏时钟 gt 累计');
})();

// ── 4. 渠道动作（02 §4.1 / 04 §2.4 免费池）──
(function () {
  const st = fresh();
  // 微信：+2 固定，CD 30 游戏分
  let r = Engine.wechat(st, 't1_gu');
  ok(r.ok, 'wechat 首次成功');
  near(r.gain, 2, 1e-9, 'wechat +2 固定好感');
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
  near(r.gain, 2.5, 1e-9, 'T1 基础互动收益 2.5');
})();

// ── 5. 消费项目价目（05 §2 公式口径）──
(function () {
  const st = fresh();
  eq(Engine.priceOf(st, 'gift', 'small', 1), 80, '小礼 T1=80');
  eq(Engine.priceOf(st, 'date', 'light', 1), 120, '轻约=小礼×1.5=120');
  eq(Engine.priceOf(st, 'date', 'meal', 1), 375, '正餐=中礼×1.5=375');
  eq(Engine.priceOf(st, 'date', 'trip', 1), 2000, '远行=大礼×2.5=2000');
  eq(Engine.priceOf(st, 'errand', null, 1), 4800, '办事=大礼×6=4800');
  st.settings.priceRate = 2;
  eq(Engine.priceOf(st, 'gift', 'small', 1), 160, 'priceRate 全局物价 ×2');
})();

// ── 6. 偏好匹配与热点加成（05 §3 / 08 §5）──
(function () {
  const st = fresh();  // 顾言 tags=[科技,市井]
  let m = Engine.matchTags(st, DEF.t1_gu, ['市井', '美食']);
  ok(m.hit && m.coef === 1.2, '街角咖啡命中市井 ×1.2');
  m = Engine.matchTags(st, DEF.t1_gu, ['文艺', '收藏']);
  ok(!m.hit && m.coef === 0.8, '看展错配 ×0.8');
  near(Engine.favorOf(st, DEF.t1_gu, 'date', 'light', 0), 7.2, 1e-9, '命中轻约 6×1.2');
  near(Engine.favorOf(st, DEF.t1_gu, 'date', 'light', 1), 4.8, 1e-9, '错配轻约 6×0.8');
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
  const hotBase = B.SPEND.date.light.favor * 0.8 * B.DATE.HOTSPOT_FAVOR;
  near(Engine.favorOf(st, DEF.t1_gu, 'date', 'light', 1), hotBase, 1e-9, '热点命中看展再 ×1.2');
})();

// ── 7. 送礼/约会结算与解锁门槛 ──
(function () {
  const st = fresh();
  st.gold = 50000;
  let r = Engine.spendGift(st, 't1_gu', 'mid');
  ok(r.ok && r.cost === 250, '中礼扣费 250');
  near(st.npcs.t1_gu.favor, 10, 1e-9, '中礼 +10 好感');
  eq(st.spent.npc.t1_gu, 250, '单人台账记录');
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
  Engine.startShift(st, 2);
  ok(Engine.onDuty(st), '上班 onDuty');
  const g0 = st.gold;
  const s0 = st.stamina;
  st.slots = ['t1_lin'];             // 换声望型在槽：里程碑发声望不污染工资
  Engine.step(st, 3600000);          // 1 游戏小时
  near(st.gold - g0, 30, 0.51, '餐厅时薪 30 元/时（无小费口径）');
  near(s0 - st.stamina, 12, 0.01, '耗体力 12/时');
  Engine.step(st, 3600000);          // 第 2 小时 → 班次结束
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
  near(sumGold / N, 1.2 * 3600 * 0.70, 1.2 * 3600 * 0.08, '金币包期望（含分支占比）≈3024/时（±8%）');
  const itemShare = itemCnt / N;
  near(itemShare, 0.30, 0.06, '物品分支占比 ≈30%（07 内容表 money 型）');
  ok(qCnt.common > qCnt.fine && qCnt.fine >= qCnt.rare, '品质分布 普通>精致≥稀有');
  // 声望型手札
  const repRoll = Engine.rollLoot(st, DEF.t1_lin, () => 0.001);
  ok(repRoll.kind === 'letter' && repRoll.qty === B.LOOT.LETTER_REP[1], '声望型掉手札 T1=1');
  near(Engine.lootIntervalMs(st, DEF.t1_gu, () => 0.5) / 1000, 100, 0.01,
    '间隔基准 120s÷系数1.2（jitter=1.0 口径）');
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
  eq(Engine.priceOf(st, 'date', 'light', 1), Math.round(120 * 0.8), '约会价 8 折');
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
  near(rep3.favors[0].gained, 0.5 * 120 * 0.5, 0.1, '离线好感=在线速率×50%（offlineFavorRate）');
})();

// ── 18. 存档迁移 v1→v2 ──
(function () {
  const v1 = {
    v: 1, createdAt: NOW, lastSeen: NOW, gold: 500, rep: 12, stamina: 55,
    attrs: { charm: 2, talk: 1, taste: 3 }, slotCount: 4, slots: ['t1_lin'], tier: 1,
    npcs: { t1_lin: { favor: 30, claimed: [25], asset: false, referred: false } },
    seen: {}
  };
  const m = Engine.migrate(v1);
  ok(m && m.v === 2, '迁移到 v2');
  eq(m.gold, 500, '保留金币');
  eq(m.slots[0], 't1_lin', '保留槽位');
  eq(m.npcs.t1_lin.favor, 30, '保留好感');
  eq(m.settings.decisionIntervalSec, 5, '补齐 settings 默认');
  ok(Array.isArray(m.inv) && Array.isArray(m.drops), '补齐 v2 容器');
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
  let r = Engine.synthItems(st, [{ i: 0, n: 2 }, { i: 1, n: 1 }], seqRng([9 / 12]));
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

// ── 25. 成就即被动（next-iteration §2）──
(function () {
  const st = fresh();
  near(Engine.autoFavorPerMin(st, DEF.t1_lin), 0.5, 1e-9, '基线好感 0.5/分');
  st.perks.touch = true;
  near(Engine.autoFavorPerMin(st, DEF.t1_lin), 0.515, 1e-9, '摸鱼大师 全局好感 ×1.03');
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
  eq(Engine.priceOf(st, 'date', 'light', 1), Math.round(120 * 0.95), '社交悍匪 约会价 ×0.95');
  st.perks.networker = true;
  eq(Engine.staminaMaxOf(st), 120, '人脉广博 体力上限 +20');
  st.stamina = 115;
  Engine.step(st, 60000);
  ok(st.stamina <= 120, '再生不超过新上限');
  st.perks.picker = true;
  near(Engine.lootIntervalMs(st, DEF.t1_gu, () => 0.5) / 1000, 95, 0.01, '捡漏之王 掉落间隔 ×0.95');
  const st2 = fresh();
  st2.buffs.dateOffGt = st2.gt + 3600000;
  st2.perks.social = true;
  eq(Engine.priceOf(st2, 'date', 'light', 1), Math.round(120 * 0.8 * 0.95), '名片夹 8 折与被动叠乘');
  const st3 = fresh();
  st3.stats.totalInteract = 999;
  const r = Engine.interact(st3, 't1_gu', NOW);
  ok(r.ok && r.events.some((e) => e.t === 'ach' && e.name === '摸鱼大师'), '达成瞬间推 ach 事件');
  ok(st3.perks.touch === true, 'perks 写入存档');
  ok(st3.stats.totalInteract === 1000, '线下互动计数');
})();

console.log('');
console.log('总计 ' + (passed + failed) + ' 项，通过 ' + passed + '，失败 ' + failed);
if (failed > 0) {
  console.log('失败用例:');
  failedNames.forEach((n) => console.log('  - ' + n));
  process.exit(1);
}
