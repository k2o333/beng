// 分层决策器 v2（04-idle-courting 方案 C）：L0 战略(读 settings) / L1 阶段剧本 / L2 效用评分 / L3 中断
// 纯逻辑：除 refillQueue 外不修改状态；执行由外部调 Engine.execAction（同价同表）。
(function () {
  const B = globalThis.BALANCE;

  const rnd = (rng) => (rng ? rng() : Math.random());

  // ── 本地兜底查询（Engine 缺席时保证可独立加载）──
  function stageInfo(favor) {
    if (globalThis.Engine) return globalThis.Engine.stageOf(favor);
    let cur = B.STAGES[0];
    for (const s of B.STAGES) if (favor >= s.min) cur = s;
    return cur;
  }
  function statusOf(state, def) {
    if (globalThis.Engine) return globalThis.Engine.statusOf(state, def);
    const s = state.npcs[def.id];
    if (s && s.asset) return 'asset';
    if (state.slots.indexOf(def.id) >= 0) return 'courting';
    if (def.tier <= state.tier || (s && s.referred)) return 'available';
    return 'locked';
  }
  function onDuty(state) {
    if (globalThis.Engine) return globalThis.Engine.onDuty(state);
    const j = state.job;
    return !!(j && j.id && j.shiftEndGt != null && state.gt < j.shiftEndGt);
  }
  function priceOf(state, def, kind, size, variantIdx) {
    if (globalThis.Engine) return globalThis.Engine.priceOf(state, kind, size, def.tier, variantIdx);
    let p;
    if (kind === 'gift') p = B.GIFTS[size].cost[def.tier] * state.settings.priceRate;
    else if (kind === 'errand') p = B.GIFTS.large.cost[def.tier] * B.SPEND.errand.mul * state.settings.priceRate;
    else p = B.GIFTS[B.SPEND.date[size].base].cost[def.tier] * B.SPEND.date[size].mul * state.settings.priceRate;
    return Math.max(1, Math.round(p));
  }
  function favorOf(state, def, kind, size, variantIdx) {
    if (globalThis.Engine && globalThis.Engine.favorOf) {
      return globalThis.Engine.favorOf(state, def, kind === 'errand' ? 'errand' : kind, size, variantIdx);
    }
    let f;
    if (kind === 'gift') f = B.GIFTS[size].favor;
    else if (kind === 'errand') f = B.SPEND.errand.favor;
    else f = B.SPEND.date[size].favor;
    return f * state.settings.favorPerYuanRate;
  }
  function budgetOk(state, id) {
    if (globalThis.Engine && globalThis.Engine.overLine) return !globalThis.Engine.overLine(state, id);
    const S = state.settings;
    if (S.dailyBudget > 0 && state.spent.global >= S.dailyBudget) return false;
    if (S.perNpcBudget > 0 && (state.spent.npc[id] || 0) >= S.perNpcBudget) return false;
    return true;
  }
  // 匹配系数（含第三偏好窗口与雷区）
  function matchCoef(state, def, tags) {
    if (globalThis.Engine && globalThis.Engine.matchTags) {
      return globalThis.Engine.matchTags(state, def, tags).coef;
    }
    const intel = (state.intel || {})[def.id] || {};
    const win = def.tags.slice();
    if (intel.third && def.third) win.push(def.third);
    if (intel.mine && def.mine && (tags || []).indexOf(def.mine) >= 0) return B.SPEND.MATCH_DOWN;
    return (tags || []).some((t) => win.indexOf(t) >= 0) ? B.SPEND.MATCH_UP : B.SPEND.MATCH_DOWN;
  }

  // ── L1 阶段白名单 ──
  // 免费动作始终可用；付费按阶段解锁。风格调制：frugal 只留免费+小礼；generous/lavish 跳阶段门。
  function whitelist(stageKey, style) {
    const free = ['interact', 'wechat', 'moments', 'workplace', 'identify'];
    if (style === 'frugal') return new Set(free.concat(['gift:small']));
    const paidByStage = {
      ice: [],
      warm: ['date:light', 'gift:small', 'gift:mid'],
      deep: ['date:light', 'date:meal', 'date:trip', 'gift:small', 'gift:mid', 'gift:large'],
      close: ['date:light', 'date:meal', 'date:trip', 'gift:small', 'gift:mid', 'gift:large', 'errand']
    };
    const paid = (style === 'generous' || style === 'lavish')
      ? paidByStage.close.slice()
      : paidByStage[stageKey] || [];
    return new Set(free.concat(paid));
  }
  const STAGE_LABEL = { ice: '破冰期', warm: '升温期', deep: '深交期', close: '收网期' };

  // 体力分配 reserve（02 §4.2：先工作后社交 / 比例 / 先社交后工作）
  function staminaReserve(state) {
    switch (state.priority) {
      case 'social_first': return 0;
      case 'ratio': return 0.4;
      case 'work_first':
      default: return 0.75;
    }
  }

  function cdReady(state, id, key) {
    const cd = state.cds[id];
    return !cd || !(cd[key] > state.gt);
  }

  // ── 候选生成与评分 ──
  function candidates(state, nowReal) {
    const S = state.settings;
    const duty = onDuty(state);
    const reserve = staminaReserve(state) * S.staminaMax;
    // L3：体力接近溢出时无视 reserve，立即消耗
    const nearFull = state.stamina >= S.staminaMax - S.staminaRegenPerMin * (S.decisionIntervalSec / 60) * 2;
    const stamOk = (cost) => (nearFull || state.stamina >= Math.max(reserve, cost));
    const out = [];
    const usedIdx = {};

    state.slots.forEach((id) => {
      const def = globalThis.NPC_BY_ID[id];
      if (!def) return;
      const ns = state.npcs[id] || { favor: 0, claimed: [], asset: false };   // 懒创建条目兜底
      if (ns.asset) return;
      const stg = stageInfo(ns.favor);
      const wl = whitelist(stg.key, S.spendStyle);
      const fav = ns.favor;

      // 免费动作
      if (!duty && stamOk(S.interactStaminaCost)) {
        out.push(mk('interact', def, { gain: gainInteract(state, def), stamina: S.interactStaminaCost },
          STAGE_LABEL[stg.key] + '·线下互动'));
      }
      if (duty && def.tier === 1 && cdReady(state, id, 'wp') && stamOk(S.workplaceInteractCost)) {
        out.push(mk('workplace', def, { gain: B.WORKPLACE_FAVOR, stamina: S.workplaceInteractCost },
          '在岗·职场互动'));
      }
      if (cdReady(state, id, 'wx') && stamOk(S.wechatStaminaCost)) {
        out.push(mk('wechat', def, { gain: B.WECHAT_FAVOR, stamina: S.wechatStaminaCost },
          duty ? '在岗摸鱼·微信维持' : '微信聊天'));
      }
      if (cdReady(state, id, 'mo')) {
        out.push(mk('moments', def, { gain: B.MOMENTS_FAVOR, stamina: 0 }, '朋友圈点赞'));
      }
      // 识人（alpha3/04）：情报没读全时的免费动作，优先级低于常规社交
      if (!duty && wl.has('identify') && cdReady(state, id, 'id')
        && stamOk(S.identifyStaminaCost || 12)) {
        const intel = state.intel[id] || {};
        const missing = ['third', 'line', 'mine'].filter((k) => !intel[k]);
        if (missing.length) {
          out.push({ act: 'identify', id, gain: 0, cost: 0, stamina: S.identifyStaminaCost || 12,
            reason: '识人·摸底（缺' + missing.length + '条情报）', _score: 0.6 });
        }
      }

      // 物品动作（免费池：不占预算；每件物品只生成一次候选）
      // 工具类（体力/好感/免单约会）任何阶段可用；送出类（等效礼物）破冰期禁用
      if (!duty && Array.isArray(state.inv)) {
        state.inv.forEach((entry, invIdx) => {
          const it = globalThis.ITEM_BY_ID[entry.it];
          if (!it || usedIdx[invIdx]) return;
          const k = it.effect.kind;
          const mulQ = entry.q === 'fine' ? 1.5 : 1;
          if (k === 'stamina' && state.stamina < S.staminaMax * 0.3) {
            // 喝咖啡不受下班限制（上班摸鱼合法）
            out.push({ act: 'item', id: id, invIdx, gain: 0, cost: 0, stamina: 0,
              reason: '缺体力·吃' + it.label, _score: duty ? 5 : 4 });
            usedIdx[invIdx] = true;
          } else if (!duty && (k === 'favor_random' || k === 'favor_all') && stg.key !== 'ice') {
            out.push({ act: 'item', id: id, invIdx, gain: it.effect.favor * mulQ, cost: 0,
              stamina: 0, reason: '掏出' + it.label, _score: 0.5 });
            usedIdx[invIdx] = true;
          } else if (k === 'free_date' && stg.key !== 'ice') {
            const tierNote = ns.favor >= B.SPEND.date.meal.unlockFavor ? '正餐档' : '轻约档';
            out.push({ act: 'item', id: id, invIdx, gain: 15 * mulQ, cost: 0, stamina: 0,
              reason: '用' + it.label + '免单一约（' + tierNote + '）', _score: 2.5 });
            usedIdx[invIdx] = true;
          } else if (k === 'send_gift' && stg.key !== 'ice' && wl.has('gift:' + it.effect.size)) {
            out.push({ act: 'item', id: id, invIdx, gain: B.GIFTS[it.effect.size].favor * mulQ,
              cost: 0, stamina: 0, reason: '免费送出' + it.label, _score: B.GIFTS[it.effect.size].favor / 10 });
            usedIdx[invIdx] = true;
          }
        });
      }

      // 付费动作（线下、下班时段、预算内）
      if (!duty && budgetOk(state, id)) {
        ['small', 'mid', 'large'].forEach((size) => {
          if (!wl.has('gift:' + size)) return;
          if (size === 'large' && state.attrs.taste < B.LARGE_TASTE[def.tier]) return;
          const cost = priceOf(state, def, 'gift', size);
          if (state.gold >= cost) out.push(mk('gift', def, { size }, sizeNote(size)));
        });
        ['light', 'meal', 'trip'].forEach((kind) => {
          if (!wl.has('date:' + kind)) return;
          const gate = B.SPEND.date[kind].unlockFavor;
          if (gate && fav < gate) return;
          B.SPEND.VARIANTS[kind].forEach((v, vi) => {
            const coef = matchCoef(state, def, v.tags);
            if (coef === B.SPEND.MATCH_DOWN) return;   // 决策器只选匹配变体（05 §3）
            const cost = priceOf(state, def, 'date', kind, vi);
            if (state.gold < cost) return;
            out.push(mk('date', def, { kind, variantIdx: vi }, null,
              { matched: true, label: v.name }));
          });
        });
        if (wl.has('errand') && !state.errandUsed[id] && fav >= B.SPEND.errand.unlockFavor
          && state.gold >= priceOf(state, def, 'errand')) {
          out.push(mk('errand', def, {}, '办事帮忙（大招）'));
        }
      }
    });

    function mk(act, def, extra, why, o) {
      o = o || {};
      const size = extra.size || null;
      let gain, cost = 0;
      if (act === 'gift') { gain = favorOf(state, def, 'gift', size); cost = priceOf(state, def, 'gift', size); }
      else if (act === 'date') { gain = favorOf(state, def, 'date', extra.kind, extra.variantIdx); cost = priceOf(state, def, 'date', extra.kind, extra.variantIdx); }
      else if (act === 'errand') { gain = favorOf(state, def, 'errand'); cost = priceOf(state, def, 'errand'); }
      else { gain = extra.gain; cost = 0; }
      return Object.assign({
        act, id: def.id, gain, cost,
        stamina: extra.stamina != null ? extra.stamina : 0,
        reason: o.label ? labelOf(act, extra.kind) + '·' + o.label + tagNote(o.matched)
          : (why || act)
      }, size ? { size } : {}, extra.kind ? { kind: extra.kind } : {},
        extra.variantIdx != null ? { variantIdx: extra.variantIdx } : {});
    }
    function labelOf(act, kind) {
      return act === 'gift' ? '送礼' : act === 'date' ? (B.SPEND.date[kind] || {}).label || '约会' : act;
    }
    function tagNote(matched) { return matched ? '(投其所好)' : ''; }
    function sizeNote(size) {
      return size === 'small' ? '小礼破冰' : size === 'mid' ? '中礼升温' : '大礼表意';
    }

    return out;
  }

  function gainInteract(state, def) {
    if (globalThis.Engine && globalThis.Engine.interactGain) return globalThis.Engine.interactGain(state, def);
    return 0.5 * 5;
  }
  function hotHit(state, tags) {
    if (globalThis.Engine && globalThis.Engine.hotspotHit) return globalThis.Engine.hotspotHit(state, tags);
    const day = Math.floor(state.gt / B.DAY_MS);
    if (!state.hotspot || state.hotspot.day !== day) return false;
    return state.hotspot.list.some((h) => (tags || []).some((t) => h.tags.indexOf(t) >= 0));
  }

  function scoreAct(state, c) {
    // 物品动作走生成期给定的固定分（免费池特殊件）
    if (c._score != null) return c._score;
    const S = state.settings;
    const ns = state.npcs[c.id] || { favor: 0 };
    if (!ns) return 0;
    let sc = c.gain;
    // 事件加成：待处理邀约 ×2（优先赴约对象）
    if ((state.invites || []).some((x) => x.id === c.id)) sc *= 2;
    // 里程碑临近加权（04 §2.5）
    const targets = B.MILESTONES.filter((m) => m > ns.favor).concat([B.FAVOR_MAX]);
    const dist = Math.min.apply(null, targets.map((m) => m - ns.favor));
    if (dist <= 3) sc *= S.milestonePushWeight;
    // 风格近似：豪掷更敢花钱
    if (S.spendStyle === 'lavish' && c.cost > 0) sc *= 1.1;
    const denom = S.scoreAlpha * (c.cost / Math.max(state.gold, 1)) + S.scoreBeta * c.stamina;
    return sc / Math.max(denom, 0.1);   // 分母下限：防零体力付费动作无限放大
  }

  // ── 决策入口 ──
  function decide(state, nowReal, rng) {
    const cands = candidates(state, nowReal);
    let best = null, bestScore = 0;
    for (const c of cands) {
      const sc = scoreAct(state, c);
      if (sc > bestScore + 1e-12) { bestScore = sc; best = c; }
      else if (Math.abs(sc - bestScore) <= 1e-12 && best && c.cost < best.cost) { best = c; }
    }
    if (best) { /* rng 预留 tie-break */ }
    return best ? Object.assign({ score: bestScore }, best) : null;
  }

  // ── 自动补位（03 §3）：满级转资产后候补队列顶上，不花槽位费 ──
  // alpha3：mode='gap' 按业务缺口排序——优先补当前行业模板最缺 domain 的人脉（02-network 用法二）
  function outputScore(state, def) {
    return B.BASE_OUTPUT[def.type] * (B.TIERS[def.tier - 1].mult) * def.coef;
  }
  function biggestNetGap(state) {
    if (!globalThis.Engine || !globalThis.Engine.networkOf) return null;
    const net = globalThis.Engine.networkOf(state);
    let dom = null, gap = 0;
    for (const tpl of B.BIZ_TEMPLATES) {
      if (!globalThis.Engine.bizTemplateOpen(state, tpl)) continue;
      for (const d in tpl.reqNet) {
        const g = tpl.reqNet[d] - (net[d] || 0);
        if (g > gap) { gap = g; dom = d; }
      }
    }
    return dom;
  }
  function refillQueue(state) {
    const mode = state.settings.autoSlotOrder;
    if (!mode || mode === 'off') return false;
    const cap = (globalThis.Engine && globalThis.Engine.slotCapOf)
      ? globalThis.Engine.slotCapOf(state) : state.slotCount;   // 广撒网/深耕 调整后的槽位
    let filled = false;
    while (state.slots.length < cap) {
      const cands = globalThis.NPCS.filter((def) => statusOf(state, def) === 'available'
        && state.slots.indexOf(def.id) < 0);
      if (!cands.length) break;
      if (mode === 'refer') cands.sort((a, b2) => (!!b2.refer - !!a.refer) || outputScore(0, b2) - outputScore(0, a));
      else if (mode === 'reputation') cands.sort((a, b2) => (b2.type === 'rep' ? 1 : 0) - (a.type === 'rep' ? 1 : 0) || outputScore(0, b2) - outputScore(0, a));
      else if (mode === 'gap') {
        const dom = biggestNetGap(state);
        // S1 景气质押：景气行业候选稳定前置（Engine 缺席/旋钮关时退化为 0，行为与旧版一致）
        const hot = {};
        if (state.settings.boomEnabled && globalThis.Engine && globalThis.Engine.boomOf) {
          B.DOMAINS.forEach((d) => { hot[d] = globalThis.Engine.boomOf(state, d) === 'boom' ? 1 : 0; });
        }
        cands.sort((a, b2) => ((hot[b2.domain] || 0) - (hot[a.domain] || 0))
          || (dom ? ((b2.domain === dom) - (a.domain === dom)) : 0)
          || outputScore(0, b2) - outputScore(0, a));
      }
      else cands.sort((a, b2) => outputScore(0, b2) - outputScore(0, a));   // output
      state.slots.push(cands[0].id);
      filled = true;
    }
    return filled;
  }

  // ── UI 角标：暂停原因 ──
  function pauseReason(state, id) {
    const def = globalThis.NPC_BY_ID[id];
    if (!def) return '槽外';
    const st = statusOf(state, def);
    if (st !== 'courting') return '槽外';
    const ns = state.npcs[id] || { favor: 0, asset: false };
    if (!ns || ns.asset) return '';
    const stg = stageInfo(ns.favor).key;
    if (stg === 'ice') return '破冰期';
    const S = state.settings;
    if ((S.dailyBudget > 0 && state.spent.global >= S.dailyBudget)
      || (S.perNpcBudget > 0 && (state.spent.npc[id] || 0) >= S.perNpcBudget)) return '预算';
    if (onDuty(state)) return '在岗';
    const reserve = staminaReserve(state) * S.staminaMax;
    if (state.stamina < reserve) return '体力';
    return '';
  }

  globalThis.Agent = { decide, refillQueue, stageOf: stageInfo, whitelist, pauseReason, staminaReserve };
  if (typeof module !== 'undefined') module.exports = globalThis.Agent;
})();
