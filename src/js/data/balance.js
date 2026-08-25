// 数值表 v2：来源 docs/drafts/alpha/02-numbers.md（v1 基线）+ alpha2/01/02/05/06/07/08
// 未标注的变化项全部沿用 v1；管理后台可调参数的权威默认值见 SETTINGS_DEFAULT。
globalThis.BALANCE = {
  SAVE_VERSION: 2,

  FAVOR_MAX: 100,
  MILESTONES: [25, 50, 75],

  START_GOLD: 10000,          // 需求②：启动资金

  // ── 体力（v2：主角 Agent 的行动燃料，恢复速度是难度总旋钮）──
  STAMINA_MAX: 100,
  STAMINA_REGEN_PER_MIN: 20,  // 需求①：20 点/分钟（v1 为 1 点/3 分钟）
  INTERACT_COST: 10,          // 线下互动消耗
  WECHAT_COST: 2,             // 微信聊天消耗
  WORKPLACE_COST: 6,          // 职场互动消耗
  WORK_REST_RESUME: 0.3,      // 上班歇业后体力回到上限 30% 自动复岗

  SLOTS_INIT: 3,
  SLOTS_MAX: 7,
  SLOT_COSTS: { 4: 50000, 5: 500000, 6: 8000000, 7: 100000000 },

  ATTR_EFFECT: 0.08,
  ATTR_BASE_COST: 150,
  ATTR_COST_GROWTH: 1.7,

  AUX_BONUS_PER: 0.05,
  AUX_BONUS_CAP: 0.5,

  OFFLINE_CAP_H: 12,
  OFFLINE_AUX_BONUS_H: 1.5,
  OFFLINE_AUX_CAP_H: 12,
  OFFLINE_FAVOR_RATE: 0.5,

  TIERS: [
    { id: 1, name: '职场圈', rep: 0,     fee: 0,        taste: 0,  mult: 1,    restraint: 1.0, color: '#5b6b8c' },
    { id: 2, name: '精英圈', rep: 100,   fee: 10000,    taste: 0,  mult: 2.5,  restraint: 1.2, color: '#3d4f8a' },
    { id: 3, name: '名流圈', rep: 600,   fee: 100000,   taste: 10, mult: 6,    restraint: 1.5, color: '#a03e4e' },
    { id: 4, name: '富豪圈', rep: 3500,  fee: 1500000,  taste: 25, mult: 15,   restraint: 2.0, color: '#3fa080' },
    { id: 5, name: '顶层圈', rep: 20000, fee: 30000000, taste: 50, mult: 40,   restraint: 3.0, color: '#e8c46a' }
  ],

  BASE_OUTPUT: { money: 1.0, rep: 0.35, aux: 0.15 }, // v1 口径金/秒（掉落期望锚点，07 §1.2）

  MILESTONE_GOLD: { 1: 300, 2: 750, 3: 1800, 4: 4500, 5: 12000 },
  MILESTONE_REP: { 1: 8, 2: 20, 3: 55, 4: 140, 5: 360 },
  FULL_REP: { 1: 5, 2: 10, 3: 27, 4: 70, 5: 180 },
  REP_PASSIVE: { 1: 0.10, 2: 0.25, 3: 0.60, 4: 1.50, 5: 4.00 },

  GIFTS: {
    small: { label: '小礼', favor: 4,  cost: { 1: 80, 2: 400, 3: 2000, 4: 10000, 5: 50000 } },
    mid:   { label: '中礼', favor: 10, cost: { 1: 250, 2: 1300, 3: 6500, 4: 33000, 5: 160000 } },
    large: { label: '大礼', favor: 25, cost: { 1: 800, 2: 4000, 3: 20000, 4: 100000, 5: 500000 } }
  },
  LARGE_TASTE: { 1: 0, 2: 0, 3: 5, 4: 13, 5: 25 },

  // ── 渠道动作（02 §4.1 三条渠道 + 免费池 04 §2.4）──
  WECHAT_FAVOR: 2,      // 固定值，不受加成
  WECHAT_CD_MIN: 30,    // 每 NPC 冷却（游戏分钟）
  MOMENTS_FAVOR: 1,
  MOMENTS_CD_MIN: 120,
  WORKPLACE_FAVOR: 3,
  WORKPLACE_CD_MIN: 60, // 仅 T1 且在岗时段可用

  // ── 基础工作（02 §3.1 工作表）──
  JOBS: {
    tea:        { label: '奶茶店服务员', wage: 25, staminaPerH: 8,  unlock: 'start',     tipChance: 0.12, tipRange: [5, 20] },
    restaurant: { label: '餐厅服务员',   wage: 30, staminaPerH: 12, unlock: 'start',     eveningMul: 1.5 }, // 现实 18:00-22:00 时薪×1.5
    night:      { label: '便利店夜班',   wage: 45, staminaPerH: 20, unlockAssets: 3,     offlineMul: 1.2 }  // 离线挂班收益 +20%
  },
  SHIFT_H: [2, 4, 8],
  EVENING_HOURS: [18, 22], // 餐厅晚班现实时段

  // ── 消费项目（05 §2 价目表；日期价格为礼物基准 × 倍数）──
  SPEND: {
    date: {
      light: { label: '轻约', favor: 6,  base: 'small', mul: 1.5 },
      meal:  { label: '正餐', favor: 15, base: 'mid',   mul: 1.5, unlockFavor: 25 },
      trip:  { label: '远行', favor: 35, base: 'large', mul: 2.5, unlockFavor: 50 }
    },
    errand: { label: '办事', favor: 60, base: 'large', mul: 6, unlockFavor: 75 }, // 每人限一次
    MATCH_UP: 1.2, MATCH_DOWN: 0.8,
    // 场景变体（同档同价，tag 不同）
    VARIANTS: {
      light: [
        { name: '街角咖啡', tags: ['市井', '美食'] },
        { name: '看展',     tags: ['文艺', '收藏'] },
        { name: '球赛',     tags: ['运动', '时尚'] }
      ],
      meal: [
        { name: '家常馆子', tags: ['市井', '美食'] },
        { name: '商务宴请', tags: ['商务', '酒局'] },
        { name: '私厨',     tags: ['美食', '收藏'] }
      ],
      trip: [
        { name: '音乐节之旅', tags: ['文艺', '时尚'] },
        { name: '城市漫游',   tags: ['美食', '旅行'] },
        { name: '高尔夫周末', tags: ['商务', '运动'] }
      ]
    }
  },

  // ── 关系阶段剧本（04 §2.2 L1）──
  STAGES: [
    { key: 'ice',   label: '破冰', min: 0,  goal: 25 },
    { key: 'warm',  label: '升温', min: 25, goal: 50 },
    { key: 'deep',  label: '深交', min: 50, goal: 75 },
    { key: 'close', label: '收网', min: 75, goal: 100 }
  ],

  // ── 掉落系统（07）──
  LOOT: {
    INTERVAL_S: { 1: 120, 2: 150, 3: 240, 4: 420, 5: 720 }, // 层基准间隔，÷个体系数，±30% 抖动
    JITTER: [0.7, 1.3],
    PACK_JITTER: [0.6, 1.4],       // 单包价值抖动
    LETTER_REP: { 1: 1, 2: 2, 3: 4, 4: 8, 5: 15 }, // 声望手札固定值
    LETTER_INTERVAL_MUL: 2,        // 手札间隔 ×2
    QUALITY: { common: 0.80, fine: 0.17, rare: 0.03 },
    // 内容分流表 [类型, 权重]，item=普通物品分支 func=功能物品分支
    CONTENT: {
      money: [['gold', 70], ['item', 20], ['func', 10]],
      rep:   [['letter', 55], ['intel', 20], ['gold', 15], ['func', 10]],
      aux:   [['func', 45], ['gold', 35], ['item', 20]]
    },
    SELL_RATE: 0.3,
    INV_CAP: 50,
    AUTO_PICKUP_MS: 3000,
    CRIT_MS: 3000                  // 手动 3 秒内点中 = ×2
  },

  // ── 约会随机（08）──
  DATE: {
    EVENTS: [
      { key: 'plain',    label: '顺其自然', w: 60, mul: 1 },
      { key: 'chat',     label: '相谈甚欢', w: 20, mul: 1.5 },
      { key: 'hiccup',   label: '小插曲',   w: 12, mul: 0.7 },
      { key: 'surprise', label: '惊喜时刻', w: 5,  mul: 2,   item: true },
      { key: 'noble',    label: '偶遇贵人', w: 3,  mul: 1,   intel: true }
    ],
    POSITIVE: ['chat', 'surprise'],
    RETURN_CHANCE: 0.08,           // 大礼/远行/办事后回礼概率
    INVITE_P: 0.15,                // 好感≥40 每游戏日判定 P=15%×匹配系数
    INVITE_FAVOR: 40,
    INVITE_VALID_H: 24,
    HOTSPOT_PER_DAY: [1, 2],       // 每游戏日刷新热点数
    HOTSPOT_FAVOR: 1.2,            // 命中热点好感效率 +20%
    HOTSPOTS: [
      { name: '画廊新展',   tags: ['文艺', '收藏'] },
      { name: '联赛决赛',   tags: ['运动', '时尚'] },
      { name: '新品首发',   tags: ['科技', '时尚'] },
      { name: '米其林新榜', tags: ['美食', '商务'] },
      { name: '慈善拍卖',   tags: ['收藏', '公益'] },
      { name: '独立影展',   tags: ['文艺', '学术'] },
      { name: '深夜食堂节', tags: ['市井', '美食'] },
      { name: '行业峰会',   tags: ['商务', '科技'] }
    ]
  },

  DAY_MS: 86400000,
  WEEK_MS: 7 * 86400000
};

// ── 管理后台可配置项默认值（01 §2.2 权威定义）──
globalThis.SETTINGS_DEFAULT = {
  // 体力组
  staminaRegenPerMin: 20,
  staminaMax: 100,
  interactStaminaCost: 10,
  wechatStaminaCost: 2,
  workplaceInteractCost: 6,
  offlineRegen: true,
  // 时间组
  timeScale: 1.0,
  offlineCapHours: 12,
  offlineFavorRate: 0.5,
  // 经济组
  startGold: 10000,
  dropIntervalRate: 1.0,   // 倍率，越小掉越勤
  dropValueRate: 1.0,
  itemDropChance: 1.0,     // 物品分支占比缩放
  rareItemRate: 0.03,
  priceRate: 1.0,          // 消费项目/属性/槽位全局物价
  favorPerYuanRate: 1.0,   // 消费项目好感倍率
  workWageRate: 1.0,
  tipChance: 0.12,
  // 自动攻略组（决策器输入）
  decisionIntervalSec: 5,
  spendStyle: 'standard',  // frugal|standard|generous|lavish
  dailyBudget: 20000,      // 0=不限
  perNpcBudget: 5000,      // 0=不限
  milestonePushWeight: 1.5,
  wechatEfficiency: 0.4,
  autoSlotOrder: 'off',    // off|output|refer|reputation
  invitePolicy: 'auto',    // auto|ask
  scoreAlpha: 0.02,
  scoreBeta: 1.0,
  // 界面组
  autoPickup: true,
  notifyLevel: 'all',      // all|milestone|mute
  decisionLogDepth: 50
};

// ── 后台预设（01 §2.3）──
globalThis.SETTINGS_PRESETS = {
  standard: { label: '标准', patch: {} },
  casual:   { label: '休闲', patch: { staminaRegenPerMin: 40, priceRate: 0.8, dropValueRate: 1.2 } },
  speed:    { label: '极速', patch: { staminaRegenPerMin: 60, timeScale: 2.0, dailyBudget: 0, perNpcBudget: 0 } }
};

if (typeof module !== 'undefined') {
  module.exports = globalThis.BALANCE;
}
