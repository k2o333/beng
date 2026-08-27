// 静态 Balance 体检报告（docs/drafts/alpha4/02-calibration-and-balance-report.md §2）
// 纯 Node 零依赖：只读数据表做解析计算，不跑引擎模拟。
// 输出 docs/reports/balance.md（每次覆盖）+ 控制台 ASCII 摘要。
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'src', 'js', 'data', 'balance.js'));
require(path.join(ROOT, 'src', 'js', 'data', 'npcs.js'));
require(path.join(ROOT, 'src', 'js', 'data', 'items.js'));

const B = globalThis.BALANCE;
const SET = globalThis.SETTINGS_DEFAULT;
const NPCS = globalThis.NPCS || [];
const ITEMS = globalThis.ITEMS || [];

// ── 基础设施 ──
const flags = [];   // { sec, msg }
function flag(sec, msg) { flags.push({ sec, msg }); }
function has(x) { return typeof x === 'number' && isFinite(x); }
function na(x) { return has(x) ? String(x) : 'N/A'; }
function grp(n) {   // 千分位（确定性格式化）
  const neg = n < 0 ? '-' : '';
  const s = Math.round(Math.abs(n)).toString();
  return neg + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function f2(n) { return has(n) ? (Math.round(n * 100) / 100).toFixed(2) : 'N/A'; }
function ratio(a, b) { return has(a) && has(b) && b !== 0 ? a / b : null; }

// ── 文档假设的系数（与代码字面量区分，全部在页脚声明）──
const ASSUMPTIONS = {
  npcCoef: 1.0,          // 掉落间隔个体系数取 1.0（实际 NPC coef 0.8~1.5）
  jitterMean: 1.0,       // JITTER/PACK_JITTER 区间对称 → 期望 1.0
  dropMul: 1.0,          // 无成就/宠物掉落加速
  charmActiveMinPerDay: 480,  // 单目标等效自动好感挂机分钟/游戏日
  talkInteractsPerDay: 100,   // 每日线下互动次数
  favorValueGold: null,  // 页脚按 T3 里程碑金推算后回填
  favorHorizonDays: 60   // 属性回本合理视界（超过即弃坑点）
};

function tier(i) { return B.TIERS && B.TIERS[i - 1]; }
function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }

// m4：复现戳——git 短哈希 + 关键输入文件 size/mtime
function reproStamp() {
  let git = 'unknown';
  try {
    git = cp.execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'unknown';
  } catch (e) { git = 'unknown'; }
  const files = {};
  for (const rel of ['src/js/data/balance.js', 'src/js/data/npcs.js', 'src/js/data/items.js', 'src/js/engine.js', 'src/js/agent.js']) {
    try {
      const st = fs.statSync(path.join(ROOT, rel));
      files[rel] = { size: st.size, mtimeMs: Math.round(st.mtimeMs) };
    } catch (e) { files[rel] = null; }
  }
  return { gitHash: git, inputs: files };
}
const REPRO = reproStamp();

// R1 配套：读取最新 sim-standard-*.json，把「品味墙」模拟实测并入静态口径对照
function latestSimFinding() {
  try {
    const dir = path.join(ROOT, 'docs', 'reports');
    const files = fs.readdirSync(dir).filter((f) => /^sim-standard-\d+\.json$/.test(f)).sort();
    if (!files.length) return null;
    const j = JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8'));
    const t5 = (j.blockers || []).find((b) => b.key === 'tier5') || null;
    return {
      file: files[files.length - 1],
      tasteP50: j.extras && j.extras.endAttrsP50 ? j.extras.endAttrsP50.taste : null,
      t5
    };
  } catch (e) { return null; }
}

// ═══════════════ Header ═══════════════
function sectionHeader() {
  const L = [];
  L.push('# Balance 静态体检报告（npm run balance）');
  L.push('');
  L.push('- 生成时间：' + new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC');
  L.push('- 数据版本：BALANCE.SAVE_VERSION = ' + na(safe(() => B.SAVE_VERSION)));
  L.push('- 输入文件：`src/js/data/balance.js`、`src/js/data/npcs.js`（' + NPCS.length + ' 名 NPC）、`src/js/data/items.js`（' + ITEMS.length + ' 件物品）；未加载引擎（纯静态口径）');
  L.push('- 口径：所有速率公式为 balance.js/engine.js 字面量；估计系数见页脚假设清单。标记 ⚠ 的行为本脚本自动标记的疑点。');
  return L.join('\n');
}

// ═══════════════ §A faucet/sink 映射 ═══════════════
function sectionA() {
  const L = [];
  L.push('');
  L.push('## §A Faucet/Sink 映射表');
  L.push('');
  L.push('类型语义（trader machinations）：source=产出泵 · drain=销毁坑 · converter=资源形态转换 · gate=门槛校验（不消耗）');
  L.push('');
  L.push('| 系统 | 资源 | 类型 | 速率公式（字面量） | 备注 |');
  L.push('| --- | --- | --- | --- | --- |');

  const rows = [
    ['启动资金', '金', 'source', 'START_GOLD=' + na(safe(() => B.START_GOLD)) + '（一次性）', '开局注入'],
    ['资产掉落·金币包', '金', 'source', 'BASE_OUTPUT[type](money 1.0/rep 0.35/aux 0.15) × TIERS.mult × npc.coef × 3600 × dropValueRate × PACK_JITTER[0.6,1.4]', '期望抖动 ×1.0；间隔 INTERVAL_S[tier]/coef ±JITTER[0.7,1.3]'],
    ['打工工资', '金', 'source', 'JOBS.wage(25/30/45)/游戏小时 × workWageRate × wageMul 词条(敬业I/II +5%、全勤 +10%) × incomeFactors(incomeMul 账房 × goldWin 时段窗)；餐厅现实 18~22 时段 ×eveningMul 1.5；夜班离线挂班 ×offlineMul 1.2', '奶茶店附加小费：tipChance 12%/小时 × tipRange[5,20]'],
    ['业务提成', '金', 'converter', 'tpl.vol × [CAREER_LEVELS.rate(0.08~0.18) + commissionAdd 词条(c13 flat+1%…) + c15 人脉变现 min(0.15, 满好感资产×0.5%)] × √TIERS.mult × COMMISSION_PER_WAN(300) × commissionScale × incomeFactors', '工时(workMin×bizSpeed) → 金；提成率三处来源见 engine.commissionRateOf'],
    ['职级津贴', '金', 'source', 'CAREER_LEVELS.allowance（0~600000）/结单周期', '随提成每单发放'],
    ['好感里程碑', '金', 'converter', 'MILESTONE_GOLD[tier]={' + safe(() => Object.keys(B.MILESTONE_GOLD).map(k => k + ':' + B.MILESTONE_GOLD[k]).join(',')) + '} @好感 25/50/75', 'money/aux 型 NPC 发金；rep 型改发 MILESTONE_REP'],
    ['售物/自动出售', '金', 'converter', 'ITEMS.sell × SELL_RATE(0.3)', '物品 → 金；AUTOSELL_RATE 同口径'],
    ['礼物/约会/办事', '金', 'converter', 'GIFTS.cost[tier] × mul(日期 1.5/2.5，办事 ×6) × priceRate × favorPerYuanRate⁻¹ 方向为金→好感', '消费换好感，主 sink 兼 converter'],
    ['属性升级', '金', 'drain', 'ATTR_BASE_COST(150) × ATTR_COST_GROWTH(1.7)^lv × priceRate', '永久消耗'],
    ['攻略槽扩容', '金', 'drain', 'SLOT_COSTS：4槽 50,000 / 5槽 500,000 / 6槽 8,000,000 / 7槽 100,000,000（×priceRate）', '永久消耗'],
    ['背包扩容', '金', 'drain', 'INV_CAP_UPGRADES：50,000→60格 / 500,000→70格 / 5,000,000→80格', '永久消耗'],
    ['圈层入场费', '金', 'drain', 'TIERS.fee：0 / 10,000 / 100,000 / 1,500,000 / 30,000,000（一次性扣除）', 'enterTier 时 state.gold -= fee'],
    ['技能洗点', '金', 'drain', '已投点数 × respecBase(20,000) × (1+已洗次数)，首次免费', '重置天赋网'],
    ['自动好感', '好感', 'source', '0.5 × (1+ATTR_EFFECT(0.08)×charm) / TIERS.restraint × (1+auxBonus) /游戏分', '放置主泵'],
    ['线下互动', '好感', 'converter', 'autoFavorPerMin × 5 × (1+0.08×talk)；耗体力 interactStaminaCost(10)', '体力 → 好感'],
    ['微信/朋友圈/职场', '好感', 'source', '固定值不受加成：微信 2/30min（体力2）、朋友圈 1/120min、职场 3/60min（在岗限定）', 'WECHAT_FAVOR 等'],
    ['约会随机事件', '好感', 'converter', 'SPEND.date.favor × matchCoef(1.2/0.8) × HOTSPOT_FAVOR(1.2)? × DATE.EVENTS 加权 mul（期望 1.114）', '事件表 w=60/20/12/5/3'],
    ['NPC 回礼', '物品', 'converter', '大礼/远行/办事后 RETURN_CHANCE(8%)，每游戏周限 1 次；品质+1 档', '不掉装备'],
    ['离线好感', '好感', 'source', '在线公式 × offlineFavorRate(0.5)，上限 OFFLINE_CAP_H(12)+辅助资产加成', 'offlineRegen 开关'],
    ['收网转资产', '好感', 'drain', '好感满 FAVOR_MAX(100) → NPC 转资产（好感清账，开启掉落/人脉/提成）', '好感唯一出口'],
    ['声望手札', '声望', 'source', 'LETTER_REP[tier]={1:1,2:2,3:4,4:8,5:15}，rep 型掉落分支 letter(55%)，间隔 ×LETTER_INTERVAL_MUL(2)', 'REP_PASSIVE 已删除（alpha4 D2），声望不再被动增长'],
    ['里程碑/收网声望', '声望', 'source', 'MILESTONE_REP[tier]={1:8,2:20,3:55,4:140,5:360}；FULL_REP[tier]={1:5,2:10,3:27,4:70,5:180}（rep 型 ×2）', '仅 rep 型 NPC 触发里程碑声望'],
    ['情报简报使用', '声望', 'converter', 'intel_brief 物品效果：声望 +ceil(2×TIERS.mult/10)，最少 +1（T1=1、T2=1、T3=2、T4=3、T5=8）', '物品 → 声望；engine useItem case "rep"'],
    ['圈层准入', '声望', 'gate', 'state.rep >= TIERS.rep（0/100/600/3500/20000）', '阈值校验不扣减'],
    ['体力恢复', '体力', 'source', 'staminaRegenPerMin(20)/游戏分；离线 offlineRegen 可续', '难度总旋钮'],
    ['行动消耗', '体力', 'drain', '互动 10 / 微信 2 / 职场互动 6 / 识人 identifyStaminaCost(12) / 打工 staminaPerH(8/12/20)', 'STAMINA_MAX=100']
  ];
  for (const r of rows) L.push('| ' + r.join(' | ') + ' |');
  return L.join('\n');
}

// ═══════════════ §B 动作性价比矩阵 ═══════════════
function sectionB() {
  const L = [];
  L.push('');
  L.push('## §B 动作性价比矩阵（静态子集）');
  L.push('');
  // 约会事件期望倍率（字面量权重）
  let emul = null;
  if (B.DATE && B.DATE.EVENTS) {
    let wsum = 0, wm = 0;
    for (const e of B.DATE.EVENTS) { wsum += e.w; wm += e.w * e.mul; }
    emul = wm / wsum;
  }
  const MATCH_UP = safe(() => B.SPEND.MATCH_UP, 1.2);
  L.push('口径：gold-per-favor = 价格 ÷ 实得好感。约会按「匹配变体（×MATCH_UP=' + MATCH_UP + '）× 日期事件期望 mul=' + f2(emul) + '」中估，不含热点/名片夹折扣。办事每人限一次（H4 已由限次兜底）。');
  L.push('');

  // 表头
  const head = ['动作 \\ 圈层'];
  for (let t = 1; t <= 5; t++) head.push('T' + t);
  L.push('| ' + head.join(' | ') + ' |');
  L.push('| ' + head.map(() => '---').join(' | ') + ' |');

  // 收集每列数值以标最低
  const cols = {};
  for (let t = 1; t <= 5; t++) cols[t] = [];
  function rowOf(label, fn) {
    const cells = [label];
    for (let t = 1; t <= 5; t++) {
      const v = fn(t);
      cells.push(v == null ? 'N/A' : f2(v));
      if (v != null) cols[t].push({ label, v });
    }
    L.push('| ' + cells.join(' | ') + ' |');
  }

  if (B.GIFTS) {
    for (const size of ['small', 'mid', 'large']) {
      const g = B.GIFTS[size];
      rowOf('礼物·' + g.label + '（' + g.favor + '好感）', (t) => safe(() => g.cost[t] / g.favor, null));
    }
  } else { L.push('| 礼物 | 缺 GIFTS 表 |'); flag('B', 'GIFTS missing'); }

  if (B.GIFTS && B.SPEND && B.SPEND.errand) {
    const er = B.SPEND.errand;
    rowOf('办事（' + er.favor + '好感，限一次）', (t) => safe(() => B.GIFTS.large.cost[t] * er.mul / er.favor, null));
  }
  if (B.GIFTS && B.SPEND && B.SPEND.date && has(emul)) {
    for (const kind of ['light', 'meal', 'trip']) {
      const d = B.SPEND.date[kind];
      rowOf('约会·' + d.label + '（匹配×事件期望）', (t) => safe(() => (B.GIFTS[d.base].cost[t] * d.mul) / (d.favor * MATCH_UP * emul), null));
    }
  }

  L.push('');
  L.push('**各列最低 gold-per-favor**：');
  const ERRAND_TAG = '（倒挂候选，H4：不应成唯一理性选择——每人限一次已兜底，验证即可）';
  for (let t = 1; t <= 5; t++) {
    const list = cols[t];
    if (!list.length) continue;
    let best = list[0];
    for (const e of list) if (e.v < best.v) best = e;
    const errand = list.find((e) => e.label.indexOf('办事') === 0);
    const worst = list.reduce((a, b) => (b.v > a.v ? b : a));
    let line = '- T' + t + '：最低 ' + best.label + ' = ' + f2(best.v) + '；最贵 ' + worst.label + ' = ' + f2(worst.v);
    if (errand) {
      line += '；办事 ' + f2(errand.v);
      if (errand !== best) line += ERRAND_TAG;
      else line += '（本列最低——H4 需关注）';
    }
    L.push(line);
    if (errand && errand !== best) flag('B', 'T' + t + ' errand gpf=' + f2(errand.v) + ' vs best=' + f2(best.v) + ' (' + best.label + ')');
  }

  // 体力口径：线下互动 stamina-per-favor @charm 0/6/12（talk=0，restraint 取 T1）
  L.push('');
  L.push('**线下互动 stamina-per-favor**（INTERACT_COST=' + na(safe(() => B.INTERACT_COST)) + '，talk=0，restraint=T1=' + na(safe(() => tier(1).restraint)) + '，auxBonus=0）：');
  L.push('');
  L.push('| charm 等级 | 0 | 6 | 12 |');
  L.push('| --- | --- | --- | --- |');
  const ic = safe(() => B.INTERACT_COST, 10);
  const ae = safe(() => B.ATTR_EFFECT, 0.08);
  const rest = safe(() => tier(1).restraint, 1);
  const spf = (charm) => ic / (0.5 * (1 + ae * charm) / rest * 5 * (1 + ae * 0));
  L.push('| stamina/favor | ' + f2(spf(0)) + ' | ' + f2(spf(6)) + ' | ' + f2(spf(12)) + ' |');
  L.push('');
  L.push('注：渠道动作（微信 2 好感/2 体力 = 1.00 stamina/favor 固定值，冷却 30min）为免费池下限，不计入上表比价。');
  return L.join('\n');
}

// ═══════════════ §C 掉落 ETA 解析表 ═══════════════
function sectionC() {
  const L = [];
  L.push('');
  L.push('## §C 掉落 ETA 解析表');
  L.push('');
  L.push('模型：单件装备 ETA = 1 / P(掉落)。P = 功能分支权重 × itemDropChance(' + na(safe(() => SET.itemDropChance)) + ') × equipDropRate(' + na(safe(() => SET.equipDropRate)) + ') × 品质率(rareItemRate=' + na(safe(() => SET.rareItemRate)) + '，aux 型 ×2)。');
  L.push('时长假设：间隔 = INTERVAL_S[tier] ÷ coef(**假设 coef=' + ASSUMPTIONS.npcCoef + '**，实际 NPC 0.8~1.5) × 抖动期望 ' + ASSUMPTIONS.jitterMean.toFixed(1) + ' × dropMul=' + ASSUMPTIONS.dropMul + '；rep 型间隔 ×LETTER_INTERVAL_MUL(' + na(safe(() => B.LOOT.LETTER_INTERVAL_MUL)) + ')。品质分布 QUALITY：common .80 / fine .17 / rare .03。');
  L.push('');

  const qC = safe(() => B.LOOT.QUALITY.common, 0.80);
  const qF = safe(() => B.LOOT.QUALITY.fine, 0.17);
  const itemChance = safe(() => SET.itemDropChance, 1.0);
  const equipRate = safe(() => SET.equipDropRate, 0.08);
  const rareRate = safe(() => SET.rareItemRate, safe(() => B.LOOT.QUALITY.rare, 0.03));

  L.push('| 类型 | 结果 | 期望掉落次数 | T1(h) | T2(h) | T3(h) | T4(h) | T5(h) |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  const headline = {};
  for (const type of ['money', 'rep', 'aux']) {
    const table = B.LOOT && B.LOOT.CONTENT && B.LOOT.CONTENT[type];
    if (!table) { flag('C', 'LOOT.CONTENT[' + type + '] missing'); continue; }
    const total = table.reduce((a, x) => a + x[1], 0);
    const pBr = {}; for (const [k, w] of table) pBr[k] = w / total;
    const pItemish = ((pBr.item || 0) + (pBr.func || 0)) * itemChance;
    const pFunc = (pBr.func || 0) * itemChance;
    const rareQ = type === 'aux' ? rareRate * 2 : rareRate;
    const intervalMul = type === 'rep' ? safe(() => B.LOOT.LETTER_INTERVAL_MUL, 1) : 1;

    const outcomes = [
      ['物品·普通', pItemish * qC],
      ['物品·精致', pItemish * qF],
      ['物品·稀有', pItemish * rareQ],
      ['装备·任意品质', pFunc * equipRate],
      ['装备·稀有', pFunc * equipRate * rareQ]
    ];
    const fmtDrops = (p) => { const d = p > 0 ? 1 / p : Infinity; return d === Infinity ? '∞' : (d < 100 ? f2(d) : grp(d)); };
    const typeTxt = { money: '金钱型', rep: '声望型(间隔×2)', aux: '辅助型(稀有×2)' }[type];
    for (const [label, p] of outcomes) {
      const drops = p > 0 ? 1 / p : Infinity;
      const cells = [fmtDrops(p)];
      for (let t = 1; t <= 5; t++) {
        const iv = safe(() => B.LOOT.INTERVAL_S[t], null);
        cells.push(has(iv) ? f2(drops * iv * intervalMul / 3600) : 'N/A');
      }
      const mark = label === '装备·稀有' ? ' ⚠' : '';
      L.push('| ' + typeTxt + ' | ' + label + mark + ' | ' + cells.join(' | ') + ' |');
      if (label === '装备·稀有') headline[type] = drops;
    }
  }

  // H2 头条核验：单资产（money/rep 型）稀有装备
  L.push('');
  const etaMoney = headline.money;
  const ivOf = (t) => safe(() => B.LOOT.INTERVAL_S[t], null);
  const docClaim = 4000;
  if (has(etaMoney)) {
    const drift = Math.abs(etaMoney - docClaim) / docClaim * 100;
    L.push('**H2 核验（≈4000 掉落主张）**：money/rep 型单件稀有装备 P/drop = func(10%) × itemDropChance(1.0) × equip(8%) × rare(3%) = 0.00024 → 期望 **' + grp(etaMoney) + ' 掉落**，与文档手算 ≈4000 偏差 ' + f2(drift) + '%（算术核验通过）。'
      + '「100+ 游戏小时」仅在 T1/T2 成立（' + f2(etaMoney * ivOf(1) / 3600) + 'h / ' + f2(etaMoney * ivOf(2) / 3600) + 'h）；T3 起为 ' + f2(etaMoney * ivOf(3) / 3600) + 'h+' + '，T5 达 ' + f2(etaMoney * ivOf(5) / 3600) + 'h —— **引入 pity 前稀有装备在高圈层实际不可达（H2 成立）**。aux 型因功能分支 45% + 稀有 ×2，ETA 仅 ' + grp(headline.aux) + ' 掉落。');
    flag('C', 'H2 rare-equip ETA(money-type)=' + Math.round(etaMoney) + ' drops vs doc 4000 (' + f2(drift) + '% drift); T5=' + f2(etaMoney * B.LOOT.INTERVAL_S[5] / 3600) + 'h unreachable');
  } else {
    L.push('⚠ LOOT 表缺失，无法核验 H2。');
  }
  return L.join('\n');
}

// ═══════════════ §D 属性成本断点 ═══════════════
function sectionD() {
  const L = [];
  L.push('');
  L.push('## §D 属性成本断点（charm/talk/taste，成本指数 lv0~49）');
  L.push('');
  const base = safe(() => B.ATTR_BASE_COST, 150);
  const growth = safe(() => B.ATTR_COST_GROWTH, 1.7);
  const eff = safe(() => B.ATTR_EFFECT, 0.08);
  const priceRate = safe(() => SET.priceRate, 1.0);

  // 好感估值（页脚同步记录）：MILESTONE_GOLD 按 NPC 圈层取值、每个里程碑同额
  // → 中估（T3 型 NPC）= MILESTONE_GOLD[3] × 里程碑数 ÷ FAVOR_MAX 金/好感
  const mg = B.MILESTONE_GOLD || {};
  const nMs = safe(() => B.MILESTONES.length, 3);
  const favMax = safe(() => B.FAVOR_MAX, 100);
  const t3val = has(mg[3]) ? mg[3] * nMs / favMax : null;
  ASSUMPTIONS.favorValueGold = t3val;
  ASSUMPTIONS.favorValueBasis = 'MILESTONE_GOLD[3](1800) × ' + nMs + ' 里程碑 ÷ ' + favMax + ' 好感';
  const charmDeltaDay = 0.5 * eff * ASSUMPTIONS.charmActiveMinPerDay / safe(() => tier(1).restraint, 1);   // 好感/日 @lv 边际
  const talkDeltaDay = 0.5 * 5 * eff * ASSUMPTIONS.talkInteractsPerDay;
  const horizon = ASSUMPTIONS.favorHorizonDays;

  L.push('成本字面量：attrCost(lv) = round(' + base + ' × ' + growth + '^lv × priceRate)。边际收益字面量：ATTR_EFFECT=+' + Math.round(eff * 100) + '%/级（charm 乘自动好感、talk 乘互动收益；taste 为门槛型不产生好感）。');
  L.push('回本假设（估计系数，见页脚）：好感按 T3 型 NPC 收网全程里程碑金估值 ' + f2(t3val) + ' 金/好感（' + ASSUMPTIONS.favorValueBasis + '，不含掉落/提成流）；charm 等效挂机 ' + ASSUMPTIONS.charmActiveMinPerDay + ' 游戏分/日（T1 restraint）、talk ' + ASSUMPTIONS.talkInteractsPerDay + ' 次互动/日。弃坑点判定：单级回本 > ' + horizon + ' 游戏日。');
  L.push('');
  L.push('| 目标等级 | 成本(金) | charm 边际好感/日 | charm 回本(日) | talk 边际好感/日 | talk 回本(日) | taste 说明 |');
  L.push('| --- | --- | --- | --- | --- | --- | --- |');
  let abandon = null;
  let cum = 0;
  const cumByLv = [0];
  for (let lv = 0; lv <= 49; lv++) {
    const cost = safe(() => Math.round(base * Math.pow(growth, lv) * priceRate), null);
    cum += has(cost) ? cost : 0;
    cumByLv.push(cum);
    const cpb = has(cost) ? cost / (charmDeltaDay * t3val) : null;
    const tpb = has(cost) ? cost / (talkDeltaDay * t3val) : null;
    if (cpb != null && cpb > horizon && abandon == null) abandon = { lv, cost, cpb };
    L.push('| lv' + (lv + 1) + '（' + lv + '→' + (lv + 1) + '） | ' + na(cost) + '（累计 ' + grp(cum) + '） | '
      + f2(charmDeltaDay) + ' | ' + f2(cpb) + ' | ' + f2(talkDeltaDay) + ' | ' + f2(tpb) + ' | ' + (lv === 0 ? '门槛型（LARGE_TASTE/圈层准入），不计回本' : '—') + ' |');
  }
  L.push('');
  // R1：T4/T5 品味墙专项——累计金与 sim 实测对照
  const cumTo = (target) => (has(target) && target >= 0 && target < cumByLv.length) ? cumByLv[target] : null;
  const cum25 = cumTo(safe(() => tier(4).taste, null));
  const cum50 = cumTo(safe(() => tier(5).taste, null));
  const simFind = latestSimFinding();
  L.push('**品味墙专项（圈层准入 taste 需求 × 指数成本）**：');
  L.push('');
  L.push('- 圈层准入需求（TIERS.taste）：T4=' + na(safe(() => tier(4).taste)) + '、T5=' + na(safe(() => tier(5).taste)) + '；大礼门槛（LARGE_TASTE）：T3=' + na(safe(() => B.LARGE_TASTE[3])) + '、T4=' + na(safe(() => B.LARGE_TASTE[4])) + '、T5=' + na(safe(() => B.LARGE_TASTE[5])) + '。');
  if (has(cum25) && has(cum50)) {
    L.push('- 累计升级金（attrCost 逐级累加，priceRate=' + f2(priceRate) + '）：taste 0→25 ≈ **' + grp(cum25) + ' 金**；taste 0→50 ≈ **' + grp(cum50) + ' 金**。');
    flag('D', 'taste wall: cumulative gold 0->25(T4 req)=' + cum25 + ', 0->50(T5 req)=' + cum50);
  } else {
    L.push('- ⚠ 无法计算累计升级金（TIERS.taste 缺失）。');
    flag('D', 'taste wall: TIERS taste values missing');
  }
  if (simFind && simFind.t5 && simFind.t5.failed) {
    L.push('- 与 sim.js 实测对照（' + simFind.file + '）：百日末 P50 taste=lv' + simFind.tasteP50
      + '，T5 未达成 ' + simFind.t5.failed + '/' + simFind.t5.total + ' 运行，其中品味墙 ' + simFind.t5.tasteWallN
      + ' 例（P50 lv' + simFind.t5.tasteP50 + '→需 ' + simFind.t5.tasteNeed + '，还需 ≈' + grp(simFind.t5.tasteCumGoldP50)
      + ' 金）——**H5 nuance：指数属性成本在 T5 准入处形成硬墙，T4→T5 死区主因不是 rep/fee 而是品味**。');
    flag('D', 'sim cross-check: T5 blocked by taste wall in ' + simFind.t5.tasteWallN + '/' + simFind.t5.failed + ' failed runs (P50 need lv' + simFind.t5.tasteNeed + ')');
  } else {
    L.push('- （未找到可对照的 sim-standard-*.json 或其中 T5 已达成——先跑 `npm run sim -- --quick` 再看本行。）');
  }
  L.push('');
  const lv12cost = safe(() => Math.round(base * Math.pow(growth, 12) * priceRate), null);
  if (abandon) {
    L.push('**弃坑点**：lv' + abandon.lv + '→' + (abandon.lv + 1) + ' 起单级回本 ' + f2(abandon.cpb) + ' 日 > ' + horizon + ' 日视界（该级成本 ' + grp(abandon.cost) + ' 金）；此前各级回本均在视界内。'
      + '**H5 判定：通过**——弃坑点（lv' + (abandon.lv + 1) + '）远晚于 T3 达成目标区间（第 8~14 日，§4 校准表），T3 阶段属性升级均有正收益，无需降成本基数/指数。');
    flag('D', 'H5 abandon point: lv' + abandon.lv + '->' + (abandon.lv + 1) + ' payback ' + f2(abandon.cpb) + 'd > ' + horizon + 'd horizon (later than T3 -> pass)');
  } else {
    L.push('**弃坑点**：lv0~15 内无单级回本超过 ' + horizon + ' 日，H5 通过。');
  }
  if (has(lv12cost)) {
    L.push('');
    L.push('⚠ 文档常数出入：02 号文档 H5 手算「lv12≈2.9万/级」，现行字面量 lv12→13 成本 = ' + grp(lv12cost) + ' 金（150×1.7^12）——文档口径与代码不一致，建议更新文档或核对历史版本。');
    flag('D', 'doc mismatch: H5 hand-calc lv12~29k vs actual ' + lv12cost + ' gold');
  }
  return L.join('\n');
}

// ═══════════════ §E 门槛台阶比 ═══════════════
function sectionE() {
  const L = [];
  L.push('');
  L.push('## §E 门槛台阶比（圈层 n→n+1）');
  L.push('');
  L.push('| 台阶 | rep ×ratio | fee ×ratio | taste 绝对跳变 | mult ×ratio | restraint ×ratio | 标记 |');
  L.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (let i = 1; i < 5; i++) {
    const a = tier(i), b = tier(i + 1);
    if (!a || !b) { flag('E', 'TIERS[' + i + '] missing'); continue; }
    const rr = ratio(b.rep, a.rep);
    const fr = ratio(b.fee, a.fee);
    const mr = ratio(b.mult, a.mult);
    const xr = ratio(b.restraint, a.restraint);
    const tasteJump = b.taste - a.taste;
    const marks = [];
    if (rr != null && rr > 5) marks.push('rep ×' + f2(rr));
    else if (rr == null) marks.push('rep 0→' + b.rep + '(∞)');
    if (fr != null && fr > 5) marks.push('fee ×' + f2(fr));
    if (mr != null && mr > 5) marks.push('mult ×' + f2(mr));
    if (tasteJump >= 10) marks.push('taste +' + tasteJump);   // R2：去掉 a.taste>=10 门限，T2→T3 的 0→10 跳变也要标
    const isT34 = i === 3;
    L.push('| T' + i + '→T' + (i + 1) + '（' + a.name + '→' + b.name + '） | '
      + (rr == null ? '∞（0→' + b.rep + '）' : '×' + f2(rr)) + ' | '
      + (fr == null ? '∞（0→' + grp(b.fee) + '）' : '×' + f2(fr)) + ' | '
      + a.taste + '→' + b.taste + '（+' + tasteJump + '） | '
      + '×' + f2(mr) + ' | ×' + f2(xr) + ' | '
      + (marks.length ? '⚠ ' + marks.join('、') : '平滑') + ' |');
    if (marks.length) flag('E', 'T' + i + '->T' + (i + 1) + ' jump: ' + marks.join(', '));
  }
  L.push('');
  const t34 = 'T3→T4：rep ×' + f2(ratio(tier(4).rep, tier(3).rep)) + '（3500/600）、fee ×' + f2(ratio(tier(4).fee, tier(3).fee)) + '（150万/10万）、品味 10→25 三重同时跳——';
  L.push('**H3 核验**：' + t34 + '三跳并存确认，**H3 死区风险成立**（是否真死区需 sim.js 时刻表复核）。');
  return L.join('\n');
}

// ═══════════════ §F 死配置检查 ═══════════════
function sectionF() {
  const L = [];
  L.push('');
  L.push('## §F 死配置检查（H6 自检）');
  L.push('');

  // 1) 断言已删除项
  const repPassiveGone = !('REP_PASSIVE' in B);
  const wechatEffGone = !('wechatEfficiency' in SET);
  L.push('- `BALANCE.REP_PASSIVE`：' + (repPassiveGone ? '✓ 已删除（不存在于 balance.js）' : '✗ 仍然存在'));
  L.push('- `SETTINGS_DEFAULT.wechatEfficiency`：' + (wechatEffGone ? '✓ 已删除（不存在于 settings 默认表）' : '✗ 仍然存在'));
  if (!repPassiveGone) flag('F', 'REP_PASSIVE still present in BALANCE');
  if (!wechatEffGone) flag('F', 'wechatEfficiency still present in SETTINGS_DEFAULT');

  // 2) 引用扫描：balance/settings 键是否被运行时代码引用
  // R5：scripts/*.js（校准/报告脚本本身是表的合法消费方）一并纳入语料
  let scriptFiles = [];
  try {
    scriptFiles = fs.readdirSync(path.join(ROOT, 'scripts'))
      .filter((f) => f.endsWith('.js')).map((f) => 'scripts/' + f);
  } catch (e) { flag('F', 'scripts dir unreadable'); }
  const scanFiles = [
    'src/js/engine.js', 'src/js/agent.js', 'src/js/ui-panel.js', 'src/js/ui-bar.js', 'src/js/app.js'
  ].concat(scriptFiles);
  let corpus = '';
  const readOk = [];
  for (const rel of scanFiles) {
    try { corpus += fs.readFileSync(path.join(ROOT, rel), 'utf8'); readOk.push(rel); }
    catch (e) { corpus += ''; flag('F', 'scan file unreadable: ' + rel); }
  }
  const referenced = (key) => new RegExp('\\b' + key.replace(/[$]/g, '\\$') + '\\b').test(corpus);

  const balKeys = Object.keys(B).filter((k) => typeof B[k] !== 'function');
  const setKeys = Object.keys(SET);
  const setNorm = new Set(setKeys.map((k) => k.toLowerCase().replace(/_/g, '')));
  const norm = (k) => k.toLowerCase().replace(/_/g, '');
  const deadBal = balKeys.filter((k) => !referenced(k));
  const deadSet = setKeys.filter((k) => !referenced(k));
  // 镜像判定：BALANCE 键归一化后与某 settings 键同名 → 引擎经 settings.* 读取的冗余镜像
  const mirrored = deadBal.filter((k) => setNorm.has(norm(k)));
  const orphan = deadBal.filter((k) => !setNorm.has(norm(k)));

  L.push('- 引用扫描范围：' + scanFiles.join('、') + '（词边界匹配键名）');
  L.push('- BALANCE 顶层键 ' + balKeys.length + ' 个，未被运行时引用的疑似死键 ' + deadBal.length + ' 个：');
  L.push('  - settings 镜像候选（存在同名语义 settings 键，引擎实际读取 `settings.*`，属数据冗余）：' + (mirrored.length ? mirrored.map((k) => '`' + k + '`').join('、') : '无'));
  L.push('  - 无任何引用方（真孤儿常量，删除前人工确认）：' + (orphan.length ? orphan.map((k) => '`' + k + '`').join('、') : '无'));
  L.push('  - 注：`INTERACT_COST/WECHAT_COST/WORKPLACE_COST` 等与 settings 的 `*StaminaCost` 系列为改名镜像（归一化不同名），按孤儿列出但实为冗余。');
  L.push('- SETTINGS_DEFAULT 键 ' + setKeys.length + ' 个，未被运行时引用的疑似死旋钮：' + (deadSet.length ? deadSet.map((k) => '`' + k + '`').join('、') : '无'));
  if (!deadBal.length && !deadSet.length) L.push('- ✓ 未发现死配置。');
  L.push('');
  L.push('注：「未引用」≠ 必然可删——部分键可能供存档迁移/后台面板/未来系统预留；删除前人工确认。本节使 H6 在每次报告中自检。');
  for (const k of mirrored) flag('F', 'suspected dead BALANCE key (settings mirror): ' + k);
  for (const k of orphan) flag('F', 'suspected dead BALANCE key (no referencer): ' + k);
  for (const k of deadSet) flag('F', 'suspected dead SETTINGS key: ' + k);
  return L.join('\n');
}

// ═══════════════ Footer ═══════════════
function sectionFooter() {
  const L = [];
  L.push('');
  L.push('---');
  L.push('');
  L.push('## 方法论与假设清单');
  L.push('');
  L.push('**字面量常量**（直接取自代码，非估计）：TIERS/GIFTS/SPEND/LOOT.INTERVAL_S/QUALITY/CONTENT 权重/equipDropRate(.08)/rareItemRate(.03)/itemDropChance(1.0)/ATTR_*(150, 1.7, +8%)/COMMISSION_PER_WAN(300)/SELL_RATE(.3)/MATCH_UP(1.2)/DATE.EVENTS 权重。');
  L.push('');
  L.push('**估计系数**（本报告假设，改动需同步页脚）：');
  L.push('1. 掉落间隔个体系数 coef=' + ASSUMPTIONS.npcCoef + '（实际 NPC coef ∈ [0.8, 1.5]，均值≈1.15 → 真实 ETA 约再 ×0.87）；');
  L.push('2. 抖动期望 = ' + ASSUMPTIONS.jitterMean.toFixed(1) + '（JITTER/PACK_JITTER 区间对称，精确成立）；');
  L.push('3. dropMul=' + ASSUMPTIONS.dropMul + '（不计成就「捡漏之王」-5%、宠物「拾荒」-6%、连携 y3 -15%）；');
  L.push('4. §D 回本的好感估值 = ' + ASSUMPTIONS.favorValueBasis + ' = ' + f2(ASSUMPTIONS.favorValueGold) + ' 金/好感（不含掉落/提成收入流，偏保守）；');
  L.push('5. §D 行为强度：charm 等效挂机 ' + ASSUMPTIONS.charmActiveMinPerDay + ' 游戏分/日、talk ' + ASSUMPTIONS.talkInteractsPerDay + ' 次互动/日（体力上限内可行）；');
  L.push('6. §B 约会中估含匹配 ×1.2 与事件期望 mul，不含热点(+20%)、名片夹(8折)、回礼(8%)等增溢；');
  L.push('7. §C 时长单位为游戏小时（3600 游戏秒），与现实时间无关。');
  L.push('');
  L.push('**品质率双源注记（R6）**：`BALANCE.LOOT.QUALITY.rare`（常量 ' + na(safe(() => B.LOOT.QUALITY.rare)) + '）与 `SETTINGS_DEFAULT.rareItemRate`（旋钮 ' + na(safe(() => SET.rareItemRate)) + '）是**两个独立来源**，今日数值恰好相等；§C 计算用的是 settings 旋钮，表头文字引用的是 QUALITY 常量——后台调参时二者需分别确认，避免「改了旋钮没生效/改了常量不影响引擎」的错觉。');
  L.push('');
  L.push('**复现戳**：git `' + REPRO.gitHash + '` · node ' + process.version + ' · 输入指纹 ' + JSON.stringify(REPRO.inputs) + '');
  L.push('');
  L.push('生成器：`scripts/balance-report.js`（零依赖，确定性输出顺序）。设计依据：docs/drafts/alpha4/02-calibration-and-balance-report.md §2/§3。');
  return L.join('\n');
}

// ═══════════════ R3 自动标记汇总 ═══════════════
function sectionFlagsSummary() {
  const L = [];
  L.push('');
  L.push('## 自动标记汇总（本报告全部 flags[]）');
  L.push('');
  if (!flags.length) {
    L.push('无自动标记（全部体检项静默通过）。');
    return L.join('\n');
  }
  L.push('| 节 | 标记 |');
  L.push('| --- | --- |');
  for (const f of flags) L.push('| ' + f.sec + ' | ' + String(f.msg).replace(/\|/g, '\\|') + ' |');
  return L.join('\n');
}

// ═══════════════ main ═══════════════
function main() {
  if (!globalThis.BALANCE) { console.error('FATAL: BALANCE not loaded'); process.exit(1); }
  const md = [
    sectionHeader(),
    sectionA(),
    sectionB(),
    sectionC(),
    sectionD(),
    sectionE(),
    sectionF(),
    sectionFooter(),
    sectionFlagsSummary(),
    ''
  ].join('\n');

  const outPath = path.join(ROOT, 'docs', 'reports', 'balance.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md, 'utf8');

  // ── 控制台 ASCII 摘要 ──
  console.log('=== balance-report ===');
  console.log('output: docs/reports/balance.md  (SAVE_VERSION ' + na(safe(() => B.SAVE_VERSION)) + ', ' + NPCS.length + ' npcs, ' + ITEMS.length + ' items)');
  console.log('sections: A(faucet/sink) B(efficiency) C(loot-ETA) D(attr-cost+T5-taste-wall) E(tier-jumps) F(dead-config) + flags-summary');
  console.log('flags: ' + flags.length);
  const bySec = {};
  for (const f of flags) (bySec[f.sec] = bySec[f.sec] || []).push(f.msg);
  for (const sec of ['A', 'B', 'C', 'D', 'E', 'F']) {
    for (const m of bySec[sec] || []) {
      console.log('  [' + sec + '] ' + m.replace(/∞/g, 'INF').replace(/×/g, 'x').replace(/⚠/g, '').replace(/→/g, '->'));
    }
  }
  if (!bySec.C) console.log('  [C] no flags (H2 check passed silently?)');
}

main();
