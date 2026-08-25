# v2 实现契约（各模块并行的唯一接口依据）

> 依据 `docs/drafts/alpha2/00~08`。数值表已在 `src/js/data/balance.js`（含 SETTINGS_DEFAULT/PRESETS）、
> 名册在 `npcs.js`、物品在 `items.js`。**本文是引擎/决策器/UI/测试四条并行线的边界契约，签名以本文为准。**

## 0. 文件所有权（改别人文件 = 事故）

| 拥有者 | 独占文件 |
| --- | --- |
| 契约层（已完成） | data/balance.js, data/npcs.js, data/items.js, 本文档 |
| T 文案 | data/texts.js |
| E 引擎 | engine.js |
| A 决策器 | agent.js |
| U UI | ui-bar.js, ui-panel.js, app.js, sprites.js, fx.js(如需), bar.html, style.css |
| V 测试 | tests/*.js |

## 1. 存档状态 schema v2（Engine.newState 产出；UI/Agent 只读约定字段）

```js
{
  v: 2, createdAt: ms, lastSeen: ms,
  gt: 0,                  // 游戏时间钟（ms，已含 timeScale）。所有冷却/期限/日界用 gt 比较
  gold: 10000, rep: 0,    // startGold 来自 settings
  stamina: 100.0,         // float，显示 floor
  attrs: { charm, talk, taste },
  slotCount: 3, slots: ['t1_gu', ...],   // 新档自动入槽顾言
  tier: 1,
  npcs: { id: { favor: 0, claimed: [], asset: false, referred: false } },
  seen: {},
  settings: { ...SETTINGS_DEFAULT, customMode: false },  // 见 balance.js 键名
  job: { id: 'restaurant'|null, shiftEndGt: null, resting: false },
  priority: 'work_first'|'ratio'|'social_first',         // 体力分配（02 §4.2）
  cds: { [npcId]: { wx: gtTs, wp: gtTs, mo: gtTs } },    // 冷却到期 gt 时间戳
  errandUsed: {},
  spent: { day: 0, global: 0, npc: {} },  // 日预算台账；day=dayIndex
  inv: [ { it: 'gift_box', q: 'fine', n: 1 } ], // 背包（Wave2 堆叠模型）：同名同品质并堆，n∈[1,99]，上限 invCap(state)
  drops: [ { uid, id(npcId), kind:'gold'|'item'|'letter'|'intel', itemId?, qty?, bornReal } ],
  lootNext: { [assetId]: gtTs },
  buffs: { dateOffGt: 0, attrHalf: false },
  invites: [ { id, expGt } ],
  hotspot: { day: -1, list: [ {name, tags} ] },
  intel: { [npcId]: { third:true?, line:true?, mine:true? } },
  weekReturn: { [npcId]: weekIdx },
  log: [ { gt, txt } ],                   // 决策日志，尾部最新，上限 settings.decisionLogDepth
  stats: { totalWage, totalInteract, totalWorkMs, totalLoot, totalDates },
  perks: {},                              // 成就 id -> true（达成即永久被动，next-iteration §2）
  capLevel: 0                             // 背包扩容档位（INV_CAP_UPGRADES 下标，§4）
}
```

## 2. Engine API（engine.js 导出 globalThis.Engine）

**保留 v1 签名**：`newState(now)`, `npc(state,id)`, `statusOf(state,def)`, `tierOpen`, `tierDef(t)`,
`auxAssets`, `auxBonus`, `autoFavorPerMin`, `interactGain`, `grantFavor(state,def,amt,events)`,
`addToSlot`, `removeFromSlot`, `upgradeAttr`, `expandSlot`, `canEnterTier`, `enterTier`,
`fmtMoney`, `fmtRate`, `attrCost(level)`（内部乘 priceRate）。

**新增/变更**：

```js
// 时钟与主循环
step(state, realDtMs, opts?) -> events[]      // 唯一推进口：体力再生/工作/挂机好感/掉落计时/
                                              // 日切(热点+邀约)/buff过期。opts.offline=true 时按离线口径
dayIndex(state) -> int                        // floor(gt / DAY_MS)
onDuty(state) -> bool                         // job.id && gt < shiftEndGt && !resting

// 产出期望（HUD"收入/秒"合并口径；资产已不再按秒给钱）
expectedIncomePerSec(state) -> number         // Σ v1口径金/秒（仅资产）
wagePerSec(state, nowReal) -> number          // 当前时薪/3600（含晚班倍率），无工作=0

// 渠道动作（免费池 + 手动同管线）。返回 {ok, msg?, gain?, cost?, events?}
wechat(state, id, nowReal)                    // +2 固定好感, 2体力, CD 30游戏分
moments(state, id)                            // +1, 0体力, CD 2游戏时
workplace(state, id, nowReal)                 // +3, 6体力, CD 60分; 仅T1且onDuty
interact(state, id, nowReal)                  // v1公式收益; 仅下班时段(onDuty时拒绝)

// 消费项目（05）。手动与决策器同价同表同护栏；超日预算 → ok:false '今日预算已用完'
priceOf(state, kind, size, tier, variantIdx?) -> int  // kind:'gift'|'date'|'errand'
favorOf(state, def, kind, size, variantIdx?) -> number // 含匹配系数/热点/favorPerYuanRate（不含事件倍率）
matchTags(def, variantIdx|tags, state) -> {coef:1.2|0.8, hit:bool}
spendGift(state, id, size, nowReal)           // 大礼品味门槛照旧
spendDate(state, id, kind, variantIdx, nowReal) // 内部掷事件表(08§2)+回礼判定(08§3)
spendErrand(state, id, nowReal)               // favor≥75 且每人一次
budgetLeftGlobal(state) / budgetLeftNpc(state, id) -> Infinity|number

// 工作（02 §3 方案A排班制）
hireJob(state, jobId) / quitJob(state)
startShift(state, hours, nowReal)             // shiftEndGt = gt + hours*3600000
stopShift(state)
shiftInfo(state, nowReal) -> { onDuty, resting, wagePerSec, endInMs }

// 掉落与背包（07 + Wave2 堆叠/扩容/自动出售）
rollLoot(state, def, rng) -> {kind, itemId?, qty?, rep?}   // 纯函数便于测试
collectDrop(state, uid, crit, rng) -> events  // 入包/入账；crit×2 仅金币包；从 state.drops 移除
invAdd(state, itemId, quality[, n], rng) -> bool  // 堆叠入包（n 缺省1，堆上限99）；满格挤普通（先低品质后旧），稀有永不自动消失
invCap(state) -> int                          // LOOT.INV_CAP + INV_CAP_UPGRADES[capLevel-1].cap
buyInvCap(state) -> {ok, msg, cap?}           // 金币坑扩容（5万/50万/500万 → 60/70/80 格）
autoSellRank(state) -> -1|0|1                 // autoSellGrade 阈值序；off=-1
sellUnitPrice(it) -> int                      // max(1, round(sell×SELL_RATE))
sellItem(state, idx[, n]) -> {ok, gold, sold} // 缺省售整堆；n 指定件数
useItem(state, idx, targetId?, rng) -> {ok, events}  // send 类走 targetId；消耗 1 件（n-1，归零移除）
sendItem(state, idx, targetId, rng)           // = useItem 的 send 分支别名
synthItems(state, picks[{i,n}], rng) -> {ok, gained:{id,q}, txt}  // 3合1升品质：Σn=SYNTH.NEED、同品质非稀有、全表随机产物
findSynthTriple(state) -> {grade, picks}|null // GM/便捷：自动挑一组可合成材料
dropHitTest 由 UI 完成：UI 读 state.drops 自行渲染

// 约会随机（08）
rollDateEvent(state, def, ctx{matched,hotspot}, rng) -> {key,label,mul,item?,intel?}
maybeReturnGift(state, def, rng) -> itemEntry|null   // 品质+1档；周限1
inviteRoll(state, rng)                     // 日切调用：为 favor≥40 NPC 判定 P=15%×匹配
acceptInvite(state, id, rng) -> events     // 免费正餐档约会（最佳匹配变体）
refreshHotspots(state, day, rng)

// 离线（04 §5：同一架构模拟）
settleOffline(state, nowReal, rng) -> report{
  awayMs, ms, capped,
  wage, packGold, letterRep, milestoneGold, milestoneRep, soldN,
  favors:[{id,name,gained}],
  actions:[{txt,n}],        // 聚合的决策动作（简报"主角动态"）
  package:[{it,q,n}],       // 离线掉落包裹（收下时 absorbOfflinePackage，带 n 计拾取成就）
  stageNotes:[txt]          // 阶段切换独白
}
absorbOfflinePackage(state, list[{it,q,n}]) -> [{it,q,n,ok}]  // 领取入口：逐条入包+计 totalLoot+成就检查

// 成就层（next-iteration §2）
checkAchievements(state, events)              // 达成写 state.perks 并推 {t:'ach'}；step/消费/掉落各管线自动调用
assetCount(state) / perkMul(state, key) / staminaMaxOf(state)

// 设置/GM（01 §2.2）
applyPreset(state, key)                // customMode=false
setSetting(state, key, val)            // customMode=true（pixelScale 除外）
gmGrant(state, kind, n)                // gold|rep|stamina|item(随机一件)
gmUnlockTier(state), gmAllFavor(state, +10)
migrate(rawObj) -> state|null          // v1→v2 迁移；损坏返回 null
```

**事件 shapes（events[] 元素，App.eventFx/UIPanel 消费）**

```js
{t:'favor', id, gain}
{t:'milestone', id, m, kind:'gold'|'rep', amount}
{t:'full', id, rep}
{t:'refer', id, by}
{t:'tier', tier}
{t:'stage', id, from, to, mono}            // 阶段切换（grantFavor 内检测）
{t:'date', id, key, label, mult}           // 约会事件结果
{t:'return', id, itemId}                   // NPC 回礼
{t:'drop', uid, id, kind, itemId?, qty?, q?}  // 掉落落地（UI 生成下落动画）
{t:'collect', txt}                          // 拾取浮字（UI 直接展示）
{t:'autosell', txt, itemId, q, gold}        // 阈值自动售出（浮字金色，同批 collect 同文案去重）
{t:'ach', id, name, perkText}               // 成就达成（toast + 大号浮字，toast 受 notifyLevel 门控）
{t:'synth', txt}                            // 合成结果（UI 大号浮字；引擎同步返回，UI 自行包装）
{t:'invite', id}                           // 收到邀约
{t:'item', txt}                            // 物品使用反馈
{t:'work', txt}                            // 上班提示（小费等）
```

## 3. Agent API（agent.js 导出 globalThis.Agent）

```js
decide(state, nowReal, rng) -> act|null
// act = { act:'interact'|'wechat'|'moments'|'workplace'|'gift'|'date'|'errand'|'item',
//         id, size?, kind?, variantIdx?, invIdx?, gain, cost, stamina, reason, score }
// 决策器只返回意图，由 app 调 Engine 对应函数执行（同价同表）。

refillQueue(state)              // autoSlotOrder ≠ off 且槽位有空时补位（不花槽位费/入场费）
stageOf(favor) -> {key,label,goal}   // 04 §2.2 五阶段（asset 由 statusOf 表达）
whitelist(stageKey, style) -> Set<actionKey>
pauseReason(state, id) -> ''|'预算'|'体力'|'冷却'|'在岗'|'破冰期'
scoreOf(...) 内部实现 L2 公式：
// score = Δfav×匹配×事件加成 ÷ (α×cost/gold + β×stamina)；里程碑差≤3 ×pushWeight；邀约×2；热点×1.2
```

阶段白名单（L1）：ice=免费动作（禁一切消费与 send 类物品）；warm=+轻约/小礼/中礼；
deep=+远行/大礼；close=+办事。风格调制：frugal=只免费+小礼；generous/lavish=跳过阶段门
（产品解锁条件仍生效）；lavish 正向事件权重+20%（在 rollDateEvent 内读 style）。
免费池优先级（04 §2.4）：职场互动 > 线下互动 > 微信 > 朋友圈 > 物品 > 邀约。
体力分配 reserve：work_first=75%、ratio=40%、social_first=0%（×staminaMax，低于则不动耗体动作）。

## 4. UI 约定（U）

- 面板页名：`gonglue 攻略｜beibao 背包｜gongzuo 工作｜shuxing 属性｜quanceng 圈层｜shezhi 设置｜houtai 管理后台`
- bar.html 脚本顺序：balance → npcs → items → texts → engine → agent → sprites → fx → ui-bar → ui-panel → app
- 动作按钮沿用 `data-action` 委托到 App.handleAction；新增 action：
  `wechat/moments/workplace/gift/date/errand/use-item/sell-item/hire/quit/shift/priority/
   preset-set/set-set/gm-*` 等，全部经 Engine/Agent，不得绕过护栏私改状态。
- 掉落表现：state.drops 渲染下落弹跳图标（emoji），autoPickup 开→3s 后调 collectDrop(uid,false)；
  关→点击拾取，落点 3s 内点中 crit=true。心跳每秒：Engine.step(state, elapsed) + Agent.decide 节流
  （settings.decisionIntervalSec 真实秒）。
- HUD：💰金币 🏅声望 ⚡体力(staminaMax 动态) 收入行 = expectedIncomePerSec + 在岗时薪，
  title 属性分项列明。热点角标画布右上角轮播。
- 主角小人（02 §3.3）：sprites.js 新增 PROTO 定义（复用 SUIT 底板），在岗穿工作服色立于舞台左端，
  下班缓动走向首个槽位旁；呼吸帧复用 frame 参数。
- 简报（离线 report）与决策日志（state.log 尾部 50 条）进 gonglue 页底部；档案卡六行
  （小传/产出/引荐/成本/偏好/一句价值）数据源 TEXTS.dossier[id] = {bio, value}，
  其余四行动态生成。notifyLevel 门控 App.notify。

### 4.1 Wave2-U 约定（next-iteration §1~§4 落地）

- 背包页：CSS grid `repeat(auto-fill, minmax(48px,1fr))` 方格槽位；品质边框色
  q-common/q-fine/q-rare；右下角数量角标（n>1）；分类页签 全部/礼物/消耗/票券/功能
  （按 effect.kind 分流，UIPanel.KIND_TAB_MAP 口径）；悬停 tooltip 走 window.Tip。
- 合成 3合1：背包页「合成」进入多选模式，点选凑满 SYNTH.NEED(3) 件同品质非稀有 →
  `synth-run`（Engine.synthItems）；synthBusy 防重复点击；产物全表随机并推 {t:'synth'} 浮字。
- 物品详情弹窗：大图标+名称/品质/效果/来源(src)/售价；[使用]（send 类二次选人 showItemTarget）
  [出售整堆] [关闭]；操作经 use-item/sell-item 原有管线。
- 名册页（gonglue）：网格卡片 minmax(190px,1fr)，圈层分组头保留；状态页签
  全部/可攻略/攻略中/人脉资产/已引荐（跨圈层过滤，空节隐藏，锁定卡半透明）；
  整卡点击开 NPC 详情弹窗（快捷操作行+档案六行+消费菜单），commit() 后 refreshModal 原地刷新；
  bar 舞台点 NPC → openPanel('gonglue', id) 定位卡片并弹详情，被页签过滤时回退「全部」。
- 属性页：底部「成就」分组列 BALANCE.ACHIEVEMENTS 五条（进度=stats[stat]/assets，
  totalWorkMs 按小时显示；lit=perks[id] 已亮起+被动生效中）。
- 设置页：autoSellGrade 三档 select（off/common/fine，data-set 管线）；「背包」组扩容按钮
  `cap-buy`（Engine.buyInvCap，已满级置灰）。
- 浮字坐标统一走 fxCtr/fxY（app.js）：取 #stage-wrap 可视区中心/底缘，
  自动适配窄条横向滚动与四边吸附，不再使用 innerWidth/barH 硬编码。

## 5. 测试约定（V）

纯 node 零依赖（沿用现有 ok/eq/near 风格）。入口：
- tests/test-engine.js（重写为 v2 口径：新档10000金、20点/分回复、渠道冷却、价目公式=礼物基准×倍数、
  匹配±、预算硬护栏、工作排班/歇业、掉落期望≈锚点（大数统计）、事件权重和=100、迁移 v1 存档）
- tests/test-agent.js（阶段白名单、免费池降级、预算超线切免费池、评分选最优、自动补位排序、
  开局红线集成模拟：大方 ≤14 分钟 / 标准 ≤20 分钟）

rng 注入：所有随机入口接受可选 rng 参数（默认 Math.random），测试传确定性序列。

## 6. 实现偏差记录（以代码为准的最终签名）

| 契约原文 | 实际实现 | 原因 |
| --- | --- | --- |
| `settleOffline(state, nowReal, rng)` | `(state, nowReal, rng, agentFn)` | 离线复用决策器模拟简报动作 |
| ——（未列） | `Engine.execAction(state, act, nowReal, rng)` | 手动/自动/离线三路共用的意图执行器 |
| `attrCost(level)` 内部乘 priceRate | `attrCost(level[, priceRate])`，priceRate 缺省取全局默认 | attrCost 无 state 可读；upgradeAttr 传 state.settings.priceRate |
| `qualityRoll(rng)` | `qualityRollWith(settings, rng, rareBoost)` | rareItemRate 是存档级参数需随 settings 传入 |
| 情报类掉落产生物品 | 直接调用 `revealIntel` 即时揭示，不占背包 | 文档缺口裁决：08 §6 情报机制不依赖背包道具 |
| `TEXTS.work.tip` | 数据就绪、暂未被 UI 消费 | 引擎小费事件直接输出文本，文案池留作后续替换 |
| 界面组 pixelScale | 不进 settings，由 main.js cfg 管理 | 缩放涉及窗口尺寸属主进程职责 |
| `invAdd(state, itemId, quality, rng)` | `invAdd(state, itemId, q[, n], rng)`，第4参为数量 | Wave2 堆叠模型（§3.3.1）；rng 顺延为第5参 |
| 背包条目 `{it,q}` | `{it,q,n}`（n 缺省按 1，迁移兼容旧档） | 堆叠模型；useItem/sellItem/invAdd 三处同步改造 |
| 名册卡片行内展开区 | 整卡点击开详情弹窗，操作后 refreshModal 原地刷新 | next-iteration §3.3.2 验收口径 |
| collect 浮字由 app.collectDrop 直绘 | 统一走 App.eventFx `{t:'collect'}` 分支 | autosell/暴击配色与同批去重集中处理 |
| Fx 浮字 y 用 barH 硬编码 | fxCtr/fxY 读 #stage-wrap 可视区 | Wave1-B 四边吸附 + 窄条滚动适配（B 侧提示） |
| 布局仅 applyBounds 时广播 | 新增 `ipcMain.handle('layout:get')` + preload `api.getLayout`，ui-bar 初始化主动拉一次 | 冷启动首条广播早于渲染层监听注册会丢，wr 恒为 full 塞 1/5 条（实机视检发现） |
| 物品弹窗刷新按 idx 校验 | modalCtx 记录 `{it,q}` 身份，不匹配即关窗 | 堆叠 splice 左移后 idx 命中他条目：出售后弹窗不关且串位显示别物（实机视检发现） |
| `.q-*` 边框色直接用于 .bag-cell | 追加 `.bag-cell.q-*` 双类名规则 | 同特异性下后者覆盖，品质边框全部退化为 var(--line)（实机视检发现） |
