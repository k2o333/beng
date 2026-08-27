// 数值表 v2：来源 docs/drafts/alpha/02-numbers.md（v1 基线）+ alpha2/01/02/05/06/07/08
// 未标注的变化项全部沿用 v1；管理后台可调参数的权威默认值见 SETTINGS_DEFAULT。
// alpha3 追加：职业/业务（career-numbers-mini）、天赋网（04-skills）、宠物（06-pets）
// 数值口径源：docs/drafts/alpha3/{career-numbers-mini,growth-evolution-mini}.md
// alpha4 追加（存档契约 v3→v4，00-iteration-plan §维护约定）：掉落保底（03 §S3）、宠物三阶（03 §S4）、成就二阶（03 §S5）
globalThis.BALANCE = {
  SAVE_VERSION: 4,

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
  // alpha4 校准：1.7→1.27——旧指数把 taste 0→50 定价在 7×10¹³ 金（T5 硬墙，sim 20/20 卡死）；
  // 1.27 下 0→25≈22 万、0→50≈8700 万，与重定标后的中后期收入匹配，弃坑点后移至 lv26（仍晚于 T3）
  ATTR_COST_GROWTH: 1.24,

  AUX_BONUS_PER: 0.05,
  AUX_BONUS_CAP: 0.5,

  OFFLINE_CAP_H: 12,
  OFFLINE_AUX_BONUS_H: 1.5,
  OFFLINE_AUX_CAP_H: 12,
  OFFLINE_FAVOR_RATE: 0.5,

  // alpha4 校准（D1 目标反推）：restraint 是好感主摩擦，×8~10 抬升把首资产推入 1~2 日窗；
  // rep/fee 重定标让声望手札流与圈层费在目标区间 binding（原值在掉落洪水下形同虚设）
  // alpha4 校准 iter2：restraint 再抬一档（T1 ×1.6）+ 体力行动经济收紧（regen 20→12、互动 10→18），
  // 把「互动刷好感」的前期主泵降速，首资产推入 1~2 日窗；台阶比 ~×1.2 保持圈层节奏递进
  TIERS: [
    { id: 1, name: '职场圈', rep: 0,     fee: 0,          taste: 0,  mult: 1,    restraint: 24, color: '#5b6b8c' },
    { id: 2, name: '精英圈', rep: 500,   fee: 40000,      taste: 0,  mult: 2.5,  restraint: 26, color: '#3d4f8a' },
    { id: 3, name: '名流圈', rep: 3200,  fee: 400000,     taste: 10, mult: 6,    restraint: 31, color: '#a03e4e' },
    { id: 4, name: '富豪圈', rep: 12000, fee: 6000000,    taste: 25, mult: 15,   restraint: 36, color: '#3fa080' },
    { id: 5, name: '顶层圈', rep: 32000, fee: 55000000,   taste: 50, mult: 40,   restraint: 42, color: '#e8c46a' }
  ],

  BASE_OUTPUT: { money: 1.0, rep: 0.35, aux: 0.15 }, // v1 口径金/秒（掉落期望锚点，07 §1.2）

  MILESTONE_GOLD: { 1: 300, 2: 750, 3: 1800, 4: 4500, 5: 12000 },
  MILESTONE_REP: { 1: 8, 2: 20, 3: 55, 4: 140, 5: 360 },
  FULL_REP: { 1: 5, 2: 10, 3: 27, 4: 70, 5: 180 },
  // alpha4 D2：REP_PASSIVE 已删除——声望唯一用途是圈层准入，被动声望会架空手札掉落（01 §4）

  // alpha4 校准 iter4：T1 列礼品重定价（×2.75~3）——前期「里程碑金+启动资金」的礼物爆发是首资产 0.34 日的
  // 真正驱动（trace 证据：单 chunk 内倾泻全天 perNpc 预算）；高圈层列不动，中后期付费节奏不受影响
  GIFTS: {
    small: { label: '小礼', favor: 4,  cost: { 1: 240, 2: 400, 3: 2000, 4: 10000, 5: 50000 } },
    mid:   { label: '中礼', favor: 10, cost: { 1: 700, 2: 1300, 3: 6500, 4: 33000, 5: 160000 } },
    large: { label: '大礼', favor: 25, cost: { 1: 2200, 2: 4000, 3: 20000, 4: 100000, 5: 500000 } }
  },
  LARGE_TASTE: { 1: 0, 2: 0, 3: 5, 4: 13, 5: 25 },

  // ── 渠道动作（02 §4.1 三条渠道 + 免费池 04 §2.4）──
  // alpha4 校准：固定好感渠道不随 restraint 衰减，原值会把「免费池」抬成前期主泵（首资产 0.09 日的元凶之一），
  // 统一压到 auto 好感的同量级，让矜持重新成为主摩擦
  WECHAT_FAVOR: 0.3,    // 固定值，不受加成
  WECHAT_CD_MIN: 120,   // 每 NPC 冷却（游戏分钟；alpha4 校准 30→120）
  MOMENTS_FAVOR: 0.2,
  MOMENTS_CD_MIN: 120,
  WORKPLACE_FAVOR: 1,
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
  // alpha4 校准 iter6：约会基础好感 +33%（6/15/35 → 8/20/45）——原值让约会在评分序上被同档礼物全面压制，
  // 约会计数器（宠物·暖手/社交成就）饿死（trace：百日 3 次）；价格未动，金/好感比仍由 favorPerYuanRate 统一压低
  SPEND: {
    date: {
      light: { label: '轻约', favor: 8,  base: 'small', mul: 1.5 },
      meal:  { label: '正餐', favor: 20, base: 'mid',   mul: 1.5, unlockFavor: 25 },
      trip:  { label: '远行', favor: 45, base: 'large', mul: 2.5, unlockFavor: 50 }
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
    LETTER_INTERVAL_MUL: 6,        // 手札间隔 ×6（alpha4 校准：×2 时声望在数日内洪水式溢出，圈层门槛失效）
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
    CRIT_MS: 3000,                 // 手动 3 秒内点中 = ×2
    PITY_RARE: 240,                // 累计 240 件物品未出稀有品质 → 下件必稀有（03 §S3 / 开放#7）
    PITY_EQUIP: 120                // func 分支累计 120 次未出装备 → 下次必出装备且品质≥精致（03 §S3 / 开放#7）
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
  WEEK_MS: 7 * 86400000,

  // ── 品质与合成（next-iteration §1）──
  GRADE_RANK: { common: 0, fine: 1, rare: 2 },
  GRADE_TXT: { common: '普通', fine: '精致', rare: '稀有' },
  NEXT_GRADE: { common: 'fine', fine: 'rare' },
  SYNTH: { NEED: 3 },            // N 同品质 → 1 高一档随机物品

  // ── 背包扩容金币坑（next-iteration §4）──
  INV_CAP_UPGRADES: [
    { cost: 50000, cap: 60 },
    { cost: 500000, cap: 70 },
    { cost: 5000000, cap: 80 }
  ],
  AUTOSELL_RATE: 0.3,            // 自动出售折价口径（同 SELL_RATE）

  // ── 账号级被动成就层（next-iteration §2）：成就即被动，永久生效 ──
  ACHIEVEMENTS: [
    { id: 'touch', name: '摸鱼大师', stat: 'totalInteract', goal: 1000,
      desc: '累计线下互动 1000 次', perkText: '全局好感 +3%', flavor: '摸鱼不是懈怠，是给生活留的透气缝。',
      favorMul: 1.03 },
    { id: 'workaholic', name: '全勤打工人', stat: 'totalWorkMs', goal: 100 * 3600000,
      desc: '累计上班 100 游戏小时', perkText: '时薪 +10%', flavor: '全勤没有全勤奖，但时薪记得你。',
      wageMul: 1.1 },
    { id: 'picker', name: '捡漏之王', stat: 'totalLoot', goal: 500,
      desc: '累计拾取掉落 500 件', perkText: '掉落间隔 -5%', flavor: '别人眼里的破烂，是你攒的第一桶金。',
      dropMul: 0.95 },
    { id: 'social', name: '社交悍匪', stat: 'totalDates', goal: 100,
      desc: '累计约会 100 次', perkText: '约会价格 -5%', flavor: '约了一百次，终于不再尬聊。',
      datePriceMul: 0.95 },
    { id: 'networker', name: '人脉广博', stat: 'assets', goal: 10,
      desc: '资产数达到 10', perkText: '体力上限 +20', flavor: '通讯录厚了，腰杆也直了。',
      stamMaxAdd: 20 },
    // ── alpha4 S5 成就二阶（03 §S5）：goal ×5，效果 = 一阶 + 一阶的一半 ──
    { id: 'touch2', name: '摸鱼大师II', stat: 'totalInteract', goal: 5000,
      desc: '累计线下互动 5000 次', perkText: '全局好感 再+2%', flavor: '摸到五千次，茶水间就是你的主场。',
      favorMul: 1.02 },
    { id: 'workaholic2', name: '全勤打工人II', stat: 'totalWorkMs', goal: 500 * 3600000,
      desc: '累计上班 500 游戏小时', perkText: '时薪 再+5%', flavor: '五百个小时，工位比家里的床更认得你。',
      wageMul: 1.05 },
    { id: 'picker2', name: '捡漏之王II', stat: 'totalLoot', goal: 2500,
      desc: '累计拾取掉落 2500 件', perkText: '掉落间隔 再-2.5%', flavor: '两千五百件破烂里，藏着半座金山。',
      dropMul: 0.975 },
    { id: 'social2', name: '社交悍匪II', stat: 'totalDates', goal: 500,
      desc: '累计约会 500 次', perkText: '约会价格 再-2.5%', flavor: '第五百次约会，服务员已经先帮你下单了。',
      datePriceMul: 0.975 },
    { id: 'networker2', name: '人脉广博II', stat: 'assets', goal: 25,
      desc: '资产数达到 25', perkText: '体力上限 再+10', flavor: '二十五位人脉资产，手机通讯录都装不下。',
      stamMaxAdd: 10 }
  ],

  // ══ alpha3 · 行业人脉（career-numbers-mini §3 / alpha3/02）══
  // domain ∈ finance 金融 | estate 地产 | tech 高科技；人脉为派生值不进存档
  DOMAINS: ['finance', 'estate', 'tech'],
  DOMAIN_TXT: { finance: '金融', estate: '地产', tech: '高科技' },
  NETWORK_VALUE: { 1: 2, 2: 4, 3: 7, 4: 11, 5: 16 },   // 按圈层的人脉值
  // 好感里程碑计入比例：≥25 → 30%，≥50 → 60%，≥75 → 100%（v1 不衰减）
  NETWORK_RATIO: [
    { min: 75, ratio: 1.0 },
    { min: 50, ratio: 0.6 },
    { min: 25, ratio: 0.3 }
  ],

  // ══ alpha3 · 打工十级表（T-CAREER，career-numbers-mini §2）══
  // need=累计业务量门槛（万）；rate=提成率；allowance=职级津贴（金/周期）
  // alpha4 校准：need 曲线 ×1.5~×3.6 整形（业务量流速被圈层准入门控后，原表让总裁在 d10 前后即达成）；
  // allowance 高段削减 60~80%——津贴按结单周期发放，后期单流量下会反超提成成为第一收入源（H1 独占风险）
  CAREER_LEVELS: [
    { lv: 1,  title: '副专员', need: 0,      rate: 0.08, allowance: 0 },
    { lv: 2,  title: '专员',   need: 150,    rate: 0.09, allowance: 200 },
    { lv: 3,  title: '副主管', need: 700,    rate: 0.10, allowance: 600 },
    { lv: 4,  title: '主管',   need: 1600,   rate: 0.11, allowance: 1500 },
    { lv: 5,  title: '副经理', need: 4500,   rate: 0.12, allowance: 3000 },
    { lv: 6,  title: '经理',   need: 12000,  rate: 0.13, allowance: 6000 },
    { lv: 7,  title: '副总监', need: 30000,  rate: 0.14, allowance: 15000 },
    { lv: 8,  title: '总监',   need: 90000,  rate: 0.15, allowance: 20000 },
    { lv: 9,  title: '副总裁', need: 400000, rate: 0.16, allowance: 50000 },
    { lv: 10, title: '总裁',   need: 1200000, rate: 0.18, allowance: 120000 }
  ],
  COMMISSION_PER_WAN: 300,     // 提成换算：业务量(万) × 提成率 × mult^0.5 × 本系数 → 金
  BIZ_CYCLE_MIN: 30,           // 业务周期基准 = 现实 30 分钟/单

  // ── 业务模板池 T-BIZ（首版 ~12 条，按圈层解锁：tier n 开 n 组）──
  // reqNet: {domain: 需求人脉}; reqTypes: [{t:'money|rep|aux', n}] 计已知 NPC;
  // reqLevel: 需职级; vol: 基准量(万); workMin: 基准工时(分)
  // alpha4 S6 风险三角：T3 起每圈层恰一条 certainty:'risky'——开工时效率在 [0.7,1.3] 掷（期望中性），
  // 基准量已烘焙 +15% 风险溢价；未标注者隐含 'stable'。
  BIZ_TEMPLATES: [
    { id: 'b_finance_1', name: '散户开户冲量',   tier: 1, domain: 'finance', reqNet: { finance: 6 },   reqTypes: [], reqLevel: 1, vol: 5,    workMin: 20 },
    { id: 'b_estate_1',  name: '社区看房接驳',   tier: 1, domain: 'estate',  reqNet: { estate: 5 },    reqTypes: [], reqLevel: 1, vol: 4,    workMin: 18 },
    { id: 'b_tech_1',    name: '门店系统地推',   tier: 1, domain: 'tech',    reqNet: { tech: 5 },      reqTypes: [], reqLevel: 1, vol: 4,    workMin: 18 },
    { id: 'b_estate_2',  name: '楼盘分销带看',   tier: 2, domain: 'estate',  reqNet: { estate: 10 },   reqTypes: [{ t: 'money', n: 1 }], reqLevel: 2, vol: 25,  workMin: 25 },
    { id: 'b_finance_2', name: '券商开户返佣',   tier: 2, domain: 'finance', reqNet: { finance: 12 },  reqTypes: [], reqLevel: 2, vol: 22,   workMin: 24 },
    { id: 'b_tech_2',    name: 'SaaS 年费续约',  tier: 2, domain: 'tech',    reqNet: { tech: 10 },     reqTypes: [{ t: 'rep', n: 1 }], reqLevel: 2, vol: 20,   workMin: 22 },
    { id: 'b_tech_3',    name: '天使轮跟投',     tier: 3, domain: 'tech',    reqNet: { tech: 14 },     reqTypes: [{ t: 'money', n: 1 }], reqLevel: 4, vol: 120, workMin: 30 },
    { id: 'b_estate_3',  name: '商业地产包销',   tier: 3, domain: 'estate',  reqNet: { estate: 30 },   reqTypes: [{ t: 'money', n: 1 }], reqLevel: 3, vol: 100, workMin: 28 },
    { id: 'b_finance_3', name: '私募代销份额',   tier: 3, domain: 'finance', reqNet: { finance: 35 },  reqTypes: [{ t: 'rep', n: 1 }], reqLevel: 3, vol: 127,  workMin: 30, certainty: 'risky' },
    { id: 'b_finance_4', name: '并购过桥融资',   tier: 4, domain: 'finance', reqNet: { finance: 40 },  reqTypes: [{ t: 'money', n: 2 }], reqLevel: 6, vol: 900, workMin: 35 },
    { id: 'b_estate_4',  name: '地块联合开发',   tier: 4, domain: 'estate',  reqNet: { estate: 60 },   reqTypes: [{ t: 'rep', n: 1 }], reqLevel: 7, vol: 978, workMin: 34, certainty: 'risky' },
    { id: 'b_tech_4',    name: '独角兽轮跟投',   tier: 4, domain: 'tech',    reqNet: { tech: 70 },     reqTypes: [{ t: 'money', n: 1 }], reqLevel: 8, vol: 800, workMin: 32 },
    { id: 'b_finance_5', name: '跨境资产配置',   tier: 5, domain: 'finance', reqNet: { finance: 120 }, reqTypes: [], reqLevel: 8, vol: 2600, workMin: 40 },
    { id: 'b_estate_5',  name: '城市更新基金',   tier: 5, domain: 'estate',  reqNet: { estate: 150 },  reqTypes: [], reqLevel: 9, vol: 2760, workMin: 42, certainty: 'risky' },
    { id: 'b_tech_5',    name: '硬科技并购基金', tier: 5, domain: 'tech',    reqNet: { tech: 180 },    reqTypes: [], reqLevel: 9, vol: 2200, workMin: 45 }
  ],

  // ══ alpha3 · 关系天赋网（04-skills，growth-evolution-mini §1）══
  // layer: pivot 支点(1点) | notable 精华(1点) | cap 大节点(2点，本系投入≥5) | key 基石(1点，同对互斥) | syn 连携(2点，他系门槛)
  // gate: 解锁职级段 —— 1 支点/精华常开 | 6 经理期开连携 | 8 总监期开基石与大节点
  // entries: 注册进 bonuses 的词条；cond 由结算点判定（见 engine COND_FNS）
  SKILLS: {
    branches: { sense: '识人系', social: '社交系', career: '事业系' },
    branchOrder: ['sense', 'social', 'career'],
    respecBase: 20000,
    nodes: {
      // ── 识人系 ──
      i11: { br: 'sense', layer: 'pivot', cost: 1, name: '耳目I', prev: null, gate: 1,
        desc: '识人冷却 -5%', entries: [{ attr: 'identifyCd', kind: 'mul', value: 0.95 }] },
      i12: { br: 'sense', layer: 'pivot', cost: 1, name: '耳目II', prev: 'i11', gate: 1,
        desc: '识人冷却 -5%', entries: [{ attr: 'identifyCd', kind: 'mul', value: 0.95 }] },
      i13: { br: 'sense', layer: 'pivot', cost: 1, name: '察言观色', prev: 'i12', gate: 1,
        desc: '识人好感收益 flat+5', entries: [{ attr: 'identifyFavor', kind: 'flat', value: 5 }] },
      i14: { br: 'sense', layer: 'notable', cost: 1, name: '眼缘', prev: 'i13', gate: 1,
        desc: '初见好感+5（首次入槽生效）', entries: [] },
      // S8：精华位二选一（泛化 choice 机制，cond 由结算点判定）
      i15: { br: 'sense', layer: 'notable', cost: 1, name: '读空气', prev: 'i13', gate: 1, choice: ['read', 'wind'],
        choiceTxt: { read: '读空气·好感+10%', wind: '顺风局·收入+4%' },
        desc: '点亮时二选一：读空气——未揭示第三偏好的 NPC 好感+10%；顺风局——当前单为景气行业时全局收入+4%',
        entries: [],
        choiceEntries: {
          read: [{ attr: 'favorMul', kind: 'mul', value: 1.10, cond: 'thirdHidden' }],
          wind: [{ attr: 'incomeMul', kind: 'mul', value: 1.04, cond: 'boomHot' }]
        } },
      i16: { br: 'sense', layer: 'cap', cost: 2, name: '透视', prevAny: ['i14', 'i15'], gate: 8, needInvest: 5,
        desc: '点亮时情报一次全揭示；之后识人体力耗+50%',
        entries: [{ attr: 'identifyCost', kind: 'mul', value: 1.5 }] },
      // ── 社交系 ──
      s11: { br: 'social', layer: 'pivot', cost: 1, name: '暖人I', prev: null, gate: 1,
        desc: '自动好感+3%', entries: [{ attr: 'favorMul', kind: 'add', value: 0.03 }] },
      s12: { br: 'social', layer: 'pivot', cost: 1, name: '话术', prev: 's11', gate: 1,
        desc: '微信/朋友圈冷却-8%', entries: [{ attr: 'socialCd', kind: 'mul', value: 0.92 }] },
      s13: { br: 'social', layer: 'pivot', cost: 1, name: '暖人II', prev: 's12', gate: 1,
        desc: '自动好感+3%', entries: [{ attr: 'favorMul', kind: 'add', value: 0.03 }] },
      s14: { br: 'social', layer: 'notable', cost: 1, name: '暖场', prev: 's13', gate: 1, choice: ['ice', 'warm'],
        choiceTxt: { ice: '破冰期互动×1.6', warm: '升温期互动×1.4' }, desc: '点亮时二选一强化', entries: [],
        choiceEntries: {
          ice: [{ attr: 'interactMul', kind: 'mul', value: 1.6, cond: 'stageIce' }],
          warm: [{ attr: 'interactMul', kind: 'mul', value: 1.4, cond: 'stageWarm' }]
        } },
      // S8：雪中送炭 ↔ 赴约达人（cond: hasInvite）
      s15: { br: 'social', layer: 'notable', cost: 1, name: '雪中送炭', prev: 's13', gate: 1, choice: ['snow', 'date'],
        choiceTxt: { snow: '雪中送炭·送礼×1.4', date: '赴约达人·好感+4%' },
        desc: '点亮时二选一：雪中送炭——好感<25 的 NPC 送礼效果×1.4；赴约达人——存在有效邀约时好感获取+4%',
        entries: [],
        choiceEntries: {
          snow: [{ attr: 'giftMul', kind: 'mul', value: 1.4, cond: 'favorLt25' }],
          date: [{ attr: 'favorMul', kind: 'mul', value: 1.04, cond: 'hasInvite' }]
        } },
      s16: { br: 'social', layer: 'cap', cost: 2, name: '知心', prevAny: ['s14', 's15'], gate: 8, needInvest: 5,
        desc: '好感上限 100→120；100~120 收网区收益×2', entries: [] },
      // ── 事业系 ──
      c11: { br: 'career', layer: 'pivot', cost: 1, name: '敬业I', prev: null, gate: 1,
        desc: '时薪+5%', entries: [{ attr: 'wageMul', kind: 'add', value: 0.05 }] },
      c12: { br: 'career', layer: 'pivot', cost: 1, name: '提效', prev: 'c11', gate: 1,
        desc: '业务工时-5%', entries: [{ attr: 'bizTime', kind: 'add', value: -0.05 }] },
      c13: { br: 'career', layer: 'pivot', cost: 1, name: '敬业II', prev: 'c12', gate: 1,
        desc: '提成率+1%', entries: [{ attr: 'commissionAdd', kind: 'flat', value: 0.01 }] },
      c14: { br: 'career', layer: 'notable', cost: 1, name: '兼职达人', prev: 'c13', gate: 1,
        desc: '可同时排两份班（在岗工资与体力消耗 ×2）', entries: [] },
      // S8：人脉变现 ↔ 豪赌直觉（cond: riskyRun；变现侧由 commissionRateOf 按变体判定）
      c15: { br: 'career', layer: 'notable', cost: 1, name: '人脉变现', prev: 'c13', gate: 1, choice: ['cash', 'nerve'],
        choiceTxt: { cash: '人脉变现·提成+', nerve: '豪赌直觉·掉落-4%' },
        desc: '点亮时二选一：人脉变现——每位满好感 NPC 提成+0.5%，上限+15%；豪赌直觉——进行中为风险单时掉落间隔-4%',
        entries: [],
        choiceEntries: {
          nerve: [{ attr: 'dropMul', kind: 'mul', value: 0.96, cond: 'riskyRun' }]
        } },
      c16: { br: 'career', layer: 'cap', cost: 2, name: '总裁思维', prevAny: ['c14', 'c15'], gate: 8, needInvest: 5,
        desc: '换单不再清空当前单进度', entries: [] },
      // ── 基石（互斥对，全树每对只能取一侧）──
      k1a: { br: 'sense', layer: 'key', cost: 1, name: '广撒网', pair: 'k1', gate: 8,
        desc: '攻略槽+2 / 全局好感获取-20%',
        entries: [{ attr: 'slotsAdd', kind: 'flat', value: 2 }, { attr: 'favorMul', kind: 'mul', value: 0.8 }] },
      k1b: { br: 'sense', layer: 'key', cost: 1, name: '深耕', pair: 'k1', gate: 8,
        desc: '主目标（首位槽位）好感+40% / 攻略槽-1',
        entries: [{ attr: 'slotsAdd', kind: 'flat', value: -1 }, { attr: 'favorMul', kind: 'mul', value: 1.4, cond: 'mainTarget' }] },
      k2a: { br: 'social', layer: 'key', cost: 1, name: '夜猫子', pair: 'k2', gate: 8,
        desc: '现实 18~24 时金币收益+30% / 日间-10%',
        entries: [{ attr: 'goldWin', kind: 'add', value: 0.3, cond: 'night' }, { attr: 'goldWin', kind: 'add', value: -0.1, cond: 'day' }] },
      k2b: { br: 'social', layer: 'key', cost: 1, name: '日行者', pair: 'k2', gate: 8,
        desc: '日间金币收益+20%（无惩罚但数值低）',
        entries: [{ attr: 'goldWin', kind: 'add', value: 0.2, cond: 'day' }] },
      k3a: { br: 'career', layer: 'key', cost: 1, name: '稳健派', pair: 'k3', gate: 8,
        desc: '业务工时+10% / 效率下限保底 50%',
        entries: [{ attr: 'bizTime', kind: 'add', value: 0.10 }] },
      k3b: { br: 'career', layer: 'key', cost: 1, name: '豪赌派', pair: 'k3', gate: 8,
        desc: '效率无保底 / 满条件时业务量+30%', entries: [] },
      // ── 跨系连携（效果由另一系投入量驱动）──
      y1: { br: 'social', layer: 'syn', cost: 2, name: '情报网', gate: 6, fromBranch: 'social', needOther: 4,
        desc: '社交系投入≥4：每条已揭示情报使当前业务效率+2%，上限+10%', entries: [] },
      y2: { br: 'career', layer: 'syn', cost: 2, name: '跨界联动', gate: 6, fromBranch: 'career', needOther: 4,
        desc: '事业系投入≥4：社交系全部词条效果+25%', entries: [] },
      y3: { br: 'sense', layer: 'syn', cost: 2, name: '名利双收', gate: 6, fromBranch: 'sense', needOther: 4,
        desc: '识人系投入≥4：满好感 NPC 掉落间隔-15%', entries: [] }
    }
  },

  // ══ alpha4 S7 · Build 预设（03 §S7）：一键点亮该流派合法节点子集，剩余自由点留给玩家 ══
  // nodes 为有序 id 列表；applyBuildPreset 沿序尝试 takeSkill（点数/前置/互斥/门槛全走同一校验），
  // 带 choice 的节点默认取第一项。每套 ≤12 ids。
  SKILL_PRESETS: {
    net:  { name: '广撒网流', nodes: ['i11', 'i12', 'i13', 'i14', 'i15', 'k1a', 'y3'] },
    deep: { name: '深耕流',   nodes: ['s11', 's12', 's13', 's14', 's15', 's16', 'k1b'] },
    rush: { name: '跑单流',   nodes: ['c11', 'c12', 'c13', 'c14', 'c15', 'c16', 'k2b'] }
  },

  // ══ 宠物（06-pets，TBH 四定理：永久/无需上阵/可叠加/越早越值）══
  // alpha4 S4 三阶成长（03 §S4）：阈值 ×1/×3/×10，效果线性递增；stages[0] 即旧版解锁档
  PETS: [
    { id: 'nuanshou', name: '伙伴·暖手', stat: 'totalDates', icon: '🐱',
      // ⚠ D6 二修（待拍板）：原 200/600/2000 在校准后经济下结构性不可达——totalDates 只计付费约会（engine.spendDate），
      // 预算与价格使可约会池仅限 T1/T2 且 NPC 转资产后窗口永久关闭；sim 证据：standard 百日 P50≈20 次、上限≈36
      // （docs/reports/alpha4-h1h6-conclusions.md §H6 附录）。新阶梯按实测 P50/P75 定标。
      stages: [
        { goal: 8, condTxt: '累计约会 8 次', perkText: '全局好感 +5%',
          entries: [{ attr: 'favorMul', kind: 'mul', value: 1.05 }] },
        { goal: 16, condTxt: '累计约会 16 次', perkText: '全局好感 +8%',
          entries: [{ attr: 'favorMul', kind: 'mul', value: 1.08 }] },
        { goal: 24, condTxt: '累计约会 24 次', perkText: '全局好感 +12%',
          entries: [{ attr: 'favorMul', kind: 'mul', value: 1.12 }] }
      ] },
    { id: 'zhangfang', name: '伙伴·账房', stat: 'totalWorkMs', icon: '🦜',
      stages: [
        { goal: 100 * 3600000, condTxt: '累计上班 100 小时', perkText: '全局金币收入 +8%',
          entries: [{ attr: 'incomeMul', kind: 'mul', value: 1.08 }] },
        { goal: 300 * 3600000, condTxt: '累计上班 300 小时', perkText: '全局金币收入 +12%',
          entries: [{ attr: 'incomeMul', kind: 'mul', value: 1.12 }] },
        { goal: 1000 * 3600000, condTxt: '累计上班 1000 小时', perkText: '全局金币收入 +16%',
          entries: [{ attr: 'incomeMul', kind: 'mul', value: 1.16 }] }
      ] },
    { id: 'shihuang', name: '伙伴·拾荒', stat: 'totalLoot', icon: '🐶',
      stages: [
        { goal: 500, condTxt: '累计拾取掉落 500 件', perkText: '掉落间隔 -6%',
          entries: [{ attr: 'dropMul', kind: 'mul', value: 0.94 }] },
        { goal: 1500, condTxt: '累计拾取掉落 1500 件', perkText: '掉落间隔 -9%',
          entries: [{ attr: 'dropMul', kind: 'mul', value: 0.91 }] },
        { goal: 5000, condTxt: '累计拾取掉落 5000 件', perkText: '掉落间隔 -12%',
          entries: [{ attr: 'dropMul', kind: 'mul', value: 0.88 }] }
      ] }
  ],

  IDENTIFY_CD_MIN: 360,       // 识人冷却基准（游戏分）
  IDENTIFY_STAMINA_COST: 12   // 识人体力基准
};

// ── 管理后台可配置项默认值（01 §2.2 权威定义）──
globalThis.SETTINGS_DEFAULT = {
  // 体力组（alpha4 校准 iter2：行动经济收紧——互动刷好感是模拟中前期第一泵，regen/单价双收紧）
  staminaRegenPerMin: 12,
  staminaMax: 100,
  interactStaminaCost: 30,
  wechatStaminaCost: 3,
  workplaceInteractCost: 6,
  offlineRegen: true,
  // 时间组
  timeScale: 1.0,
  offlineCapHours: 12,
  offlineFavorRate: 0.5,
  // 经济组
  startGold: 10000,
  dropIntervalRate: 2.0,   // 倍率，越小掉越勤（alpha4 校准 ×2：掉落洪水是早期 20× 超速主因之一）
  dropValueRate: 0.08,     // alpha4 校准：金包期望 3600×coef/时 → ~288/时，掉落降级为风味副收入，经济主泵交还业务/工资
  itemDropChance: 1.0,     // 物品分支占比缩放
  equipDropRate: 0.08,     // 功能分支中装备类的占比（alpha3/05，掉率透明红线：后台可调）
  rareItemRate: 0.03,
  priceRate: 1.0,          // 消费项目/属性/槽位全局物价
  favorPerYuanRate: 0.35,  // alpha4 校准：付费好感 ×0.35——金币→好感直换太强会绕过矜持曲线
  workWageRate: 1.0,
  tipChance: 0.12,
  // 自动攻略组（决策器输入）
  decisionIntervalSec: 5,
  spendStyle: 'standard',  // frugal|standard|generous|lavish
  dailyBudget: 26000,      // 0=不限（alpha4 校准 20000→26000：给远行档留出与礼物并存的预算空间）
  perNpcBudget: 6000,      // 0=不限（alpha4 校准 5000→6000：让 T1 远行档重新进入预算，约会计数器不再饿死）
  milestonePushWeight: 1.5,
  autoSlotOrder: 'off',    // off|output|refer|reputation
  invitePolicy: 'auto',    // auto|ask
  scoreAlpha: 0.02,
  scoreBeta: 1.0,
  // 界面组
  autoPickup: true,
  notifyLevel: 'all',      // all|milestone|mute
  decisionLogDepth: 50,
  // 背包自动出售阈值（next-iteration §4.1）：off|common|fine
  autoSellGrade: 'off',
  // 职业与业务组（career-numbers-mini §7 总旋钮）
  bizSpeed: 1.0,             // 业务工时缩放（越小跑单越快）
  bizThresholdMul: 1.0,      // 升职门槛缩放
  networkGainMul: 1.0,       // 人脉获取倍率
  commissionScale: 1.0,      // 提成率缩放
  careerMode: 'employee',    // 打工|创业（创业依赖三维关系，后置；暂仅 employee 生效）
  identifyCdMin: 360,        // 识人冷却（游戏分）
  identifyStaminaCost: 12,   // 识人体力
  respecBase: 20000,         // 洗点单价：已投点数 × base × (1+已洗次数)，首次免费
  // alpha4 Wave3 追加（03 §S1/S2，参数需 sim 复核）
  boomEnabled: true,         // S1 行业景气轮换总开关
  boomScale: 0.2,            // 景气：业务量与人脉计入 +20%
  boomLowScale: 0.15,        // 低谷：业务量与人脉计入 -15%
  boomWeights: [30, 45, 25], // S1 周切三态累计权重 [景气, 平稳, 低谷]
  decayEnabled: false        // S2 关系衰减 Lite（实验特性·默认关闭·TBH 教训：放置游戏不惩罚离线）
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
