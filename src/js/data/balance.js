// 数值表：来源 docs/drafts/alpha/02-numbers.md（v1 决策补全见 05-bar-ui.md §6）
globalThis.BALANCE = {
  SAVE_VERSION: 1,

  FAVOR_MAX: 100,
  MILESTONES: [25, 50, 75],

  STAMINA_MAX: 100,
  STAMINA_REGEN_MS: 3 * 60 * 1000, // 1 点 / 3 分钟
  INTERACT_COST: 10,

  SLOTS_INIT: 3,
  SLOTS_MAX: 7,
  SLOT_COSTS: { 4: 50000, 5: 500000, 6: 8000000, 7: 100000000 },

  ATTR_EFFECT: 0.08,          // 每级 +8%
  ATTR_BASE_COST: 150,
  ATTR_COST_GROWTH: 1.7,

  AUX_BONUS_PER: 0.05,        // 每个辅助型资产 +5% 自动好感（v1 决策）
  AUX_BONUS_CAP: 0.5,

  OFFLINE_CAP_H: 12,
  OFFLINE_AUX_BONUS_H: 1.5,   // 每辅助型资产 +1.5h 上限（v1 决策）
  OFFLINE_AUX_CAP_H: 12,
  OFFLINE_FAVOR_RATE: 0.5,

  TIERS: [
    { id: 1, name: '职场圈', rep: 0,     fee: 0,        taste: 0,  mult: 1,    restraint: 1.0, color: '#5b6b8c' },
    { id: 2, name: '精英圈', rep: 100,   fee: 10000,    taste: 0,  mult: 2.5,  restraint: 1.2, color: '#3d4f8a' },
    { id: 3, name: '名流圈', rep: 600,   fee: 100000,   taste: 10, mult: 6,    restraint: 1.5, color: '#a03e4e' },
    { id: 4, name: '富豪圈', rep: 3500,  fee: 1500000,  taste: 25, mult: 15,   restraint: 2.0, color: '#3fa080' },
    { id: 5, name: '顶层圈', rep: 20000, fee: 30000000, taste: 50, mult: 40,   restraint: 3.0, color: '#e8c46a' }
  ],

  BASE_OUTPUT: { money: 1.0, rep: 0.35, aux: 0.15 }, // 金/秒，× 圈层倍率 × 个体系数

  MILESTONE_GOLD: { 1: 300, 2: 750, 3: 1800, 4: 4500, 5: 12000 }, // 金钱型/辅助型 25/50/75
  MILESTONE_REP: { 1: 8, 2: 20, 3: 55, 4: 140, 5: 360 },     // 声望型 25/50/75
  FULL_REP: { 1: 5, 2: 10, 3: 27, 4: 70, 5: 180 },           // 任意满级；声望型 ×2
  REP_PASSIVE: { 1: 0.10, 2: 0.25, 3: 0.60, 4: 1.50, 5: 4.00 }, // 声望型资产 声望/分

  GIFTS: {
    small: { label: '小礼', favor: 4,  cost: { 1: 80, 2: 400, 3: 2000, 4: 10000, 5: 50000 } },
    mid:   { label: '中礼', favor: 10, cost: { 1: 250, 2: 1300, 3: 6500, 4: 33000, 5: 160000 } },
    large: { label: '大礼', favor: 25, cost: { 1: 800, 2: 4000, 3: 20000, 4: 100000, 5: 500000 } }
  },
  LARGE_TASTE: { 1: 0, 2: 0, 3: 5, 4: 13, 5: 25 } // 大礼需品味 ≥ 门槛一半（向上取整）
};

if (typeof module !== 'undefined') module.exports = globalThis.BALANCE;
