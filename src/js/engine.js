// 核心引擎 v2（纯逻辑，浏览器与 node 共用）
// 规则来源：docs/drafts/alpha/01-systems.md（v1 基线）+ docs/drafts/alpha2/01~08
// 契约：docs/dev/v2-api.md §1 存档 schema、§2 API 与事件 shapes
(function () {
  const B = globalThis.BALANCE;

  // ── 随机工具（所有随机入口接受可选 rng）──
  const rnd = (rng) => (rng ? rng() : Math.random());
  const rand = (rng, a, b) => a + rnd(rng) * (b - a);
  const irand = (rng, a, b) => Math.floor(rand(rng, a, b + 1));
  const pick = (rng, arr) => arr[Math.floor(rnd(rng) * arr.length)];

  function mergeSettings(raw) {
    const s = Object.assign({}, globalThis.SETTINGS_DEFAULT);
    if (raw) for (const k in s) if (raw[k] !== undefined) s[k] = raw[k];
    return s;
  }

  // ── 存档 ──
  function newState(now) {
    const settings = mergeSettings();
    return {
      v: B.SAVE_VERSION,
      createdAt: now,
      lastSeen: now,
      gt: 0,
      gold: settings.startGold,
      rep: 0,
      stamina: settings.staminaMax,
      attrs: { charm: 0, talk: 0, taste: 0 },
      slotCount: B.SLOTS_INIT,
      slots: ['t1_gu'],          // 开局第一目标自动进槽开攻（00 §4 红线）
      tier: 1,
      npcs: {},                   // id -> { favor, claimed:[], asset, referred }
      seen: {},
      settings,
      customMode: false,
      job: { id: 'restaurant', shiftEndGt: null, resting: false },
      priority: 'work_first',     // work_first | ratio | social_first
      cds: {},                    // id -> { wx, wp, mo } 到期 gt
      errandUsed: {},
      spent: { day: 0, global: 0, npc: {} },
      inv: [],                    // { it, q }
      drops: [],                  // 在线待拾取
      dropSeq: 1,
      lootNext: {},               // assetId -> 下次掉落 gt
      buffs: { dateOffGt: 0, attrHalf: false },
      invites: [],
      hotspot: { day: -1, list: [] },
      intel: {},                  // id -> { third, line, mine }
      weekReturn: {},
      log: [],
      stats: { totalWage: 0, totalInteract: 0, totalWorkMs: 0, totalLoot: 0, totalDates: 0 },
      perks: {},                  // 成就 id -> true（达成即永久被动，next-iteration §2）
      capLevel: 0,                // 背包扩容档位（INV_CAP_UPGRADES 下标，§4）
      // ── alpha3 新增四组字段（存档契约 v3：career/skills/equips/pets）──
      // career.boom：S1 景气三枚举（迁移幂等默认平稳，normBoom 兜底消毒）
      career: { industry: null, level: 1, bizVolumeTotal: 0, currentBiz: null, boomWeek: 0,
        boom: { finance: 'stable', estate: 'stable', tech: 'stable' } },
      skills: { points: 0, nodes: {}, washed: 0 },   // nodes: nodeId -> true | 'ice'|'warm'（暖场二选一）
      equips: { watch: null, jewel: null },          // slot -> {it,q}|null
      // ── alpha4 存档契约 v4（00 §5，D7 合并迁移）：loot 保底 / pets 三阶表 / 景气占位 / 试洗券 ──
      loot: { pityRare: 0, pityEquip: 0 },           // S3 掉落保底计数（03 §S3）
      pets: {},                                      // S4 宠物 id -> 阶段 int 1..3（03 §S4）
      wash: { vouchers: 0, tierDone: 0 }             // S7 试洗券占位（每圈层首通一张，半价）
    };
  }

  // ── v4 结构兜底：loot 保底 / pets 阶段表 / 景气枚举 / 试洗券（幂等，迁移与规范化共用）──
  function normLoot(raw) {
    if (!raw.loot || typeof raw.loot !== 'object') raw.loot = {};
    raw.loot.pityRare = (typeof raw.loot.pityRare === 'number' && raw.loot.pityRare >= 0)
      ? Math.floor(raw.loot.pityRare) : 0;
    raw.loot.pityEquip = (typeof raw.loot.pityEquip === 'number' && raw.loot.pityEquip >= 0)
      ? Math.floor(raw.loot.pityEquip) : 0;
  }
  function normPets(raw) {
    const legacy = raw.pets && typeof raw.pets === 'object' && Array.isArray(raw.pets.unlocked)
      ? raw.pets.unlocked : null;                        // 旧档 unlocked[] → 映射一阶（00 §5）
    const out = {};
    const add = (id, s) => {
      const def = B.PETS.find((p) => p.id === id);
      if (!def || !isFinite(s)) return;                  // 白名单外 / 非法值剔除
      out[id] = Math.max(1, Math.min(def.stages.length, Math.floor(s)));   // 阶段钳到 1..3
    };
    if (legacy) legacy.forEach((id) => add(id, 1));
    else if (raw.pets && typeof raw.pets === 'object') {
      for (const id in raw.pets) add(id, Math.floor(Number(raw.pets[id])));
    }
    raw.pets = out;
  }
  const BOOM_STATES = ['stable', 'boom', 'low'];
  // alpha4 校准重定基键（02 §4 只动旋钮；旧档未自定义时随 v3→v4 迁移对齐新默认）
  const CALIBRATED_KEYS = ['staminaRegenPerMin', 'interactStaminaCost', 'wechatStaminaCost',
    'dropIntervalRate', 'dropValueRate', 'favorPerYuanRate', 'dailyBudget', 'perNpcBudget'];
  function normBoom(raw) {
    if (!raw.career.boom || typeof raw.career.boom !== 'object') raw.career.boom = {};
    const b = raw.career.boom;
    B.DOMAINS.forEach((d) => { if (BOOM_STATES.indexOf(b[d]) < 0) b[d] = 'stable'; });   // 枚举白名单，缺省平稳
    // S1 周切游标（Wave3 新字段，幂等补齐；不 bump SAVE_VERSION）
    raw.career.boomWeek = (typeof raw.career.boomWeek === 'number' && raw.career.boomWeek >= 0)
      ? Math.floor(raw.career.boomWeek) : 0;
  }
  function normWash(raw) {
    if (!raw.wash || typeof raw.wash !== 'object') raw.wash = {};
    raw.wash.vouchers = (typeof raw.wash.vouchers === 'number' && raw.wash.vouchers >= 0)
      ? Math.floor(raw.wash.vouchers) : 0;
    raw.wash.tierDone = (typeof raw.wash.tierDone === 'number' && raw.wash.tierDone >= 0)
      ? Math.floor(raw.wash.tierDone) : 0;
  }

  // ── 存档字段规范化：缺省补齐、非法值剔除（幂等，旧字段不动）──
  function normalizeState(raw) {
    if (!raw.career || typeof raw.career !== 'object') raw.career = {};
    const c = raw.career;
    c.industry = B.DOMAINS.indexOf(c.industry) >= 0 ? c.industry : null;
    c.level = (typeof c.level === 'number' && c.level >= 1) ? Math.min(10, Math.floor(c.level)) : 1;
    c.bizVolumeTotal = (typeof c.bizVolumeTotal === 'number' && c.bizVolumeTotal >= 0) ? c.bizVolumeTotal : 0;
    if (!c.currentBiz || typeof c.currentBiz !== 'object' || !B.BIZ_TEMPLATES.some((t) => t.id === c.currentBiz.tplId)) c.currentBiz = null;
    normBoom(raw);
    if (!raw.skills || typeof raw.skills !== 'object') raw.skills = {};
    const sk = raw.skills;
    sk.points = (typeof sk.points === 'number' && sk.points >= 0) ? sk.points : 0;
    sk.washed = (typeof sk.washed === 'number' && sk.washed >= 0) ? sk.washed : 0;
    if (!sk.nodes || typeof sk.nodes !== 'object') sk.nodes = {};
    const clean = {};
    const pairTaken = {};
    for (const id in sk.nodes) {
      const nd = B.SKILLS.nodes[id];
      if (!nd) continue;                                   // 未知节点剔除
      if (nd.pair) {                                       // 同对基石互斥：只保留先到的一侧
        if (pairTaken[nd.pair]) continue;
        pairTaken[nd.pair] = id;
      }
      clean[id] = sk.nodes[id];
    }
    sk.nodes = clean;
    if (!raw.equips || typeof raw.equips !== 'object') raw.equips = {};
    const eq = raw.equips;
    ['watch', 'jewel'].forEach((slot) => {
      const cur = eq[slot];
      const okEq = cur && globalThis.ITEM_BY_ID[cur.it]
        && globalThis.ITEM_BY_ID[cur.it].effect.kind === 'equip'
        && globalThis.ITEM_BY_ID[cur.it].effect.slot === slot
        && B.GRADE_RANK[cur.q] != null;
      eq[slot] = okEq ? { it: cur.it, q: cur.q } : null;
    });
    normPets(raw);
    normLoot(raw);
    normWash(raw);
    for (const id in raw.npcs) {                           // Wave3 衰减钩子位：只消毒不补发
      const o = raw.npcs[id];
      // 非法 lastActGt 统一回落 raw.gt（与 migrate v3 分支/decayPass 回落口径一致，避免 0 视作「从未互动」）
      if (o && o.lastActGt !== undefined && (typeof o.lastActGt !== 'number' || !(o.lastActGt >= 0))) o.lastActGt = raw.gt || 0;
    }
    delete raw._bCache; delete raw._bSig;                  // 聚合缓存不入档
    raw.v = B.SAVE_VERSION;
    return raw;
  }

  // v1 -> v2 迁移（保留进度字段，其余按新档初始化）；v2/v3/v4 共用 normalize 补齐。
  // alpha4 D7：v3 分支做 v3→v4 合并迁移（00-iteration-plan §5），随后与 v2 同链路走 normalize。
  function migrate(raw) {
    try {
      if (!raw || typeof raw !== 'object') return null;
      if (raw.v === 1) {
        const st = newState(raw.createdAt || Date.now());
        st.lastSeen = raw.lastSeen || Date.now();
        st.gold = typeof raw.gold === 'number' ? raw.gold : st.gold;
        st.rep = raw.rep || 0;
        st.stamina = typeof raw.stamina === 'number' ? raw.stamina : st.stamina;
        if (raw.attrs) st.attrs = Object.assign(st.attrs, raw.attrs);
        st.slotCount = raw.slotCount || st.slotCount;
        st.slots = Array.isArray(raw.slots) ? raw.slots.filter((id) => globalThis.NPC_BY_ID[id]) : st.slots;
        st.tier = raw.tier || 1;
        if (raw.npcs) {
          for (const id in raw.npcs) {
            const o = raw.npcs[id];
            st.npcs[id] = { favor: o.favor || 0, claimed: o.claimed || [], asset: !!o.asset, referred: !!o.referred, met: true };
          }
        }
        if (raw.seen) st.seen = raw.seen;
        return normalizeState(st);
      }
      if (raw.v !== 2 && raw.v !== 3 && raw.v !== B.SAVE_VERSION) return null;
      if (raw.v === 3) {
        // ── v3 → v4 合并迁移（一次做完）：pity 计数 + 宠物三阶表 + 景气占位 + 试洗券占位 ──
        normPets(raw);                                     // pets.unlocked[] → {id: stage:1}
        normLoot(raw);
        if (!raw.career || typeof raw.career !== 'object') raw.career = {};
        normBoom(raw);                                     // career.boom 三枚举默认平稳（03 §S1 占位）
        normWash(raw);
        for (const id in raw.npcs) {                       // 衰减钩子（03 §S2，Wave3 启用）
          const o = raw.npcs[id];
          if (o && typeof o.lastActGt !== 'number') o.lastActGt = raw.gt || 0;
        }
        // 校准重定基（alpha4 ③）：平衡旋钮随版本走，否则旧档带着 alpha3 节奏玩不到校准曲线。
        // 玩家真正自定义过（customMode=true）则保留其值；customMode 由下方默认补齐，先读原始值。
        if (!raw.customMode) {
          CALIBRATED_KEYS.forEach((k) => { raw.settings[k] = SETTINGS_DEFAULT[k]; });
        }
      }
      raw.settings = mergeSettings(raw.settings);
      if (!Array.isArray(raw.inv)) raw.inv = [];
      else raw.inv.forEach((e) => { if (typeof e.n !== 'number' || !(e.n > 0)) e.n = 1; });   // 堆叠模型：旧条目按 n=1
      if (!Array.isArray(raw.drops)) raw.drops = [];
      if (!raw.hotspot) raw.hotspot = { day: -1, list: [] };
      raw.customMode = !!raw.customMode;
      if (!raw.stats || typeof raw.stats !== 'object') raw.stats = {};
      ['totalWage', 'totalInteract', 'totalWorkMs', 'totalLoot', 'totalDates'].forEach((k) => {
        if (typeof raw.stats[k] !== 'number') raw.stats[k] = 0;    // 旧档缺字段按 0 计
      });
      if (!raw.perks || typeof raw.perks !== 'object') raw.perks = {};
      if (typeof raw.capLevel !== 'number' || !(raw.capLevel >= 0)) raw.capLevel = 0;
      // 已有关系的 NPC 标记「已结识」，避免眼缘对老目标补发初见好感
      for (const id in raw.npcs) {
        const o = raw.npcs[id];
        if (o && typeof o.met !== 'boolean') o.met = !!(o.asset || (o.favor > 0) || (Array.isArray(o.claimed) && o.claimed.length));
      }
      return normalizeState(raw);
    } catch (e) { return null; }
  }

  function npc(state, id) {
    if (!state.npcs[id]) {
      // lastActGt：S2 关系衰减 Lite 的互动计时锚点（新关系从当下起算）
      state.npcs[id] = { favor: 0, claimed: [], asset: false, referred: false, met: false, lastActGt: state.gt };
    }
    return state.npcs[id];
  }

  // ── 查询 ──
  const tierDef = (t) => B.TIERS[t - 1];
  const tierOpen = (state, t) => t <= state.tier;

  function statusOf(state, def) {
    const s = state.npcs[def.id];
    if (s && s.asset) return 'asset';
    if (state.slots.indexOf(def.id) >= 0) return 'courting';
    if (tierOpen(state, def.tier) || (s && s.referred)) return 'available';
    return 'locked';
  }

  function auxAssets(state) {
    let c = 0;
    for (const id in state.npcs) {
      const def = globalThis.NPC_BY_ID[id];
      if (state.npcs[id].asset && def && def.type === 'aux') c++;
    }
    return c;
  }
  function auxBonus(state) {
    return Math.min(B.AUX_BONUS_CAP, auxAssets(state) * B.AUX_BONUS_PER);
  }

  // ── 成就被动（next-iteration §2）──
  function assetCount(state) {
    let c = 0;
    for (const id in state.npcs) if (state.npcs[id].asset) c++;
    return c;
  }
  function statValue(state, key) {
    return key === 'assets' ? assetCount(state) : (state.stats[key] || 0);
  }
  function checkAchievements(state, events) {
    events = events || [];
    for (const a of B.ACHIEVEMENTS) {
      if (state.perks[a.id]) continue;
      if (statValue(state, a.stat) >= a.goal) {
        state.perks[a.id] = true;
        events.push({ t: 'ach', id: a.id, name: a.name, perkText: a.perkText });
        invalidateBonuses(state);
      }
    }
    checkPetsUnlocked(state, events);   // 宠物与成就同一检查时机（06-pets）
  }

  // ══ bonuses 聚合器（alpha3/01 数值底座）══
  // 所有来源（成就 perks / 天赋网 / 装备 / 宠物 / 职业）只注册词条 {attr, kind: flat|add|mul, cond?}，
  // 结算点统一取值：final = (base + Σflat) × (1 + min(Σadd, +100%cap)) × 连乘mul。
  // add 封顶：同类总上限 +100%，超出部分按条转独立 mul（08-numbers-map §5 护栏）。
  // 存档只存来源数据，词条表可随时重算（_bCache 挂内存，迁移时剔除）。
  const BONUS_ADD_CAP = 1.0;

  // 条件词条判定表（cond 由结算点传入 ctx 自行判定）
  const COND_FNS = {
    thirdHidden: (st, c) => !!(c.def && c.def.third && !(st.intel[c.def.id] || {}).third),
    favorLt25: (st, c) => typeof c.favor === 'number' && c.favor < B.MILESTONES[0],
    mainTarget: (st, c) => !!c.isMain,
    night: (st, c) => { const h = hoursOf(c.nowReal); return h >= 18 && h < 24; },
    day: (st, c) => { const h = hoursOf(c.nowReal); return h >= 6 && h < 18; },
    stageIce: (st, c) => c.stageKey === 'ice',
    stageWarm: (st, c) => c.stageKey === 'warm',
    // ── alpha4 S8 cond 扩容（03 §S8）：天赋网与景气/风险系统产生联系维耦合 ──
    boomHot: (st) => {                       // 当前进行中业务的行业处于景气（随总开关一并失效）
      const tpl = currentBizTpl(st);
      return !!(tpl && st.settings.boomEnabled) && boomOf(st, tpl.domain) === 'boom';
    },
    hasInvite: (st) => (st.invites || []).length > 0,
    riskyRun: (st) => {                      // 进行中的是风险单（S6）
      const tpl = currentBizTpl(st);
      return !!tpl && tpl.certainty === 'risky';
    }
  };
  function hoursOf(nowReal) { return new Date(nowReal || Date.now()).getHours(); }

  // ══ alpha4 Wave3 · S1 行业景气轮换（03 §S1）：只改产量口径，无随机失败 ══
  function boomOf(state, domain) {
    const b = state.career && state.career.boom;
    return (b && BOOM_STATES.indexOf(b[domain]) >= 0) ? b[domain] : 'stable';
  }
  // 业务量 / 人脉计入共用同一组数值：景气 1+boomScale · 平稳 1 · 低谷 1-boomLowScale；总开关关闭全归一
  function boomMulRaw(state, domain) {
    const S = state.settings || globalThis.SETTINGS_DEFAULT;
    if (!S.boomEnabled) return 1;
    const st = boomOf(state, domain);
    if (st === 'boom') return 1 + (Number(S.boomScale) || 0);
    if (st === 'low') return 1 - (Number(S.boomLowScale) || 0);
    return 1;
  }
  const boomVolMulOf = boomMulRaw;
  const boomNetMulOf = boomMulRaw;
  function currentBizTpl(state) {
    const cbz = state.career && state.career.currentBiz;
    return cbz ? B.BIZ_TEMPLATES.find((t) => t.id === cbz.tplId) || null : null;
  }
  // 周切掷骰：floor(gt/WEEK_MS) 前移时逐域按累计权重掷新态（[w0 景气, w0+w1 平稳, 其余 低谷]）；
  // 关闭时同样推进游标但不掷不发（防重开后补爆）。日志落一行角标（00 §6 决策可读性对策）。
  function rollBoomIfDue(state, rng) {
    const week = Math.floor(state.gt / B.WEEK_MS);
    if ((state.career.boomWeek || 0) >= week) return [];
    state.career.boomWeek = week;
    if (!state.career.boom || typeof state.career.boom !== 'object') state.career.boom = {};
    if (!state.settings.boomEnabled) return [];
    const w = Array.isArray(state.settings.boomWeights) ? state.settings.boomWeights : [30, 45, 25];
    const total = Math.max(1, w[0] + w[1] + w[2]);
    const changes = [];
    B.DOMAINS.forEach((d) => {
      const r = rnd(rng);
      // 累计权重公式（数值 skill 数列表）：r 归一化到权重总和比对
      const to = r < w[0] / total ? 'boom' : (r < (w[0] + w[1]) / total ? 'stable' : 'low');
      if (state.career.boom[d] !== to) { state.career.boom[d] = to; changes.push({ domain: d, to }); }
    });
    const mark = { boom: '↑', stable: '—', low: '↓' };
    const txt = '本周景气：' + B.DOMAINS.map((d) => B.DOMAIN_TXT[d] + mark[boomOf(state, d)]).join(' ');
    logPush(state, txt);
    return [{ t: 'boom', txt, changes }];
  }

  function hasSkill(state, id) { return !!state.skills.nodes[id]; }

  // 本系已投入点数（大节点门槛 / 连携软协同读取）
  function branchInvested(state, br) {
    let n = 0;
    for (const id in state.skills.nodes) {
      const nd = B.SKILLS.nodes[id];
      if (nd && nd.br === br) n += nd.cost;
    }
    return n;
  }

  // 缓存签名：来源数据任一变化（perks/nodes/points/装备/宠物/职级）自动重建，防外部直改漏失效
  function bonusSig(state) {
    return Object.keys(state.perks).sort().join(',') + '#'
      + Object.keys(state.skills.nodes).sort().map((k) => k + ':' + state.skills.nodes[k]).join(',') + '#'
      + state.skills.points + '#'
      + (state.equips.watch ? state.equips.watch.it + ':' + state.equips.watch.q : '-') + '#'
      + (state.equips.jewel ? state.equips.jewel.it + ':' + state.equips.jewel.q : '-') + '#'
      + Object.keys(state.pets).sort().map((k) => k + ':' + state.pets[k]).join(',') + '#'   // S4：id:阶段 序列化
      + state.career.level;
  }
  function bonusEntriesOf(state) {
    const sig = bonusSig(state);
    if (state._bCache && state._bSig === sig) return state._bCache;
    const es = [];
    // ① 成就 perks 平移接入
    for (const a of B.ACHIEVEMENTS) {
      if (!state.perks[a.id]) continue;
      if (a.favorMul) es.push({ src: 'perk', attr: 'favorMul', kind: 'mul', value: a.favorMul });
      if (a.wageMul) es.push({ src: 'perk', attr: 'wageMul', kind: 'mul', value: a.wageMul });
      if (a.dropMul) es.push({ src: 'perk', attr: 'dropMul', kind: 'mul', value: a.dropMul });
      if (a.datePriceMul) es.push({ src: 'perk', attr: 'datePriceMul', kind: 'mul', value: a.datePriceMul });
      if (a.stamMaxAdd) es.push({ src: 'perk', attr: 'staminaMax', kind: 'flat', value: a.stamMaxAdd });
    }
    // ② 天赋网节点（以茶会友：事业系≥4 时社交系全部词条效果+25%）
    const teaBoost = hasSkill(state, 'y2') && branchInvested(state, 'career') >= B.SKILLS.nodes.y2.needOther;
    const boostVal = (e) => e.kind === 'mul' ? 1 + (e.value - 1) * 1.25 : e.value * 1.25;
    for (const id in state.skills.nodes) {
      const nd = B.SKILLS.nodes[id];
      if (!nd) continue;
      let entries = nd.entries;
      // S8 泛化二选一：存档值即 choice key（'ice'|'warm' 等任意键，词条表挂 choiceEntries）
      if (nd.choiceEntries) {
        const key = state.skills.nodes[id];
        entries = (key && nd.choiceEntries[key]) || [];
      }
      for (const e of entries) {
        const v = (teaBoost && nd.br === 'social') ? boostVal(e) : e.value;
        es.push(Object.assign({}, e, { src: 'skill', br: nd.br, value: v }));
      }
    }
    // ③ 装备槽 ×2（品质放大沿用 fine×1.5 / rare×2）
    ['watch', 'jewel'].forEach((slot) => {
      const cur = state.equips[slot];
      if (!cur) return;
      const it = globalThis.ITEM_BY_ID[cur.it];
      if (!it || it.effect.kind !== 'equip') return;
      const qMul = cur.q === 'fine' ? 1.5 : (cur.q === 'rare' ? 2 : 1);
      for (const e of it.effect.entries) {
        es.push(Object.assign({}, e, { src: 'equip', value: e.value * qMul }));
      }
    });
    // ④ 宠物（解锁即永久全局生效；S4 三阶取当前阶段词条）
    for (const p of B.PETS) {
      const stage = state.pets[p.id] || 0;
      if (!stage) continue;
      for (const e of p.stages[stage - 1].entries) es.push(Object.assign({}, e, { src: 'pet' }));
    }
    state._bCache = es;
    state._bSig = sig;
    return es;
  }
  function invalidateBonuses(state) { delete state._bCache; }

  function bonusParts(state, attr, ctx) {
    ctx = ctx || {};
    let flat = 0, mul = 1;
    const adds = [];
    for (const e of bonusEntriesOf(state)) {
      if (e.attr !== attr) continue;
      if (e.cond && !(COND_FNS[e.cond] || (() => false))(state, ctx)) continue;
      if (e.kind === 'flat') flat += e.value;
      else if (e.kind === 'add') adds.push(e.value);
      else mul *= e.value;
    }
    let pool = 0;   // add 同类封顶 +100%（按值降序填充，混排时与注册顺序无关）
    adds.sort((a, b) => b - a);
    for (const v of adds) {
      const room = BONUS_ADD_CAP - pool;
      if (v <= room) pool += v;
      else { pool = BONUS_ADD_CAP; mul *= 1 + Math.max(0, v - room); }   // 超出部分转独立 mul
    }
    return { flat, pool, mul };
  }
  // 完整口径：(base+Σflat) × (1+min(Σadd,cap)) × Πmul
  function bonusOf(state, attr, base, ctx) {
    const p = bonusParts(state, attr, ctx);
    return (base + p.flat) * (1 + p.pool) * p.mul;
  }
  // 只读乘区（不含 flat）
  function bonusMulOf(state, attr, ctx) {
    const p = bonusParts(state, attr, ctx);
    return (1 + p.pool) * p.mul;
  }
  // 只读加区
  function bonusFlatOf(state, attr, ctx) {
    return bonusParts(state, attr, ctx).flat;
  }

  // 金币收益的时段/宠物乘区（夜猫子·晨型人窗口 + 账房 incomeMul）
  function incomeFactors(state, nowReal) {
    return bonusMulOf(state, 'incomeMul') * bonusMulOf(state, 'goldWin', { nowReal });
  }

  function staminaMaxOf(state) {
    const base = Number(state.settings.staminaMax) || B.STAMINA_MAX;
    return base + bonusFlatOf(state, 'staminaMax');
  }

  function autoFavorPerMin(state, def) {
    const t = tierDef(def.tier);
    return 0.5 * (1 + B.ATTR_EFFECT * state.attrs.charm) / t.restraint * (1 + auxBonus(state));
  }
  function interactGain(state, def) {
    return autoFavorPerMin(state, def) * 5 * (1 + B.ATTR_EFFECT * state.attrs.talk);
  }

  // 好感上限（知心：100→120）
  function favorCapOf(state) {
    return B.FAVOR_MAX + (hasSkill(state, 's16') ? 20 : 0);
  }
  // 有效攻略槽（广撒网+2 / 深耕-1 叠加在已购槽位上）
  function slotCapOf(state) {
    return Math.max(1, Math.min(9, state.slotCount + bonusFlatOf(state, 'slotsAdd')));
  }

  // 资产产出期望（v1 口径金/秒；掉落系统的期望锚点，07 §1.2）
  function expectedIncomePerSec(state) {
    let sum = 0;
    for (const id in state.npcs) {
      const s = state.npcs[id];
      const def = globalThis.NPC_BY_ID[id];
      if (s && s.asset && def) sum += B.BASE_OUTPUT[def.type] * tierDef(def.tier).mult * def.coef;
    }
    return sum;
  }

  // attrCost(level[, priceRate])：UI 显示与扣费共用；priceRate 缺省取全局默认
  function attrCost(level, priceRate) {
    const pr = priceRate == null ? globalThis.SETTINGS_DEFAULT.priceRate : priceRate;
    return Math.round(B.ATTR_BASE_COST * Math.pow(B.ATTR_COST_GROWTH, level) * pr);
  }

  // ── 阶段（04 §2.2）──
  function stageOf(favor) {
    let cur = B.STAGES[0];
    for (const s of B.STAGES) if (favor >= s.min) cur = s;
    return cur;
  }

  // ── 好感与里程碑 ──
  // grantFavor 统一走 favorMul 乘区（alpha3/01）；渠道固定好感（微信等「不受加成」）经 noBonus 跳过
  function grantFavor(state, def, amount, events, opts) {
    const s = npc(state, def.id);
    if (s.asset || !(amount > 0)) return 0;
    const offMul = state._offMul || 1;
    let amt = amount * offMul;
    // 知心收网区：好感 100~120 收益×2（溢出转收网效率）
    if (hasSkill(state, 's16') && s.favor >= B.FAVOR_MAX) amt *= 2;
    if (!(opts && opts.noBonus)) {
      amt *= bonusMulOf(state, 'favorMul', {
        def, favor: s.favor,
        isMain: state.slots.length > 0 && state.slots[0] === def.id
      });
    }
    const before = s.favor;
    const prevStage = stageOf(before).key;
    const cap = favorCapOf(state);
    s.favor = Math.min(cap, s.favor + amt);
    for (const m of B.MILESTONES) {
      if (before < m && s.favor >= m && s.claimed.indexOf(m) < 0) {
        s.claimed.push(m);
        if (def.type === 'rep') {
          state.rep += B.MILESTONE_REP[def.tier];
          events.push({ t: 'milestone', id: def.id, m, kind: 'rep', amount: B.MILESTONE_REP[def.tier] });
        } else {
          state.gold += B.MILESTONE_GOLD[def.tier];
          events.push({ t: 'milestone', id: def.id, m, kind: 'gold', amount: B.MILESTONE_GOLD[def.tier] });
        }
      }
    }
    const newStage = stageOf(s.favor).key;
    if (newStage !== prevStage) {
      events.push({ t: 'stage', id: def.id, from: prevStage, to: newStage });
    }
    if (s.favor >= cap) toAsset(state, def, events);
    checkAchievements(state, events);
    return s.favor - before;
  }

  function toAsset(state, def, events) {
    const s = npc(state, def.id);
    if (s.asset) return;
    s.asset = true;
    state.slots = state.slots.filter((x) => x !== def.id);
    delete state.lootNext[def.id];   // 掉落计时由 step 的资产扫描重建
    const repAmt = B.FULL_REP[def.tier] * (def.type === 'rep' ? 2 : 1);
    state.rep += repAmt;
    events.push({ t: 'full', id: def.id, rep: repAmt });
    if (def.refer) {
      const r = npc(state, def.refer);
      const rdef = globalThis.NPC_BY_ID[def.refer];
      if (rdef && !r.asset && !r.referred) {
        r.referred = true;
        events.push({ t: 'refer', id: def.refer, by: def.id });
      }
    }
  }

  // ── 工作与时间 ──
  function dayIndex(state) { return Math.floor(state.gt / B.DAY_MS); }

  function onDuty(state) {
    return !!(state.job && state.job.id && state.job.shiftEndGt != null && state.gt < state.job.shiftEndGt);
  }

  function wagePerSec(state, nowReal) {
    const j = state.job;
    if (!j || !j.id) return 0;
    const def = B.JOBS[j.id];
    let w = def.wage * state.settings.workWageRate / 3600;
    w *= bonusMulOf(state, 'wageMul');          // 全勤打工人 / 敬业I
    w *= incomeFactors(state, nowReal);         // 账房 + 夜猫子·晨型人时段窗口
    if (hasSkill(state, 'c14')) w *= 2;         // 兼职达人：同时两份班
    if (j.id === 'restaurant') {
      const h = hoursOf(nowReal);
      if (h >= B.EVENING_HOURS[0] && h < B.EVENING_HOURS[1]) w *= def.eveningMul;
    }
    return w;
  }

  function shiftInfo(state, nowReal) {
    const j = state.job || {};
    const on = onDuty(state);
    return {
      jobId: j.id || null,
      onDuty: on,
      resting: !!j.resting,
      endInMs: on ? Math.max(0, j.shiftEndGt - state.gt) : 0,
      wagePerSec: on ? wagePerSec(state, nowReal) : 0
    };
  }

  function hireJob(state, jobId) {
    const def = B.JOBS[jobId];
    if (!def) return { ok: false, msg: '无此工作' };
    if (def.unlockAssets && auxAssets(state) < def.unlockAssets) {
      return { ok: false, msg: '需累计资产 ≥' + def.unlockAssets };
    }
    stopShift(state);
    state.job = { id: jobId, shiftEndGt: null, resting: false };
    return { ok: true };
  }
  function quitJob(state) {
    stopShift(state);
    state.job = { id: null, shiftEndGt: null, resting: false };
    return { ok: true };
  }
  function startShift(state, hours, nowReal) {
    if (!state.job.id) return { ok: false, msg: '先入职一份工作' };
    if (B.SHIFT_H.indexOf(hours) < 0) return { ok: false, msg: '班次时长无效' };
    state.job.resting = false;
    state.job.shiftEndGt = state.gt + hours * 3600000;
    return { ok: true };
  }
  function stopShift(state) {
    if (state.job) { state.job.shiftEndGt = null; state.job.resting = false; }
    return { ok: true };
  }

  // ── 渠道冷却 ──
  function cdOf(state, id) {
    if (!state.cds[id]) state.cds[id] = { wx: 0, wp: 0, mo: 0, id: 0 };
    return state.cds[id];
  }

  function channelAct(state, id, kind, nowReal) {
    const def = globalThis.NPC_BY_ID[id];
    if (!def || statusOf(state, def) !== 'courting') return { ok: false, msg: '需先放入攻略槽' };
    const S = state.settings;
    const cd = cdOf(state, id);
    const conf = {
      wechat: { cd: B.WECHAT_CD_MIN, cost: S.wechatStaminaCost, favor: B.WECHAT_FAVOR, key: 'wx', duty: null },
      moments: { cd: B.MOMENTS_CD_MIN, cost: 0, favor: B.MOMENTS_FAVOR, key: 'mo', duty: null },
      workplace: { cd: B.WORKPLACE_CD_MIN, cost: S.workplaceInteractCost, favor: B.WORKPLACE_FAVOR, key: 'wp', duty: true }
    }[kind];
    if (conf.duty === true && !onDuty(state)) return { ok: false, msg: '职场互动需在岗时段' };
    if (conf.duty === false && onDuty(state)) return { ok: false, msg: '在岗时段只能动嘴' };
    if (cd[conf.key] > state.gt) return { ok: false, msg: '冷却中' };
    if (state.stamina < conf.cost) return { ok: false, msg: '体力不足' };
    state.stamina -= conf.cost;
    const cdMin = kind === 'wechat' || kind === 'moments'
      ? conf.cd * bonusMulOf(state, 'socialCd')      // 话术：微信/朋友圈冷却-8%
      : conf.cd;
    cd[conf.key] = state.gt + cdMin * 60000;
    const events = [];
    // 渠道固定好感不受加成（02 §4.1）
    const gain = grantFavor(state, def, conf.favor, events, { noBonus: true });
    npc(state, id).lastActGt = state.gt;   // S2：渠道互动也算互动（防挂机焦虑）
    return { ok: true, gain, events };
  }
  const wechat = (st, id) => channelAct(st, id, 'wechat');
  const moments = (st, id) => channelAct(st, id, 'moments');
  const workplace = (st, id, now) => channelAct(st, id, 'workplace', now);

  // ── 识人（alpha3/04 识人系宿主动作）：读一条隐藏情报，附小额好感 ──
  function identify(state, id, nowReal, rng) {
    const def = globalThis.NPC_BY_ID[id];
    if (!def || statusOf(state, def) !== 'courting') return { ok: false, msg: '需先放入攻略槽' };
    const intel = state.intel[id] || {};
    const missing = ['third', 'line', 'mine'].filter((k) => !intel[k]);
    if (!missing.length) return { ok: false, msg: '他的底细你早已看透' };
    if (onDuty(state)) return { ok: false, msg: '在岗时段只能动嘴' };
    const cd = cdOf(state, id);
    if (cd.id > state.gt) return { ok: false, msg: '识人冷却中' };
    const cost = Math.max(1, Math.round(state.settings.identifyStaminaCost * bonusMulOf(state, 'identifyCost')));
    if (state.stamina < cost) return { ok: false, msg: '体力不足' };
    state.stamina -= cost;
    const cdMs = state.settings.identifyCdMin * bonusMulOf(state, 'identifyCd') * 60000;
    cd.id = state.gt + cdMs;
    const k = pick(rng, missing);
    if (!state.intel[id]) state.intel[id] = {};
    state.intel[id][k] = true;
    const events = [];
    let txt;
    if (k === 'third') txt = '识人：' + def.name + ' 还有隐藏偏好「' + def.third + '」';
    else if (k === 'mine') txt = '识人：雷区——' + def.name + ' 不喜欢「' + def.mine + '」';
    else {
      const rd = def.refer ? globalThis.NPC_BY_ID[def.refer] : null;
      txt = '识人：' + def.name + ' 的引荐线索——' + (rd ? '经由 ' + rd.name : '多出席本层场合可偶遇');
    }
    events.push({ t: 'item', txt });
    logPush(state, txt);
    const gain = grantFavor(state, def, bonusFlatOf(state, 'identifyFavor') + 2, events);
    npc(state, id).lastActGt = state.gt;   // S2 识人互动刷新衰减锚点
    return { ok: true, gain, events };
  }

  // 透视（i16）：点亮瞬间全揭示「已结识」NPC 的隐藏信息
  function revealAllIntel(state, events) {
    events = events || [];
    let n = 0;
    for (const def of globalThis.NPCS) {
      if (statusOf(state, def) === 'locked') continue;
      if (!state.npcs[def.id] && state.slots.indexOf(def.id) < 0) continue;   // 只揭示已结识（有来往记录或正在攻略）的对象
      if (!state.intel[def.id]) state.intel[def.id] = {};
      ['third', 'line', 'mine'].forEach((k) => {
        if (!state.intel[def.id][k]) { state.intel[def.id][k] = true; n++; }
      });
    }
    if (n > 0) {
      logPush(state, '透视：全场底细一览无余（揭示 ' + n + ' 条）');
      events.push({ t: 'item', txt: '透视：全场底细一览无余（揭示 ' + n + ' 条）' });
    }
    return n;
  }

  function interact(state, id, nowReal) {
    const def = globalThis.NPC_BY_ID[id];
    if (!def || statusOf(state, def) !== 'courting') return { ok: false, msg: '需先放入攻略槽' };
    if (onDuty(state)) return { ok: false, msg: '在岗时段只能动嘴' };
    const cost = state.settings.interactStaminaCost;
    if (state.stamina < cost) return { ok: false, msg: '体力不足' };
    state.stamina -= cost;
    const events = [];
    const stageKey = stageOf(npc(state, def.id).favor).key;
    // 暖场（s14）：破冰期互动×1.6 / 升温期互动×1.4
    const gain = grantFavor(state, def, interactGain(state, def)
      * bonusMulOf(state, 'interactMul', { stageKey }), events);
    state.stats.totalInteract++;
    npc(state, def.id).lastActGt = state.gt;   // S2 互动计时重置
    checkAchievements(state, events);
    return { ok: true, gain, events };
  }

  // ── 预算护栏（05 §4，手动与决策器共用）──
  function overLine(state, id) {
    const S = state.settings;
    const g = S.dailyBudget > 0 && state.spent.global >= S.dailyBudget;
    const n = S.perNpcBudget > 0 && (state.spent.npc[id] || 0) >= S.perNpcBudget;
    return g || n;
  }
  function budgetLeftGlobal(state) {
    const b = state.settings.dailyBudget;
    return b <= 0 ? Infinity : Math.max(0, b - state.spent.global);
  }
  function budgetLeftNpc(state, id) {
    const b = state.settings.perNpcBudget;
    return b <= 0 ? Infinity : Math.max(0, b - (state.spent.npc[id] || 0));
  }
  function recordSpend(state, id, cost) {
    state.spent.global += cost;
    state.spent.npc[id] = (state.spent.npc[id] || 0) + cost;
  }

  // ── 消费项目（05）──
  function priceOf(state, kind, size, tier, variantIdx) {
    const S = state.settings;
    let p;
    if (kind === 'gift') p = B.GIFTS[size].cost[tier] * S.priceRate;
    else if (kind === 'errand') p = B.GIFTS.large.cost[tier] * B.SPEND.errand.mul * S.priceRate;
    else {
      const d = B.SPEND.date[size];
      p = B.GIFTS[d.base].cost[tier] * d.mul * S.priceRate;
      if (state.gt < state.buffs.dateOffGt) p *= 0.8;   // 商务名片夹 8 折
      p *= bonusMulOf(state, 'datePriceMul');           // 社交悍匪被动
    }
    return Math.max(1, Math.round(p));
  }

  // 匹配窗口：两 tag + 情报揭示的第三偏好；雷区强制错配（08 §6）
  function matchTags(state, def, tags) {
    const intel = state.intel[def.id] || {};
    const window = def.tags.slice();
    if (intel.third && def.third) window.push(def.third);
    const hit = (tags || []).some((t) => window.indexOf(t) >= 0);
    const mine = !!(intel.mine && def.mine && (tags || []).indexOf(def.mine) >= 0);
    return { hit, mine, coef: mine ? B.SPEND.MATCH_DOWN : (hit ? B.SPEND.MATCH_UP : B.SPEND.MATCH_DOWN) };
  }

  function hotspotHit(state, tags) {
    const day = dayIndex(state);
    if (state.hotspot.day !== day) return false;
    return state.hotspot.list.some((h) => (tags || []).some((t) => h.tags.indexOf(t) >= 0));
  }

  function favorOf(state, def, kind, size, variantIdx) {
    const S = state.settings;
    let f;
    if (kind === 'gift') f = B.GIFTS[size].favor;
    else if (kind === 'errand') f = B.SPEND.errand.favor;
    else {
      f = B.SPEND.date[size].favor;
      const v = B.SPEND.VARIANTS[size][variantIdx || 0];
      const m = matchTags(state, def, v.tags);
      f *= m.coef;
      if (hotspotHit(state, v.tags)) f *= B.DATE.HOTSPOT_FAVOR;
    }
    return f * S.favorPerYuanRate;
  }

  // 最佳匹配变体索引（UI 角标与决策器共用）
  function bestVariantIdx(state, def, size) {
    let bi = 0, bs = -1;
    B.SPEND.VARIANTS[size].forEach((v, i) => {
      const m = matchTags(state, def, v.tags);
      const sc = (m.mine ? -1 : 0) + m.coef + (hotspotHit(state, v.tags) ? 1 : 0);
      if (sc > bs) { bs = sc; bi = i; }
    });
    return bi;
  }

  function spendGift(state, id, size, nowReal, rng) {
    const def = globalThis.NPC_BY_ID[id];
    if (!def || statusOf(state, def) !== 'courting') return { ok: false, msg: '需先放入攻略槽' };
    if (size === 'large' && state.attrs.taste < B.LARGE_TASTE[def.tier]) {
      return { ok: false, msg: '品味不足，送不出手' };
    }
    if (overLine(state, id)) return { ok: false, msg: '今日预算已用完' };
    const cost = priceOf(state, 'gift', size, def.tier);
    if (state.gold < cost) return { ok: false, msg: '金币不足' };
    state.gold -= cost;
    recordSpend(state, id, cost);
    const events = [];
    // 雪中送炭（s15）：好感<25 送礼效果×1.4
    const giftMul = bonusMulOf(state, 'giftMul', { favor: npc(state, id).favor });
    const gain = grantFavor(state, def, favorOf(state, def, 'gift', size) * giftMul, events);
    npc(state, id).lastActGt = state.gt;   // S2 互动计时重置
    if (size === 'large') maybeReturnGift(state, def, rng, events);
    return { ok: true, cost, gain, events };
  }

  function spendErrand(state, id, nowReal, rng) {
    const def = globalThis.NPC_BY_ID[id];
    if (!def || statusOf(state, def) !== 'courting') return { ok: false, msg: '需先放入攻略槽' };
    if (state.errandUsed[id]) return { ok: false, msg: '每人限一次' };
    if (npc(state, id).favor < B.SPEND.errand.unlockFavor) return { ok: false, msg: '好感 ≥75 解锁' };
    if (overLine(state, id)) return { ok: false, msg: '今日预算已用完' };
    const cost = priceOf(state, 'errand', null, def.tier);
    if (state.gold < cost) return { ok: false, msg: '金币不足' };
    state.gold -= cost;
    recordSpend(state, id, cost);
    state.errandUsed[id] = true;
    const events = [];
    const gain = grantFavor(state, def, favorOf(state, def, 'errand'), events);
    npc(state, id).lastActGt = state.gt;   // S2 互动计时重置
    maybeReturnGift(state, def, rng, events);
    return { ok: true, cost, gain, events };
  }

  function spendDate(state, id, kind, variantIdx, nowReal, rng) {
    const dd = B.SPEND.date[kind];
    if (!dd || !B.SPEND.VARIANTS[kind]) return { ok: false, msg: '无此约会项目' };
    const def = globalThis.NPC_BY_ID[id];
    if (!def || statusOf(state, def) !== 'courting') return { ok: false, msg: '需先放入攻略槽' };
    if (dd.unlockFavor && npc(state, id).favor < dd.unlockFavor) return { ok: false, msg: '好感 ≥' + dd.unlockFavor + ' 解锁' };
    if (onDuty(state)) return { ok: false, msg: '在岗时段只能动嘴' };
    if (overLine(state, id)) return { ok: false, msg: '今日预算已用完' };
    const cost = priceOf(state, 'date', kind, def.tier, variantIdx);
    if (state.gold < cost) return { ok: false, msg: '金币不足' };
    state.gold -= cost;
    recordSpend(state, id, cost);
    const events = [];
    const gain = resolveDate(state, def, kind, variantIdx, false, rng, events);
    npc(state, id).lastActGt = state.gt;   // S2 互动计时重置
    if (kind === 'trip') maybeReturnGift(state, def, rng, events);
    state.stats.totalDates++;
    checkAchievements(state, events);
    return { ok: true, cost, gain, events };
  }

  // 约会结算核心（付费/免费邀约/物品免单 共用）：基础好感 × 事件倍率
  function resolveDate(state, def, kind, variantIdx, free, rng, events) {
    const vi = (variantIdx == null) ? bestVariantIdx(state, def, kind) : variantIdx;
    const v = B.SPEND.VARIANTS[kind][vi];
    const m = matchTags(state, def, v.tags);
    let base = B.SPEND.date[kind].favor * m.coef * state.settings.favorPerYuanRate;
    const hot = hotspotHit(state, v.tags);
    if (hot) base *= B.DATE.HOTSPOT_FAVOR;
    const ev = rollDateEvent(state, def, { matched: m.hit, hotspot: hot, free: !!free }, rng);
    events.push({ t: 'date', id: def.id, key: ev.key, label: ev.label, mult: ev.mul });
    const gain = grantFavor(state, def, base * ev.mul, events);
    return gain;
  }

  // ── 约会事件表（08 §2）──
  function rollDateEvent(state, def, ctx, rng) {
    const S = state.settings;
    const rolls = B.DATE.EVENTS.map((e) => {
      let w = e.w;
      if (ctx.matched && e.key === 'surprise') w *= 2;
      if (ctx.hotspot && B.DATE.POSITIVE.indexOf(e.key) >= 0) w *= 2;
      if (S.spendStyle === 'lavish' && B.DATE.POSITIVE.indexOf(e.key) >= 0) w *= 1.2;
      return { e, w };
    });
    let total = rolls.reduce((a, r) => a + r.w, 0);
    let r = rnd(rng) * total;
    let chosen = rolls[0].e;
    for (const rr of rolls) { r -= rr.w; if (r <= 0) { chosen = rr.e; break; } }
    const out = { key: chosen.key, label: chosen.label, mul: chosen.mul };
    const events = [];
    if (chosen.item) {
      const itemId = pick(rng, ['milk_tea_coupon', 'souvenir', 'card_holder', 'energy_coffee', 'double_ticket']);
      const it = globalThis.ITEM_BY_ID[itemId];
      invAdd(state, itemId, 'common', rng);
      out.item = itemId;
      events.push({ t: 'item', txt: '惊喜时刻：获得 ' + it.label });
    }
    if (chosen.intel) revealIntel(state, rng, events);
    out.events = events;
    return out;
  }

  // 情报揭示（08 §6）：三选一随机揭示已结识 NPC 的隐藏信息（不占背包）
  function revealIntel(state, rng, events) {
    events = events || [];
    const cands = [];
    for (const def of globalThis.NPCS) {
      const st = statusOf(state, def);
      if (st === 'locked') continue;
      const intel = state.intel[def.id] || {};
      const missing = ['third', 'line', 'mine'].filter((k) => !intel[k]);
      if (missing.length) cands.push({ def, missing });
    }
    if (!cands.length) {
      events.push({ t: 'item', txt: '情报：认识的每个人都被你看透了' });
      return false;
    }
    const c = pick(rng, cands);
    const k = pick(rng, c.missing);
    if (!state.intel[c.def.id]) state.intel[c.def.id] = {};
    state.intel[c.def.id][k] = true;
    let txt;
    if (k === 'third') txt = '情报：' + c.def.name + ' 还有隐藏偏好「' + c.def.third + '」';
    else if (k === 'mine') txt = '情报：雷区——' + c.def.name + ' 不喜欢「' + c.def.mine + '」';
    else {
      const rd = c.def.refer ? globalThis.NPC_BY_ID[c.def.refer] : null;
      txt = '情报：' + c.def.name + ' 的引荐线索——' + (rd ? '经由 ' + rd.name : '多出席本层场合可偶遇');
    }
    logPush(state, txt);
    events.push({ t: 'item', txt });
    return true;
  }

  // ── NPC 回礼（08 §3）：品质+1 档，每游戏周限 1 次 ──
  function maybeReturnGift(state, def, rng, events) {
    events = events || [];
    const week = Math.floor(state.gt / B.WEEK_MS);
    if (state.weekReturn[def.id] === week) return null;
    if (rnd(rng) >= B.DATE.RETURN_CHANCE) return null;
    state.weekReturn[def.id] = week;
    const q = qualityRollWith(state.settings, rng, false);
    const upq = { common: 'fine', fine: 'rare', rare: 'rare' }[q];
    const pool = globalThis.ITEMS.filter((x) => x.effect.kind !== 'equip');   // 回礼不掉装备
    const itemId = pick(rng, pool).id;
    invAdd(state, itemId, upq, rng);
    events.push({ t: 'return', id: def.id, itemId });
    return { it: itemId, q: upq };
  }

  // ── 掉落系统（07；alpha4 S3 透明保底）──
  function qualityRollWith(S, rng, rareBoost) {
    let rare = typeof S.rareItemRate === 'number' ? S.rareItemRate : B.LOOT.QUALITY.rare;
    if (rareBoost) rare *= 2;
    const fine = B.LOOT.QUALITY.fine;
    const r = rnd(rng);
    if (r < rare) return 'rare';
    if (r < rare + fine) return 'fine';
    return 'common';
  }

  // S3 保底簿记（03 §S3）：出装备清装备计数否则 +1；出稀有清稀有计数否则 +1。
  // 装备计数只统计 func 分支（03 §S3 口径「func 分支内必出装备」）；item 分支（礼盒/限量）不触碰装备计数。
  // 被保底强制的掉落同样走本口径（强制稀有→清零，强制非稀有装备→稀有计数照加）。
  function pityBookkeep(state, gotEquip, q, isFunc) {
    state.loot.pityEquip = gotEquip ? 0
      : (isFunc ? (state.loot.pityEquip || 0) + 1 : (state.loot.pityEquip || 0));
    state.loot.pityRare = q === 'rare' ? 0 : (state.loot.pityRare || 0) + 1;
  }
  const isEquipItem = (itemId) => {
    const it = globalThis.ITEM_BY_ID[itemId];
    return !!it && it.effect.kind === 'equip';
  };

  // 物品发放统一入口（item/func 分支共用）：品质先掷，再按分支定物品；
  // 装备保底只在 func 分支生效（计数满则跳过 equipDropRate 直接出装备且品质至少精致）；
  // 稀有保底对任何物品分支生效且最高优先。
  function grantLootItem(state, S, type, branch, rng) {
    const auxBoost = type === 'aux';                       // 辅助型稀有权重 ×2 保留
    const isFunc = branch === 'func';
    const forceEquip = isFunc && (state.loot.pityEquip || 0) >= B.LOOT.PITY_EQUIP;
    const forceRare = (state.loot.pityRare || 0) >= B.LOOT.PITY_RARE;
    let itemId, q;
    if (forceEquip) {
      itemId = pick(rng, ['watch_steel', 'jewel_jade']);
      q = qualityRollWith(S, rng, auxBoost);               // 先按正常稀有权重掷一次
      if (q !== 'rare') q = 'fine';                        // 未中稀有也保精致（跳过普通）
    } else {
      q = qualityRollWith(S, rng, auxBoost);
      if (branch === 'item') itemId = rnd(rng) < 0.7 ? 'gift_box' : 'limited_collectible';
      else if (rnd(rng) < (typeof S.equipDropRate === 'number' ? S.equipDropRate : 0.08)) {
        itemId = pick(rng, ['watch_steel', 'jewel_jade']);   // 装备类掉落（alpha3/05，占比后台可调）
      } else {
        itemId = pick(rng, ['milk_tea_coupon', 'energy_coffee', 'souvenir', 'card_holder',
          'intel_brief', 'handwritten_invite', 'double_ticket', 'taste_album', 'surprise_cake']);
      }
    }
    if (forceRare) q = 'rare';                             // 稀有保底覆盖一切品质结果
    pityBookkeep(state, isEquipItem(itemId), q, isFunc);
    return { kind: 'item', itemId, q };
  }

  function lootIntervalMs(state, def, rng) {
    const S = state.settings;
    let iv = B.LOOT.INTERVAL_S[def.tier] * 1000 / def.coef * S.dropIntervalRate;
    iv *= rand(rng, B.LOOT.JITTER[0], B.LOOT.JITTER[1]);
    if (def.type === 'rep') iv *= B.LOOT.LETTER_INTERVAL_MUL;
    iv *= bonusMulOf(state, 'dropMul');   // 捡漏之王 / 伙伴·拾荒
    // 名利双收（y3）：识人系投入≥4 时满好感 NPC 掉落间隔-15%
    if (hasSkill(state, 'y3') && branchInvested(state, 'sense') >= 4
      && state.npcs[def.id] && state.npcs[def.id].asset) iv *= 0.85;
    return iv;
  }

  function rollLoot(state, def, rng) {
    const S = state.settings;
    const type = def.type;
    const table = B.LOOT.CONTENT[type];
    const total = table.reduce((a, x) => a + x[1], 0);
    let r = rnd(rng) * total;
    let branch = table[0][0];
    for (const br of table) { r -= br[1]; if (r <= 0) { branch = br[0]; break; } }
    // itemDropChance 缩放物品分支，未中回落金币包/手札
    const itemish = branch !== 'gold' && branch !== 'letter';
    if (itemish && rnd(rng) > S.itemDropChance) branch = type === 'rep' ? 'letter' : 'gold';

    if (branch === 'gold') {
      const gps = B.BASE_OUTPUT[type] * tierDef(def.tier).mult * def.coef;
      const qty = Math.max(1, Math.round(gps * 3600 * S.dropValueRate * rand(rng, B.LOOT.PACK_JITTER[0], B.LOOT.PACK_JITTER[1])));
      return { kind: 'gold', qty };
    }
    if (branch === 'letter') return { kind: 'letter', qty: B.LOOT.LETTER_REP[def.tier] };
    if (branch === 'intel') return { kind: 'intel' };

    return grantLootItem(state, S, type, branch, rng);   // item/func 分支统一走保底口径
  }

  // ── 背包（堆叠模型 {it,q,n}，next-iteration §3.3.1；容量/自动出售 §4）──
  function invCap(state) {
    const lv = Math.min(B.INV_CAP_UPGRADES.length, state.capLevel || 0);
    return lv > 0 ? B.INV_CAP_UPGRADES[lv - 1].cap : B.LOOT.INV_CAP;
  }
  function buyInvCap(state) {
    const lv = state.capLevel || 0;
    if (lv >= B.INV_CAP_UPGRADES.length) return { ok: false, msg: '背包已达最大扩容' };
    const up = B.INV_CAP_UPGRADES[lv];
    if (state.gold < up.cost) return { ok: false, msg: '金币不足（需 ' + fmtMoney(up.cost) + '）' };
    state.gold -= up.cost;
    state.capLevel = lv + 1;
    return { ok: true, msg: '背包扩容至 ' + up.cap + ' 格', cap: up.cap };
  }
  function autoSellRank(state) {
    const g = state.settings.autoSellGrade;
    return (g === 'common' || g === 'fine') ? B.GRADE_RANK[g] : -1;   // off → -1
  }
  function sellUnitPrice(it) {
    return Math.max(1, Math.round(it.sell * B.LOOT.SELL_RATE));
  }

  // 入包：同 id 同品质并堆（上限 99），满格按品质挤最旧，稀有永不自动消失
  function invAdd(state, itemId, q, n, rng) {
    n = (typeof n === 'number' && n > 0) ? Math.floor(n) : 1;
    void rng;
    const rank = B.GRADE_RANK;
    const grade = q || 'common';
    let left = n;
    // 先并入已有堆
    for (const e of state.inv) {
      if (e.it === itemId && e.q === grade && (e.n || 1) < 99) {
        const take = Math.min(99 - (e.n || 1), left);
        e.n = (e.n || 1) + take;
        left -= take;
        if (left <= 0) return true;
      }
    }
    while (left > 0) {
      if (state.inv.length >= invCap(state)) {
        // 满：挤掉品质不高于新物的最旧一件
        let squeezed = false;
        for (let i = 0; i < state.inv.length; i++) {
          if (rank[state.inv[i].q] <= rank[grade]) {
            state.inv.splice(i, 1);
            squeezed = true;
            break;
          }
        }
        if (!squeezed) return false;
      }
      const take = Math.min(99, left);
      state.inv.push({ it: itemId, q: grade, n: take });
      left -= take;
    }
    return true;
  }

  function spawnDrop(state, def, roll) {
    const d = { uid: state.dropSeq++, id: def.id, kind: roll.kind, bornReal: Date.now() };
    if (roll.kind === 'item') { d.itemId = roll.itemId; d.q = roll.q; }
    if (roll.qty != null) d.qty = roll.qty;
    state.drops.push(d);
    return d;
  }

  function collectDrop(state, uid, crit, rng) {
    const i = state.drops.findIndex((d) => d.uid === uid);
    if (i < 0) return { ok: false, msg: '掉落物不存在' };
    const d = state.drops.splice(i, 1)[0];
    const events = [];
    let txt = '';
    if (d.kind === 'gold') {
      // 账房 incomeMul：全局金币收入口径含掉落金包
      const amt = Math.round(d.qty * (crit ? 2 : 1) * bonusMulOf(state, 'incomeMul'));
      state.gold += amt;
      txt = '+' + fmtMoney(amt) + (crit ? ' 暴击!' : '');
    } else if (d.kind === 'letter') {
      state.rep += d.qty;
      txt = '+' + d.qty + ' 声望';
    } else if (d.kind === 'item') {
      const itDef = globalThis.ITEM_BY_ID[d.itemId];
      const thr = autoSellRank(state);
      if (thr >= B.GRADE_RANK[d.q]) {
        // 品质阈值过滤在前（§4.1）：折价直接入账，不进背包
        const amt = sellUnitPrice(itDef);
        state.gold += amt;
        state.stats.totalLoot++;
        txt = '自动售出 ' + itDef.label + ' +' + amt;
        events.push({ t: 'autosell', txt, itemId: d.itemId, q: d.q, gold: amt });
      } else if (!invAdd(state, d.itemId, d.q, 1, rng)) {
        txt = '背包已满，' + itDef.label + ' 散落了';
      } else {
        state.stats.totalLoot++;
        txt = '获得 ' + itDef.label;
      }
      checkAchievements(state, events);
    } else if (d.kind === 'intel') {
      revealIntel(state, rng, events);
      txt = '获得一条情报';
    }
    events.push({ t: 'collect', txt });
    return { ok: true, events };
  }

  // ── 背包操作 ──
  function sellItem(state, idx, n) {
    const e = state.inv[idx];
    if (!e) return { ok: false, msg: '没有这件物品' };
    const have = e.n || 1;
    const cnt = (typeof n === 'number' && n > 0) ? Math.min(Math.floor(n), have) : have;
    const it = globalThis.ITEM_BY_ID[e.it];
    const gold = sellUnitPrice(it) * cnt;
    if (cnt >= have) state.inv.splice(idx, 1);
    else e.n = have - cnt;
    state.gold += gold;
    return { ok: true, gold, sold: cnt };
  }

  // 3 合 1 升品质（next-iteration §1）：picks=[{i,n}]，Σn=NEED，同品质非稀有
  function synthItems(state, picks, rng) {
    const need = B.SYNTH.NEED;
    if (!Array.isArray(picks) || !picks.length) return { ok: false, msg: '请先选择材料' };
    let total = 0;
    let grade = null;
    for (const p of picks) {
      const e = state.inv[p.i];
      if (!e) return { ok: false, msg: '材料不存在（背包已变化）' };
      const take = Math.max(1, Math.min(e.n || 1, Number(p.n) || (e.n || 1)));
      total += take;
      if (grade === null) grade = e.q;
      else if (e.q !== grade) return { ok: false, msg: '只能合成同品质物品' };
      void take;
    }
    if (total !== need) return { ok: false, msg: '需要恰好 ' + need + ' 件材料' };
    if (grade === 'rare' || B.GRADE_RANK[grade] >= B.GRADE_RANK.rare) return { ok: false, msg: '稀有品质无法再合成' };
    // 原子性预检：完全消耗的材料条目会腾出格子，至少要剩 1 格给产物
    let freed = 0;
    for (const p of picks) {
      const e = state.inv[p.i];
      const take = Math.min(e.n || 1, Number(p.n) || (e.n || 1));
      if (take >= (e.n || 1)) freed++;
    }
    if (invCap(state) - state.inv.length + freed < 1) return { ok: false, msg: '背包已满，先腾出一个空位' };
    // 扣材料：按下标从大到小处理，避免 splice 使后续下标失效
    const sorted = picks.slice().sort((a, b) => b.i - a.i);
    for (const p of sorted) {
      const e = state.inv[p.i];
      const take = Math.min(e.n || 1, Number(p.n) || (e.n || 1));
      const left = (e.n || 1) - take;
      if (left > 0) e.n = left;
      else state.inv.splice(p.i, 1);
    }
    const outQ = B.NEXT_GRADE[grade];
    // 全物品表均匀随机（含 send 类；装备不进合成池——装备只能从掉落获得，防毕业装被刷）
    const pool = globalThis.ITEMS.filter((x) => x.effect.kind !== 'equip');
    const itemId = pick(rng, pool).id;
    invAdd(state, itemId, outQ, 1);
    const itDef = globalThis.ITEM_BY_ID[itemId];
    const txt = '合成出【' + B.GRADE_TXT[outQ] + '】' + itDef.label;
    return { ok: true, gained: { id: itemId, q: outQ }, txt };
  }

  // GM/便捷：自动挑一组可合成的最低档材料
  function findSynthTriple(state) {
    for (const g of ['common', 'fine']) {
      let need = B.SYNTH.NEED;
      const picks = [];
      for (let i = 0; i < state.inv.length && need > 0; i++) {
        const e = state.inv[i];
        if (B.GRADE_RANK[e.q] === B.GRADE_RANK[g]) {
          const take = Math.min(e.n || 1, need);
          picks.push({ i, n: take });
          need -= take;
        }
      }
      if (need === 0) return { grade: g, picks };
    }
    return null;
  }

  function useItem(state, idx, targetId, rng) {
    const e = state.inv[idx];
    if (!e) return { ok: false, msg: '没有这件物品' };
    const it = globalThis.ITEM_BY_ID[e.it];
    const eff = it.effect;
    const mulQ = e.q === 'fine' ? 1.5 : 1;
    const events = [];
    const consume = () => {
      const left = (e.n || 1) - 1;
      if (left > 0) e.n = left;
      else state.inv.splice(idx, 1);
    };

    switch (eff.kind) {
      case 'stamina': {
        state.stamina = Math.min(staminaMaxOf(state), state.stamina + eff.amt * mulQ);
        consume();
        events.push({ t: 'item', txt: it.label + '：体力 +' + Math.round(eff.amt * mulQ) });
        break;
      }
      case 'favor_random': {
        const cands = state.slots.map((id) => globalThis.NPC_BY_ID[id]).filter((d) => d && !npc(state, d.id).asset);
        if (!cands.length) return { ok: false, msg: '没有可用的攻略目标' };
        const def = pick(rng, cands);
        consume();
        const gain = grantFavor(state, def, eff.favor * mulQ, events);
        events.push({ t: 'favor', id: def.id, gain });
        events.push({ t: 'item', txt: it.label + '：' + def.name + ' 好感 +' + (Math.round(gain * 10) / 10) });
        break;
      }
      case 'favor_all': {
        const targets = state.slots.map((id) => globalThis.NPC_BY_ID[id]).filter((d) => d && !npc(state, d.id).asset);
        if (!targets.length) return { ok: false, msg: '没有可用的攻略目标' };
        consume();
        targets.forEach((def) => {
          const gain = grantFavor(state, def, eff.favor * mulQ, events);
          events.push({ t: 'favor', id: def.id, gain });
        });
        events.push({ t: 'item', txt: it.label + '：全员好感 +' + eff.favor });
        break;
      }
      case 'send_favor':
      case 'send_gift': {
        const def = globalThis.NPC_BY_ID[targetId];
        if (!def || statusOf(state, def) !== 'courting') return { ok: false, msg: '选择一名攻略中的对象' };
        consume();
        let favor;
        if (eff.kind === 'send_favor') favor = eff.favor * mulQ;
        else favor = B.GIFTS[eff.size].favor * mulQ;   // 免费等效礼物，large 免品味门槛，不触发回礼
        favor *= bonusMulOf(state, 'giftMul', { favor: npc(state, targetId).favor });   // 雪中送炭
        const gain = grantFavor(state, def, favor, events);
        events.push({ t: 'favor', id: def.id, gain });
        events.push({ t: 'item', txt: '送出 ' + it.label + '：' + def.name + ' 好感 +' + (Math.round(gain * 10) / 10) });
        break;
      }
      case 'free_date': {
        const def = globalThis.NPC_BY_ID[targetId];
        if (!def || statusOf(state, def) !== 'courting') return { ok: false, msg: '选择一名攻略中的对象' };
        if (onDuty(state)) return { ok: false, msg: '在岗时段只能动嘴' };
        consume();
        const kind = eff.tier === 'light' ? 'light'
          : (npc(state, def.id).favor >= 25 ? 'meal' : 'light');
        const gain = resolveDate(state, def, kind, null, true, rng, events);
        events.push({ t: 'item', txt: it.label + '：与 ' + def.name + ' 免费一约' });
        break;
      }
      case 'buff_date': {
        state.buffs.dateOffGt = state.gt + eff.hours * 3600000;
        consume();
        events.push({ t: 'item', txt: it.label + '：约会价格 ' + Math.round(eff.rate * 10) + ' 折（' + eff.hours + 'h）' });
        break;
      }
      case 'buff_attr': {
        state.buffs.attrHalf = true;
        consume();
        events.push({ t: 'item', txt: it.label + '：下一次属性升级 5 折' });
        break;
      }
      case 'rep': {
        const amt = Math.max(1, Math.ceil(2 * tierDef(state.tier).mult / 10));
        state.rep += amt;
        consume();
        events.push({ t: 'item', txt: it.label + '：声望 +' + amt });
        break;
      }
      case 'unlock_next': {
        let target = null;
        for (let t = state.tier + 1; t <= B.TIERS.length && !target; t++) {
          for (const def of globalThis.NPCS) {
            if (def.tier === t && statusOf(state, def) === 'locked') { target = def; break; }
          }
        }
        if (!target) return { ok: false, msg: '没有可解锁的对象' };
        npc(state, target.id).referred = true;
        consume();
        events.push({ t: 'refer', id: target.id, by: null });
        events.push({ t: 'item', txt: it.label + '：解锁 ' + target.name });
        break;
      }
      case 'equip': {   // alpha3/05：穿上装备（旧件回背包）
        const r = equipItemFromInv(state, idx);
        if (!r.ok) return r;
        events.push({ t: 'item', txt: '已装备 ' + it.label + '（' + (it.effect.slot === 'watch' ? '手表' : '首饰') + '槽）' });
        break;
      }
      default:
        return { ok: false, msg: '未知物品效果' };
    }
    return { ok: true, events };
  }
  const sendItem = (state, idx, targetId, rng) => useItem(state, idx, targetId, rng);

  // ══ alpha3 · 行业人脉（02-network）：派生值不进存档，实时由名册算出 ══
  function networkOf(state) {
    const out = { finance: 0, estate: 0, tech: 0 };
    const mul = Number(state.settings.networkGainMul) || 1;
    for (const id in state.npcs) {
      const def = globalThis.NPC_BY_ID[id];
      const s = state.npcs[id];
      if (!def || !def.domain || !s) continue;
      let ratio = 0;   // 好感里程碑计入比例：≥25→30% ≥50→60% ≥75→100%
      for (const r of B.NETWORK_RATIO) if (s.favor >= r.min) { ratio = r.ratio; break; }
      if (!ratio) continue;
      out[def.domain] += B.NETWORK_VALUE[def.tier] * ratio * mul;
    }
    out.total = out.finance + out.estate + out.tech;
    return out;
  }

  // 已结识（非锁定）NPC 中某类型的数量（业务模板「类型计数比」口径）
  function knownTypeCount(state, t) {
    let c = 0;
    for (const id in state.npcs) {
      const def = globalThis.NPC_BY_ID[id];
      if (def && def.type === t && statusOf(state, def) !== 'locked') c++;
    }
    return c;
  }
  function countIntel(state) {
    let n = 0;
    for (const id in state.intel) {
      for (const k in state.intel[id]) if (state.intel[id][k]) n++;
    }
    return n;
  }

  // ══ alpha3 · 职业与业务（03-career-business）：打工线 MVP，创业后置 ══
  function careerLvDef(state) {
    return B.CAREER_LEVELS[Math.min(10, Math.max(1, state.career.level)) - 1];
  }
  // 提成率 = 职级基准 + 词条加算 + 人脉变现（每位满好感 NPC+0.5%，≤15%）
  function commissionRateOf(state) {
    let rate = careerLvDef(state).rate + bonusFlatOf(state, 'commissionAdd');
    // S8：c15 二选一——选了「豪赌直觉」(nerve) 时人脉变现不生效；旧档 c15=true 视为变现侧
    if (hasSkill(state, 'c15') && state.skills.nodes.c15 !== 'nerve') {
      rate += Math.min(0.15, assetCount(state) * 0.005);
    }
    return Math.max(0, rate);
  }
  // 业务工时倍率 = bizSpeed 旋钮 × (1+Σ工时词条)
  function bizTimeMulOf(state) {
    return (Number(state.settings.bizSpeed) || 1) * bonusMulOf(state, 'bizTime');
  }

  function bizTemplateOpen(state, tpl) {
    return tierOpen(state, tpl.tier) && state.career.level >= tpl.reqLevel
      && tpl.domain === state.career.industry;
  }

  // 效率 = min(1, 人脉比…, 类型计数比…)（+慧眼识珠情报加成；稳健派保底50%）
  // 条件不足不打折失败只降产量，gaps 明示缺口（start.md §12）
  function bizEfficiency(state, tpl, net) {
    net = net || networkOf(state);
    const ratios = [];
    const gaps = [];
    for (const dom in tpl.reqNet) {
      // S1：景气行业人脉计入提升（乘在计数侧、min-ratio 之前；reqTypes 类型计数不吃景气）
      const have = (net[dom] || 0) * boomNetMulOf(state, dom);
      const need = tpl.reqNet[dom];
      ratios.push(have / need);
      if (have < need) gaps.push(B.DOMAIN_TXT[dom] + '人脉还差 ' + Math.ceil(need - have));
    }
    for (const rt of tpl.reqTypes) {
      const have = knownTypeCount(state, rt.t), need = rt.n;
      ratios.push(have / need);
      if (have < need) {
        const tn = { money: '金钱型', rep: '声望型', aux: '辅助型' }[rt.t] || rt.t;
        gaps.push('缺' + tn + '人脉 ×' + (need - have));
      }
    }
    let eff = ratios.length ? Math.min.apply(null, ratios) : 1;
    if (hasSkill(state, 'y1') && branchInvested(state, 'social') >= B.SKILLS.nodes.y1.needOther) {
      const bonus = Math.min(0.10, countIntel(state) * 0.02);   // 慧眼识珠：每条情报+2% ≤+10%
      eff += bonus;
      if (bonus > 0) gaps.push('慧眼识珠：情报加成 +' + Math.round(bonus * 100) + '%');
    }
    if (hasSkill(state, 'k3a')) eff = Math.max(eff, 0.5);        // 稳健派：效率下限保底 50%
    eff = Math.max(0, Math.min(1, eff));
    return { eff, gaps, full: eff >= 1 };
  }

  // 自动选单：圈内可用模板里按「量×效率/分钟」取最优
  // S6 期望中性：risky 单的 jit 在 [0.7,1.3] 均匀分布、均值 1，选单与决策器评分只看 vol×eff 期望即可
  function pickBestBiz(state) {
    let best = null, bs = -1;
    for (const tpl of B.BIZ_TEMPLATES) {
      if (!bizTemplateOpen(state, tpl)) continue;
      const { eff } = bizEfficiency(state, tpl);
      const score = tpl.vol * eff / tpl.workMin;
      if (score > bs) { bs = score; best = tpl; }
    }
    return best;
  }

  // 选单 → 进行中：效率折算后锁定工时；总裁思维保留进度换单
  // S6：risky 单开工时掷效率浮动 jit∈[0.7,1.3]（rng 可选，缺省 Math.random；stable 无 jit）
  function startBiz(state, tplId, rng) {
    if (!state.career.industry) return { ok: false, msg: '先选择一个行业方向' };
    const tpl = B.BIZ_TEMPLATES.find((t) => t.id === tplId);
    if (!tpl) return { ok: false, msg: '无此业务' };
    if (!bizTemplateOpen(state, tpl)) return { ok: false, msg: '圈层或职级不足' };
    const { eff, gaps } = bizEfficiency(state, tpl);
    const prev = state.career.currentBiz;
    const workMs = tpl.workMin * 60000 * bizTimeMulOf(state);
    // 总裁思维：换单不清空当前单进度（跨模板按已耗时携带，钳到新单工时）
    const carryMs = (hasSkill(state, 'c16') && prev)
      ? Math.min(prev.doneMs || 0, workMs)
      : 0;
    state.career.currentBiz = { tplId: tpl.id, eff, workMs, doneMs: carryMs };
    if (tpl.certainty === 'risky') state.career.currentBiz.jit = 0.7 + rnd(rng) * 0.6;   // 风险单掷浮动
    return { ok: true, eff, gaps };
  }

  // 结算：业务量入账（豪赌派满条件 ×1.3）/ 提成发放 / 津贴 / 升职检查
  function settleBiz(state, nowReal, events) {
    const cbz = state.career.currentBiz;
    if (!cbz) return null;
    const tpl = B.BIZ_TEMPLATES.find((t) => t.id === cbz.tplId);
    if (!tpl) { state.career.currentBiz = null; return null; }
    // 保底与豪赌作用于eff，jit独立乘区（S6）；景气为另一独立乘区（S1）——互不挤占
    const volGain = tpl.vol * cbz.eff
      * ((hasSkill(state, 'k3b') && cbz.eff >= 1) ? 1.3 : 1)
      * boomVolMulOf(state, tpl.domain)
      * Math.min(1.3, Math.max(0.7, cbz.jit || 1));
    state.career.bizVolumeTotal += volGain;
    const rate = commissionRateOf(state);
    const gold = tpl.vol * rate * Math.sqrt(tierDef(state.tier).mult)
      * B.COMMISSION_PER_WAN * (Number(state.settings.commissionScale) || 1)
      * incomeFactors(state, nowReal);
    state.gold += gold;
    const lv = careerLvDef(state);
    const allowance = lv.allowance;
    if (allowance > 0) state.gold += allowance;   // 职级津贴（金/周期）
    events.push({
      t: 'biz', txt: tpl.name + ' 完成：业务量 +' + fmtVol(volGain),
      vol: volGain, gold, allowance, rate
    });
    logPush(state, tpl.name + ' 结单：+' + fmtVol(volGain) + ' 业务 · 提成 +' + fmtMoney(gold));
    // 升职检查（可跨多级）：提成率↑ 津贴↑ 技能点+1
    while (state.career.level < 10) {
      const next = B.CAREER_LEVELS[state.career.level];
      if (state.career.bizVolumeTotal >= next.need * (Number(state.settings.bizThresholdMul) || 1)) {
        state.career.level++;
        state.skills.points++;
        invalidateBonuses(state);
        events.push({ t: 'promo', lv: state.career.level, title: next.title });
        logPush(state, '升职！' + next.title + '（技能点 +1）');
      } else break;
    }
    state.career.currentBiz = null;
    return { volGain, gold };
  }

  function fmtVol(v) {
    if (v >= 10000) return trim(v / 10000) + '亿';
    return trim(v) + '万';
  }

  // ══ alpha3 · 关系天赋网（04-skills）：点亮/门槛/洗点 ══
  // 节点状态：lit 已亮 | gate 职级未开 | pair 同对已取另一侧 | prev 前置未亮 |
  //           invest 本系投入不足 | cost 点数不足 | can 可点亮
  function skillNodeState(state, id) {
    const nd = B.SKILLS.nodes[id];
    if (!nd) return { st: 'none' };
    if (state.skills.nodes[id]) return { st: 'lit' };
    if (state.career.level < nd.gate) return { st: 'gate', msg: '需职级 Lv.' + nd.gate };
    if (nd.pair) {
      for (const pid in B.SKILLS.nodes) {
        const pd = B.SKILLS.nodes[pid];
        if (pd.pair === nd.pair && pid !== id && state.skills.nodes[pid]) {
          return { st: 'pair', msg: '与「' + pd.name + '」互斥，全树每对只取一侧' };
        }
      }
    }
    if (nd.prevAny) {
      if (!nd.prevAny.some((p) => state.skills.nodes[p])) return { st: 'prev', msg: '需先点亮本系精华' };
    } else if (nd.prev && !state.skills.nodes[nd.prev]) {
      return { st: 'prev', msg: '需先点亮「' + B.SKILLS.nodes[nd.prev].name + '」' };
    }
    if (nd.needInvest && branchInvested(state, nd.br) < nd.needInvest) {
      return { st: 'invest', msg: '需本系已投入 ≥' + nd.needInvest + ' 点' };
    }
    if (nd.layer === 'syn' && branchInvested(state, nd.br) < (nd.needOther || 4)) {
      return { st: 'invest', msg: '需' + B.SKILLS.branches[nd.br] + '投入 ≥' + (nd.needOther || 4) + ' 点' };
    }
    if (state.skills.points < nd.cost) return { st: 'cost', msg: '技能点不足' };
    return { st: 'can' };
  }

  function takeSkill(state, id, choice) {
    const chk = skillNodeState(state, id);
    if (chk.st !== 'can' && chk.st !== 'lit') return { ok: false, msg: chk.msg || '暂不可点亮' };
    if (state.skills.nodes[id]) return { ok: false, msg: '已点亮' };
    const nd = B.SKILLS.nodes[id];
    // S8 泛化：任意 choice 节点都必须带合法选项（s14 沿用同一机制）
    if (nd.choice && nd.choice.indexOf(choice) < 0) return { ok: false, msg: '选择一种强化' };
    state.skills.points -= nd.cost;
    state.skills.nodes[id] = choice || true;
    invalidateBonuses(state);
    const events = [{ t: 'skill', id, name: nd.name }];
    if (id === 'i16') revealAllIntel(state, events);   // 透视：点亮即全揭示
    return { ok: true, events };
  }

  // ══ alpha4 S7 · Build 预设（03 §S7）：沿序尝试点亮，合法子集全走 takeSkill 同一校验 ══
  // 返回 {ok, name, lit:[], skipped:[{id, reason}]}；choice 节点默认取第一项。
  function applyBuildPreset(state, key) {
    const p = B.SKILL_PRESETS && B.SKILL_PRESETS[key];
    if (!p) return { ok: false, msg: '无此预设' };
    const lit = [];
    const skipped = [];
    for (const id of p.nodes) {
      const nd = B.SKILLS.nodes[id];
      const choice = (nd && nd.choice) ? nd.choice[0] : undefined;
      const r = takeSkill(state, id, choice);
      if (r.ok) lit.push(id);
      else skipped.push({ id, reason: r.msg || '不可点亮' });
    }
    return { ok: true, name: p.name, lit, skipped };
  }

  function skillPointsInvested(state) {
    let n = 0;
    for (const id in state.skills.nodes) {
      const nd = B.SKILLS.nodes[id];
      if (nd) n += nd.cost;
    }
    return n;
  }
  // 洗点费 = 已投点数 × base × (1+已洗次数)；首次免费（04-skills §5）；
  // S7 试洗券：持有券时该次洗点半价（首次免费规则仍最优先）
  function respecCostOf(state) {
    const washed = state.skills.washed || 0;
    if (washed === 0) return 0;
    let cost = skillPointsInvested(state) * (Number(state.settings.respecBase) || 20000) * (1 + washed);
    if ((state.wash.vouchers || 0) > 0) cost = Math.ceil(cost * 0.5);
    return cost;
  }
  function respecSkills(state) {
    const invested = skillPointsInvested(state);
    if (!invested) return { ok: false, msg: '还没有已点亮的节点' };
    const cost = respecCostOf(state);
    if (state.gold < cost) return { ok: false, msg: '金币不足（需 ' + fmtMoney(cost) + '）' };
    state.gold -= cost;
    // 券只在真正付费的半价洗点时消耗（首次免费不耗券）
    if (cost > 0 && (state.wash.vouchers || 0) > 0) state.wash.vouchers--;
    state.skills.points += invested;
    state.skills.nodes = {};
    state.skills.washed = (state.skills.washed || 0) + 1;
    invalidateBonuses(state);
    return { ok: true, refund: invested, cost, events: [{ t: 'respec', refund: invested }] };
  }

  // ══ alpha3 · 装备槽 ×2（05-items-equipment）══
  // 换装语义：旧件回背包、无损坏无强化等级；词条重注册进聚合器
  function equipItemFromInv(state, invIdx) {
    const e = state.inv[invIdx];
    if (!e) return { ok: false, msg: '没有这件物品' };
    const it = globalThis.ITEM_BY_ID[e.it];
    if (!it || it.effect.kind !== 'equip') return { ok: false, msg: '这件物品不可装备' };
    const slot = it.effect.slot;
    const old = state.equips[slot];
    const have = e.n || 1;
    // 原子性预检：旧件回包需要空位（本次消耗腾出的格子算数）
    const freed = have <= 1 ? 1 : 0;
    if (old && invCap(state) - state.inv.length + freed < 1) return { ok: false, msg: '背包已满，换不下旧件' };
    if (have > 1) e.n = have - 1;
    else state.inv.splice(invIdx, 1);
    if (old) invAdd(state, old.it, old.q, 1);
    state.equips[slot] = { it: e.it, q: e.q };
    invalidateBonuses(state);
    return { ok: true, slot, itemId: e.it, q: e.q, events: [{ t: 'equipOn', slot, label: it.label }] };
  }
  function unequipEquip(state, slot) {
    if (['watch', 'jewel'].indexOf(slot) < 0) return { ok: false, msg: '无此装备槽' };
    const cur = state.equips[slot];
    if (!cur) return { ok: false, msg: '该槽位为空' };
    if (!invAdd(state, cur.it, cur.q, 1)) return { ok: false, msg: '背包已满' };
    state.equips[slot] = null;
    invalidateBonuses(state);
    return { ok: true, events: [{ t: 'equipOff', slot }] };
  }

  // ══ 宠物（06-pets）：累计行为解锁，永久全局生效 ══
  // alpha4 S4 三阶成长：由统计值对 stages 阈值计算阶段（只升不降，可一次跨多阶），变更才发事件
  function checkPetsUnlocked(state, events) {
    events = events || [];
    for (const p of B.PETS) {
      const cur = state.pets[p.id] || 0;
      const val = statValue(state, p.stat);
      let target = 0;
      for (let i = 0; i < p.stages.length; i++) if (val >= p.stages[i].goal) target = i + 1;
      if (target > cur) {
        state.pets[p.id] = target;
        invalidateBonuses(state);
        events.push({ t: 'pet', id: p.id, name: p.name, stage: target,
          perkText: p.stages[target - 1].perkText });
      }
    }
  }

  // ── 属性/槽位/圈层（沿用 v1，接入 priceRate 与画册半价）──
  function upgradeAttr(state, key) {
    if (!(key in state.attrs)) return { ok: false, msg: '无此属性' };
    let cost = attrCost(state.attrs[key], state.settings.priceRate);
    if (state.buffs.attrHalf) cost = Math.max(1, Math.ceil(cost / 2));
    if (state.gold < cost) return { ok: false, msg: '金币不足' };
    state.gold -= cost;
    state.attrs[key] += 1;
    if (state.buffs.attrHalf) { state.buffs.attrHalf = false; return { ok: true, cost, discounted: true }; }
    return { ok: true, cost };
  }
  function expandSlot(state) {
    if (state.slotCount >= B.SLOTS_MAX) return { ok: false, msg: '槽位已满' };
    const cost = Math.round(B.SLOT_COSTS[state.slotCount + 1] * state.settings.priceRate);
    if (state.gold < cost) return { ok: false, msg: '金币不足' };
    state.gold -= cost;
    state.slotCount += 1;
    return { ok: true, cost };
  }
  function canEnterTier(state, t) {
    if (t < 1 || t > B.TIERS.length) return { ok: false, miss: ['无此圈层'] };
    const tier = tierDef(t);
    const miss = [];
    if (state.rep < tier.rep) miss.push('声望 ' + tier.rep);
    if (state.gold < tier.fee) miss.push('入场费 ' + fmtMoney(tier.fee));
    if (state.attrs.taste < tier.taste) miss.push('品味 ' + tier.taste);
    return { ok: miss.length === 0, miss, tier };
  }
  function enterTier(state, t) {
    if (t !== state.tier + 1) return { ok: false, msg: '圈层需逐级进入' };
    const c = canEnterTier(state, t);
    if (!c.ok) return { ok: false, msg: '还差：' + c.miss.join('、') };
    state.gold -= tierDef(t).fee;
    state.tier = t;
    // 圈层首通发技能点（growth-evolution-mini §1：升职/公司升级/圈层首通各+1）
    state.skills.points += 1;
    // S7 试洗券：每圈层首通发放一张，下次洗点半价
    if (t > (state.wash.tierDone || 0)) {
      state.wash.vouchers = (state.wash.vouchers || 0) + 1;
      state.wash.tierDone = t;
    }
    const evs = [{ t: 'tier', tier: t }, { t: 'sp', from: 'tier', lv: t }];
    if (state.wash.vouchers > 0 && t === state.wash.tierDone) {
      evs.push({ t: 'voucher' });   // 本次入圈新发的券才提示（旧档补发口径不刷屏）
    }
    return { ok: true, events: evs };
  }

  // ── 日切：热点 / 邀约（08 §4~§5）──
  function refreshHotspots(state, rng) {
    const n = irand(rng, B.DATE.HOTSPOT_PER_DAY[0], B.DATE.HOTSPOT_PER_DAY[1]);
    const pool = B.DATE.HOTSPOTS.slice();
    const list = [];
    for (let i = 0; i < n && pool.length; i++) {
      list.push(pool.splice(Math.floor(rnd(rng) * pool.length), 1)[0]);
    }
    state.hotspot = { day: dayIndex(state), list };
    return list;
  }

  function inviteRoll(state, rng) {
    const events = [];
    for (const def of globalThis.NPCS) {
      const s = state.npcs[def.id];
      if (!s || s.asset || s.favor < B.DATE.INVITE_FAVOR) continue;
      if (state.invites.some((x) => x.id === def.id)) continue;
      const matched = B.SPEND.VARIANTS.light.some((v) => matchTags(state, def, v.tags).hit);
      const p = B.DATE.INVITE_P * (matched ? B.SPEND.MATCH_UP : B.SPEND.MATCH_DOWN);
      if (rnd(rng) < p) {
        state.invites.push({ id: def.id, expGt: state.gt + B.DATE.INVITE_VALID_H * 3600000 });
        events.push({ t: 'invite', id: def.id });
      }
    }
    return events;
  }

  function acceptInvite(state, id, rng) {
    const i = state.invites.findIndex((x) => x.id === id);
    if (i < 0) return { ok: false, msg: '邀约不存在或已过期' };
    const def = globalThis.NPC_BY_ID[id];
    if (!def || statusOf(state, def) !== 'courting') { state.invites.splice(i, 1); return { ok: false, msg: '无法赴约' }; }
    state.invites.splice(i, 1);
    npc(state, id).lastActGt = state.gt;   // S2 赴约也算互动
    const events = [];
    const gain = resolveDate(state, def, 'meal', null, true, rng, events);
    logPush(state, '接受了 ' + def.name + ' 的邀约（免费正餐）');
    return { ok: true, gain, events };
  }

  // ── S2 关系衰减 Lite（03 §S2，默认 off）：入槽且好感≥50 的 NPC 连续 3 游戏日无任何互动
  // → 日切 −1，钳到当前阶段下限（25/50/75 平台不破）；资产化免疫；静默无事件。
  function decayPass(state) {
    if (!state.settings.decayEnabled) return;
    state.slots.forEach((id) => {
      const s = state.npcs[id];
      if (!s || s.asset || s.favor < 50) return;
      const last = (typeof s.lastActGt === 'number' && s.lastActGt >= 0) ? s.lastActGt : state.gt;
      if (state.gt - last < 3 * B.DAY_MS) return;
      const min = stageOf(s.favor).min;   // favor 所处 [min,goal) 段的下限即钳制位
      s.favor = Math.max(min, s.favor - 1);
    });
  }

  function newDay(state, rng) {
    decayPass(state);
    state.spent = { day: dayIndex(state), global: 0, npc: {} };
    refreshHotspots(state, rng);
    const ev = inviteRoll(state, rng);
    state.invites = state.invites.filter((x) => x.expGt > state.gt);
    return ev;
  }

  // ── 决策日志 ──
  function logPush(state, txt) {
    state.log.push({ gt: state.gt, txt });
    const depth = state.settings.decisionLogDepth || 50;
    while (state.log.length > depth) state.log.shift();
  }

  // ── 主循环步进 ──
  function step(state, realDtMs, opts) {
    opts = opts || {};
    const offline = !!opts.offline;
    const rng = opts.rng;
    const nowReal = opts.nowReal || Date.now();   // 时段窗口（晚班/夜猫子）统一取值，离线由调用方下发模拟钟
    const events = [];
    const S = state.settings;
    const realDt = Math.max(0, realDtMs);
    const gdt = realDt * S.timeScale;
    state.gt += gdt;

    // 体力再生
    if (!offline || S.offlineRegen) {
      state.stamina = Math.min(staminaMaxOf(state), state.stamina + S.staminaRegenPerMin * gdt / 60000);
    }

    // 工作：产钱 + 耗体力 + 歇业规则（02 方案 A）
    const j = state.job;
    if (j && j.id && j.shiftEndGt != null) {
      if (state.gt >= j.shiftEndGt) { j.shiftEndGt = null; j.resting = false; }
      else if (!j.resting) {
        const jd = B.JOBS[j.id];
        state.stats.totalWorkMs += gdt;   // 全勤打工人成就计数
        const drain = jd.staminaPerH * gdt / 3600000 * (hasSkill(state, 'c14') ? 2 : 1);   // 兼职达人双份消耗
        if (state.stamina - drain <= 0) {
          state.stamina = 0; j.resting = true;    // 体力见底自动歇班，不惩罚
        } else {
          state.stamina -= drain;
          let wps = wagePerSec(state, nowReal);
          if (offline && j.id === 'night') wps *= jd.offlineMul || 1;
          const wage = wps * gdt / 1000;
          if (wage > 0) { state.gold += wage; state.stats.totalWage += wage; events.push({ t: 'wage', amount: wage }); }
          if (jd.tipChance && gdt > 0) {
            if (rnd(rng) < jd.tipChance * gdt / 3600000) {
              const amt = irand(rng, jd.tipRange[0], jd.tipRange[1]);
              state.gold += amt;
              events.push({ t: 'work', txt: '小费 +' + amt });
            }
          }
        }
      } else if (state.stamina >= staminaMaxOf(state) * B.WORK_REST_RESUME) {
        j.resting = false;
      }
    }

    // 槽内自动好感（好感公式不变；离线效率约束由 settleOffline 的 _offMul 统一缩放）
    if (gdt > 0) {
      const slots = state.slots.slice();
      for (const id of slots) {
        const def = globalThis.NPC_BY_ID[id];
        if (!def) continue;
        grantFavor(state, def, autoFavorPerMin(state, def) * gdt / 60000, events);
      }
    }

    // 业务单推进（alpha3/03：放置期自动跑，离线照跑；同一时刻 1 单）
    if (S.careerMode !== 'founder' && state.career && state.career.industry) {
      const cbz = state.career.currentBiz;
      if (cbz) {
        cbz.doneMs += gdt;
        if (cbz.doneMs >= cbz.workMs) {
          settleBiz(state, nowReal, events);
          const nxt = pickBestBiz(state);
          if (nxt) startBiz(state, nxt.id, rng);   // S6：自动续单同样掷 jit
        }
      } else if (!offline || gdt > 0) {
        const tpl = pickBestBiz(state);
        if (tpl) startBiz(state, tpl.id, rng);
      }
    }

    // 日切
    const day = dayIndex(state);
    if (day !== state.spent.day) {
      const boomEvts = rollBoomIfDue(state, rng);   // S1 周切景气先掷（rng 序列确定，测试可注入）
      const dev = newDay(state, rng);
      events.push({ t: 'hotspot', list: state.hotspot.list });
      for (const e of dev) events.push(e);
      for (const e of boomEvts) events.push(e);
    }

    // 资产掉落计时（只有人脉资产掉落）
    for (const id in state.lootNext) {
      const def = globalThis.NPC_BY_ID[id];
      const s = state.npcs[id];
      if (!def || !s || !s.asset) { delete state.lootNext[id]; continue; }
      let guard = 0;
      while (state.lootNext[id] <= state.gt && guard++ < 64) {
        if (state.lootNext[id] === undefined) break;
        const roll = rollLoot(state, def, rng);
        if (offline) {
          applyOfflineLoot(state, roll);
        } else {
          const d = spawnDrop(state, def, roll);
          events.push({ t: 'drop', uid: d.uid, id: def.id, kind: roll.kind, itemId: roll.itemId, qty: roll.qty, q: roll.q });
        }
        state.lootNext[id] = (state.lootNext[id] < state.gt - 86400000 ? state.gt : state.lootNext[id])
          + lootIntervalMs(state, def, rng);
      }
    }
    for (const id in state.npcs) {
      const s = state.npcs[id];
      if (s.asset && state.lootNext[id] === undefined) {
        const def = globalThis.NPC_BY_ID[id];
        if (def) state.lootNext[id] = state.gt + lootIntervalMs(state, def, rng);
      }
    }

    // 过期清理
    state.invites = state.invites.filter((x) => x.expGt > state.gt);

    checkAchievements(state, events);

    return events;
  }

  // 离线掉落折算：金币/声望直接入账，物品按阈值过滤（§4.1 同口径）后进离线包裹
  function applyOfflineLoot(state, roll) {
    if (roll.kind === 'gold') {
      const amt = Math.round(roll.qty * bonusMulOf(state, 'incomeMul'));   // 账房全局口径
      state.gold += amt; state._offPackGold = (state._offPackGold || 0) + amt;
    }
    else if (roll.kind === 'letter') { state.rep += roll.qty; state._offLetterRep = (state._offLetterRep || 0) + roll.qty; }
    else if (roll.kind === 'item') {
      const thr = autoSellRank(state);
      if (thr >= B.GRADE_RANK[roll.q]) {
        const amt = sellUnitPrice(globalThis.ITEM_BY_ID[roll.itemId]);
        state.gold += amt;
        state._offPackGold = (state._offPackGold || 0) + amt;
        state._offSoldN = (state._offSoldN || 0) + 1;
        state.stats.totalLoot++;
      } else {
        state._offPackage.push({ it: roll.itemId, q: roll.q, n: 1 });
      }
    }
    else if (roll.kind === 'intel') { revealIntel(state, null, state._offIntelEvents); }
  }

  // 离线包裹领取（UI 调用）：逐条入包并计入拾取成就
  function absorbOfflinePackage(state, list) {
    const out = [];
    (list || []).forEach((p) => {
      const okc = invAdd(state, p.it, p.q, p.n || 1);
      if (okc) state.stats.totalLoot += (p.n || 1);
      out.push({ it: p.it, q: p.q, n: p.n || 1, ok: !!okc });
    });
    checkAchievements(state, []);
    return out;
  }

  // ── 决策器意图执行（手动/自动/离线 同管线）──
  function execAction(state, act, nowReal, rng) {
    if (!act) return { ok: false, msg: '空动作' };
    switch (act.act) {
      case 'interact': return interact(state, act.id, nowReal);
      case 'wechat': return wechat(state, act.id);
      case 'moments': return moments(state, act.id);
      case 'workplace': return workplace(state, act.id, nowReal);
      case 'identify': return identify(state, act.id, nowReal, rng);
      case 'gift': return spendGift(state, act.id, act.size, nowReal, rng);
      case 'date': return spendDate(state, act.id, act.kind, act.variantIdx, nowReal, rng);
      case 'errand': return spendErrand(state, act.id, nowReal, rng);
      case 'item': return useItem(state, act.invIdx, act.id, rng);
      default: return { ok: false, msg: '未知动作' };
    }
  }

  // ── 离线结算（04 §5：同一架构模拟 + 简报）──
  function settleOffline(state, nowReal, rng, agentFn) {
    rng = rng || null;
    const raw = Math.max(0, nowReal - state.lastSeen);
    const capGameMs = (B.OFFLINE_CAP_H + Math.min(B.OFFLINE_AUX_CAP_H, auxAssets(state) * B.OFFLINE_AUX_BONUS_H)) * 3600000;
    const allowedReal = capGameMs / Math.max(0.01, state.settings.timeScale);
    const dtReal = Math.min(raw, allowedReal);
    const report = {
      awayMs: raw, ms: dtReal * state.settings.timeScale, capped: raw > allowedReal + 1,
      wage: 0, packGold: 0, letterRep: 0, milestoneGold: 0, milestoneRep: 0,
      favors: [], actions: [], package: [], stageNotes: [], soldN: 0,
      bizGold: 0, bizVol: 0, allowance: 0, promos: []
    };
    if (dtReal < 5000) { state.lastSeen = nowReal; return report; }

    state._offPackage = [];
    state._offPackGold = 0;
    state._offLetterRep = 0;
    state._offSoldN = 0;
    state._offIntelEvents = [];
    state._offMul = state.settings.offlineFavorRate;

    const favorBefore = {};
    state.slots.forEach((id) => { favorBefore[id] = npc(state, id).favor; });

    const nChunks = Math.min(400, Math.max(1, Math.ceil(dtReal / 600000)));
    const chunkReal = dtReal / nChunks;
    let simReal = state.lastSeen;
    for (let i = 0; i < nChunks; i++) {
      simReal += chunkReal;
      const ev = step(state, chunkReal, { offline: true, nowReal: simReal, rng });
      absorb(report, ev, state);
      if (agentFn) {
        const act = agentFn(state, simReal, rng);
        if (act) {
          const r = execAction(state, act, simReal, rng);
          if (r && r.ok) {
            absorb(report, r.events || [], state);
            report.actions.push({ txt: actDesc(act), n: 1 });
          }
        }
      }
    }

    delete state._offMul;
    state.slots.forEach((id) => {
      const def = globalThis.NPC_BY_ID[id];
      if (def) {
        const diff = npc(state, id).favor - (favorBefore[id] || 0);
        report.favors.push({ id, name: def.name, gained: diff });
      }
    });
    report.package = state._offPackage;
    report.packGold = state._offPackGold;
    report.letterRep = state._offLetterRep;
    report.soldN = state._offSoldN || 0;
    delete state._offPackage; delete state._offPackGold; delete state._offLetterRep; delete state._offIntelEvents;
    delete state._offSoldN;

    state.lastSeen = nowReal;
    return report;
  }

  function absorb(report, events, state) {
    (events || []).forEach((e) => {
      if (e.t === 'wage') report.wage += e.amount;
      else if (e.t === 'milestone') {
        if (e.kind === 'gold') report.milestoneGold += e.amount; else report.milestoneRep += e.amount;
      } else if (e.t === 'biz') {
        report.bizGold += e.gold || 0;
        report.bizVol += e.vol || 0;
        report.allowance += e.allowance || 0;
      } else if (e.t === 'promo') {
        report.promos.push({ lv: e.lv, title: e.title });
      } else if (e.t === 'stage') {
        report.stageNotes.push((globalThis.NPC_BY_ID[e.id] ? globalThis.NPC_BY_ID[e.id].name : e.id) + ' → ' + e.to);
      } else if (e.t === 'full' || e.t === 'refer') { /* 简报里由 favors/full 体现 */ }
    });
  }
  function actDesc(act) {
    const name = globalThis.NPC_BY_ID[act.id] ? globalThis.NPC_BY_ID[act.id].name : act.id;
    switch (act.act) {
      case 'interact': return '线下互动·' + name;
      case 'wechat': return '微信·' + name;
      case 'workplace': return '职场互动·' + name;
      case 'moments': return '朋友圈·' + name;
      case 'identify': return '识人·' + name;
      case 'gift': return '送礼（' + B.GIFTS[act.size].label + '）·' + name;
      case 'date': return B.SPEND.date[act.kind].label + '·' + name;
      case 'errand': return '办事·' + name;
      case 'item': return '使用物品·' + name;
      default: return String(act.act);
    }
  }

  // ── 设置 / GM（01 §2.2）──
  function applyPreset(state, key) {
    const p = globalThis.SETTINGS_PRESETS[key];
    if (!p) return { ok: false, msg: '无此预设' };
    state.settings = Object.assign(mergeSettings(), p.patch);
    state.customMode = false;
    return { ok: true };
  }
  function setSetting(state, key, val) {
    if (!(key in globalThis.SETTINGS_DEFAULT)) return { ok: false, msg: '未知参数' };
    if (typeof globalThis.SETTINGS_DEFAULT[key] === 'number') val = Number(val);
    if (typeof globalThis.SETTINGS_DEFAULT[key] === 'boolean') val = !!val;
    state.settings[key] = val;
    // S2 衰减开关属界面体验类，翻转不标记自定义参数（与 autoPickup 等同列表）
    if (key !== 'autoPickup' && key !== 'notifyLevel' && key !== 'decisionLogDepth'
      && key !== 'decayEnabled') state.customMode = true;
    return { ok: true };
  }
  function gmGrant(state, kind, n) {
    n = Number(n) || 0;
    if (kind === 'gold') state.gold += n;
    else if (kind === 'rep') state.rep += n;
    else if (kind === 'stamina') state.stamina = Math.min(staminaMaxOf(state), state.stamina + n);
    else if (kind === 'item') {
      const it = globalThis.ITEMS[Math.floor(Math.random() * globalThis.ITEMS.length)];
      invAdd(state, it.id, 'rare');
      return { ok: true, msg: '发放 ' + it.label };
    }
    return { ok: true };
  }
  function gmUnlockTier(state) {
    state.tier = Math.min(B.TIERS.length, state.tier + 1);
    return { ok: true };
  }
  function gmAllFavor(state, n) {
    for (const id in state.npcs) {
      const def = globalThis.NPC_BY_ID[id];
      if (def && !state.npcs[id].asset) grantFavor(state, def, n || 10, []);
    }
    return { ok: true };
  }
  function gmResetPity(state) {   // alpha4 S3：后台调试钮——保底计数清零
    state.loot.pityRare = 0;
    state.loot.pityEquip = 0;
    return { ok: true };
  }

  // ── 槽位 ──
  function addToSlot(state, id) {
    const def = globalThis.NPC_BY_ID[id];
    if (!def) return { ok: false, msg: '无此人' };
    if (statusOf(state, def) !== 'available') return { ok: false, msg: '当前不可攻略' };
    if (state.slots.indexOf(id) >= 0) return { ok: false, msg: '已在槽位' };
    if (state.slots.length >= slotCapOf(state)) return { ok: false, msg: '槽位已满，可扩容' };
    state.slots.push(id);
    const events = [];
    const s = npc(state, id);
    if (!s.met) {
      s.met = true;
      if (hasSkill(state, 'i14')) {   // 眼缘：初见好感+5
        grantFavor(state, def, 5, events);
        events.push({ t: 'item', txt: '眼缘：与 ' + def.name + ' 一见如故（好感+5）' });
      }
    }
    return { ok: true, events };
  }
  function removeFromSlot(state, id) {
    const i = state.slots.indexOf(id);
    if (i < 0) return { ok: false, msg: '不在槽位' };
    state.slots.splice(i, 1);
    return { ok: true };
  }

  // ── 格式化 ──
  function fmtMoney(n) {
    if (n >= 1e8) return trim(n / 1e8) + '亿';
    if (n >= 1e4) return trim(n / 1e4) + '万';
    return String(Math.floor(n));
  }
  function trim(x) {
    const s = x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
    return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  }
  function fmtRate(n) {
    return n >= 100 ? String(Math.round(n)) : trim(n);
  }

  globalThis.Engine = {
    newState, migrate, npc, statusOf, tierOpen, tierDef,
    auxAssets, auxBonus, autoFavorPerMin, interactGain, expectedIncomePerSec,
    stageOf, grantFavor, addToSlot, removeFromSlot,
    dayIndex, onDuty, wagePerSec, shiftInfo,
    hireJob, quitJob, startShift, stopShift,
    wechat, moments, workplace, interact, identify, revealAllIntel,
    overLine, budgetLeftGlobal, budgetLeftNpc,
    priceOf, favorOf, matchTags, hotspotHit, bestVariantIdx,
    spendGift, spendDate, spendErrand, resolveDate, rollDateEvent, revealIntel, maybeReturnGift,
    rollLoot, lootIntervalMs, qualityRollWith, invAdd, invCap, buyInvCap, autoSellRank,
    spawnDrop, collectDrop, sellItem, sellUnitPrice, useItem, sendItem, synthItems, findSynthTriple,
    absorbOfflinePackage,
    checkAchievements, staminaMaxOf, assetCount,
    bonusOf, bonusMulOf, bonusFlatOf, invalidateBonuses, bonusSig, hasSkill, branchInvested,
    favorCapOf, slotCapOf, incomeFactors,
    networkOf, knownTypeCount, countIntel,
    careerLvDef, commissionRateOf, bizTimeMulOf, bizTemplateOpen, bizEfficiency,
    pickBestBiz, startBiz, settleBiz, fmtVol,
    skillNodeState, takeSkill, applyBuildPreset, skillPointsInvested, respecCostOf, respecSkills,
    boomOf, boomVolMulOf, boomNetMulOf, decayPass,
    equipItemFromInv, unequipEquip, checkPetsUnlocked,
    refreshHotspots, inviteRoll, acceptInvite, newDay, logPush,
    step, execAction, settleOffline, applyOfflineLoot,
    applyPreset, setSetting, gmGrant, gmUnlockTier, gmAllFavor, gmResetPity,
    upgradeAttr, expandSlot, canEnterTier, enterTier, attrCost,
    fmtMoney, fmtRate
  };

  if (typeof module !== 'undefined') module.exports = globalThis.Engine;
})();
