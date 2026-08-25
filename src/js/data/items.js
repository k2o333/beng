// 物品表 v2 首批 12 件（alpha2/07 §2）
// quality: common 普通 | fine 精致(效果×1.5) | rare 稀有(唯一效果)
// effect.kind:
//   favor_random   随机一名槽内 NPC +favor
//   stamina        体力 +amt
//   send_favor     可送任意 NPC +favor（send 类）
//   buff_date      24h 内约会价格 ×rate
//   rep            声望 +2×层倍率/10（向上取整，最少 1）
//   free_date      免费约会（tier: light 固定轻约 / auto 自动匹配档位变体）
//   buff_attr      下一次属性升级 ×rate
//   favor_all      全部槽内 NPC +favor
//   send_gift      等效礼物送出（size 档位，免费，可攒）（send 类）
//   unlock_next    解锁一名未结识的上一层 NPC
globalThis.ITEMS = [
  { id: 'milk_tea_coupon', label: '心动奶茶券', quality: 'common', icon: '🧋', sell: 20,
    effect: { kind: 'favor_random', favor: 3 }, desc: '随机一名槽内 NPC 好感 +3' },
  { id: 'energy_coffee', label: '体力咖啡', quality: 'common', icon: '🥤', sell: 30,
    effect: { kind: 'stamina', amt: 30 }, desc: '体力 +30' },
  { id: 'souvenir', label: '纪念品', quality: 'common', icon: '🎀', sell: 25,
    effect: { kind: 'send_favor', favor: 2 }, desc: '可送任意 NPC，好感 +2' },
  { id: 'card_holder', label: '商务名片夹', quality: 'common', icon: '📇', sell: 40,
    effect: { kind: 'buff_date', rate: 0.8, hours: 24 }, desc: '24 小时内约会价格 8 折' },
  { id: 'intel_brief', label: '内部简报', quality: 'common', icon: '📰', sell: 35,
    effect: { kind: 'rep' }, desc: '声望 +2（按圈层放大）' },
  { id: 'handwritten_invite', label: '手写请柬', quality: 'fine', icon: '✉️', sell: 150,
    effect: { kind: 'free_date', tier: 'light' }, desc: '指定 NPC 免费轻约一次' },
  { id: 'double_ticket', label: '双人展票', quality: 'fine', icon: '🎟️', sell: 180,
    effect: { kind: 'free_date', tier: 'auto' }, desc: '触发一次免费约会（自动匹配偏好）' },
  { id: 'taste_album', label: '品味画册', quality: 'fine', icon: '🖼️', sell: 160,
    effect: { kind: 'buff_attr', rate: 0.5 }, desc: '下一次属性升级 5 折' },
  { id: 'surprise_cake', label: '惊喜蛋糕', quality: 'fine', icon: '🍰', sell: 170,
    effect: { kind: 'favor_all', favor: 2 }, desc: '全部槽内 NPC 好感 +2' },
  { id: 'gift_box', label: '礼物盒', quality: 'fine', icon: '🎁', sell: 220,
    effect: { kind: 'send_gift', size: 'mid' }, desc: '当作中礼送出（免费，可攒）' },
  { id: 'referral_card', label: '引荐名片', quality: 'rare', icon: '💼', sell: 800,
    effect: { kind: 'unlock_next' }, desc: '解锁一名未结识的上一层 NPC' },
  { id: 'limited_collectible', label: '限量藏品', quality: 'rare', icon: '💎', sell: 1500,
    effect: { kind: 'send_gift', size: 'large' }, desc: '等效大礼的礼物，送出带专属文案' }
];

globalThis.ITEM_BY_ID = {};
globalThis.ITEMS.forEach((it) => { globalThis.ITEM_BY_ID[it.id] = it; });

if (typeof module !== 'undefined') module.exports = globalThis.ITEMS;
