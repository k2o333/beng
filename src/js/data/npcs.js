// 30 NPC 配置：来源 docs/drafts/alpha/03-content.md + 外观 06-appearance.md
// type: money 金钱型 | rep 声望型 | aux 辅助型
// look: gender m/f, hair short|long|bun|pony|buzz|slick, outfit suit|dress|coat|gown
globalThis.NPCS = [
  // ── 第 1 层 · 职场圈 ──
  { id: 't1_lin', name: '林晓芸', tier: 1, type: 'rep', coef: 1.1, refer: null,
    look: { gender: 'f', hair: 'long', hairColor: '#4a3b2a', outfit: 'dress', outfitColor: '#5b6b8c', accessory: 'scarf' } },
  { id: 't1_gu', name: '顾言', tier: 1, type: 'money', coef: 1.2, refer: null,
    look: { gender: 'm', hair: 'short', hairColor: '#2b2b33', outfit: 'suit', outfitColor: '#46547a', accessory: 'tie' } },
  { id: 't1_he', name: '何丽娜', tier: 1, type: 'aux', coef: 1.0, refer: null,
    look: { gender: 'f', hair: 'pony', hairColor: '#6b4a2f', outfit: 'dress', outfitColor: '#6a7aa0', accessory: 'earring' } },
  { id: 't1_zhou', name: '周子昂', tier: 1, type: 'money', coef: 0.9, refer: null,
    look: { gender: 'm', hair: 'short', hairColor: '#3a2e23', outfit: 'suit', outfitColor: '#7183ab', accessory: 'none' } },
  { id: 't1_shen', name: '沈曼', tier: 1, type: 'rep', coef: 1.3, refer: 't2_lu',
    look: { gender: 'f', hair: 'bun', hairColor: '#1e1e28', outfit: 'coat', outfitColor: '#3a4258', accessory: 'glasses' } },
  { id: 't1_jiang', name: '江野', tier: 1, type: 'aux', coef: 0.8, refer: null,
    look: { gender: 'm', hair: 'buzz', hairColor: '#222222', outfit: 'coat', outfitColor: '#5d6b85', accessory: 'none' } },

  // ── 第 2 层 · 精英圈 ──
  { id: 't2_lu', name: '陆之衍', tier: 2, type: 'money', coef: 1.3, refer: null,
    look: { gender: 'm', hair: 'slick', hairColor: '#1a1a22', outfit: 'suit', outfitColor: '#2e3a66', accessory: 'tie' } },
  { id: 't2_bai', name: '白露', tier: 2, type: 'rep', coef: 1.1, refer: null,
    look: { gender: 'f', hair: 'long', hairColor: '#d88ca0', outfit: 'gown', outfitColor: '#e8e4da', accessory: 'earring' } },
  { id: 't2_qin', name: '秦朗', tier: 2, type: 'aux', coef: 1.0, refer: null,
    look: { gender: 'm', hair: 'short', hairColor: '#2b2b33', outfit: 'suit', outfitColor: '#333d5c', accessory: 'glasses' } },
  { id: 't2_han', name: '韩东', tier: 2, type: 'money', coef: 1.0, refer: null,
    look: { gender: 'm', hair: 'short', hairColor: '#3a2e23', outfit: 'suit', outfitColor: '#3a4a80', accessory: 'tie' } },
  { id: 't2_meng', name: '孟真真', tier: 2, type: 'rep', coef: 1.2, refer: 't3_fu',
    look: { gender: 'f', hair: 'bun', hairColor: '#4a3b2a', outfit: 'dress', outfitColor: '#7a2e3a', accessory: 'scarf' } },
  { id: 't2_xu', name: '许薇', tier: 2, type: 'aux', coef: 0.9, refer: null,
    look: { gender: 'f', hair: 'pony', hairColor: '#1e1e28', outfit: 'gown', outfitColor: '#26242e', accessory: 'earring' } },

  // ── 第 3 层 · 名流圈 ──
  { id: 't3_fu', name: '傅司远', tier: 3, type: 'money', coef: 1.4, refer: null,
    look: { gender: 'm', hair: 'slick', hairColor: '#3a3a44', outfit: 'suit', outfitColor: '#5e2530', accessory: 'tie' } },
  { id: 't3_wen', name: '温以宁', tier: 3, type: 'rep', coef: 1.1, refer: null,
    look: { gender: 'f', hair: 'long', hairColor: '#c9a85a', outfit: 'gown', outfitColor: '#e8e0d0', accessory: 'earring' } },
  { id: 't3_huo', name: '霍青山', tier: 3, type: 'money', coef: 1.0, refer: null,
    look: { gender: 'm', hair: 'short', hairColor: '#2b2b33', outfit: 'suit', outfitColor: '#8a3242', accessory: 'glasses' } },
  { id: 't3_li', name: '黎朔', tier: 3, type: 'aux', coef: 1.0, refer: null,
    look: { gender: 'f', hair: 'short', hairColor: '#1e1e28', outfit: 'coat', outfitColor: '#3a3a42', accessory: 'glasses' } },
  { id: 't3_ye', name: '叶蓁', tier: 3, type: 'rep', coef: 1.3, refer: 't4_xie',
    look: { gender: 'f', hair: 'bun', hairColor: '#4a3b2a', outfit: 'gown', outfitColor: '#d8b45a', accessory: 'earring' } },
  { id: 't3_jiangsheng', name: '姜声', tier: 3, type: 'aux', coef: 0.9, refer: null,
    look: { gender: 'm', hair: 'pony', hairColor: '#3a3a44', outfit: 'coat', outfitColor: '#5a5560', accessory: 'none' } },

  // ── 第 4 层 · 富豪圈 ──
  { id: 't4_xie', name: '谢临舟', tier: 4, type: 'money', coef: 1.5, refer: null,
    look: { gender: 'm', hair: 'slick', hairColor: '#b8b8c0', outfit: 'suit', outfitColor: '#20242a', accessory: 'tie' } },
  { id: 't4_ming', name: '明微', tier: 4, type: 'rep', coef: 1.2, refer: null,
    look: { gender: 'f', hair: 'bun', hairColor: '#2b2b33', outfit: 'dress', outfitColor: '#e8e4da', accessory: 'earring' } },
  { id: 't4_cheng', name: '程屹', tier: 4, type: 'money', coef: 1.1, refer: null,
    look: { gender: 'm', hair: 'short', hairColor: '#222222', outfit: 'coat', outfitColor: '#e8e4da', accessory: 'none' } },
  { id: 't4_guan', name: '关鹤年', tier: 4, type: 'aux', coef: 0.9, refer: null,
    look: { gender: 'm', hair: 'buzz', hairColor: '#d0d0d8', outfit: 'coat', outfitColor: '#26292f', accessory: 'none' } },
  { id: 't4_song', name: '宋雨桐', tier: 4, type: 'rep', coef: 1.3, refer: 't5_ji',
    look: { gender: 'f', hair: 'long', hairColor: '#5a3a2a', outfit: 'gown', outfitColor: '#f0ece2', accessory: 'earring' } },
  { id: 't4_baij', name: '白景年', tier: 4, type: 'money', coef: 1.2, refer: null,
    look: { gender: 'm', hair: 'short', hairColor: '#4a4a54', outfit: 'coat', outfitColor: '#2e3a66', accessory: 'none' } },

  // ── 第 5 层 · 顶层圈 ──
  { id: 't5_ji', name: '纪云深', tier: 5, type: 'money', coef: 1.5, refer: null,
    look: { gender: 'm', hair: 'slick', hairColor: '#141419', outfit: 'suit', outfitColor: '#141419', accessory: 'tie' } },
  { id: 't5_wenren', name: '闻人静', tier: 5, type: 'rep', coef: 1.3, refer: null,
    look: { gender: 'f', hair: 'long', hairColor: '#c8c8d4', outfit: 'gown', outfitColor: '#3a2a52', accessory: 'earring' } },
  { id: 't5_shen', name: '沈聿', tier: 5, type: 'money', coef: 1.4, refer: null,
    look: { gender: 'm', hair: 'short', hairColor: '#1a1a22', outfit: 'suit', outfitColor: '#1c1c26', accessory: 'tie' } },
  { id: 't5_nan', name: '南绪', tier: 5, type: 'aux', coef: 1.0, refer: null,
    look: { gender: 'f', hair: 'pony', hairColor: '#8a5aa0', outfit: 'gown', outfitColor: '#26242e', accessory: 'none' } },
  { id: 't5_mu', name: '慕兰', tier: 5, type: 'rep', coef: 1.4, refer: null,
    look: { gender: 'f', hair: 'bun', hairColor: '#9a9aa8', outfit: 'dress', outfitColor: '#4a3568', accessory: 'earring' } },
  { id: 't5_duan', name: '段崇山', tier: 5, type: 'money', coef: 1.5, refer: null,
    look: { gender: 'm', hair: 'buzz', hairColor: '#c0c0cc', outfit: 'suit', outfitColor: '#101014', accessory: 'tie' } }
];

globalThis.NPC_BY_ID = {};
globalThis.NPCS.forEach((n) => { globalThis.NPC_BY_ID[n.id] = n; });

if (typeof module !== 'undefined') module.exports = globalThis.NPCS;
