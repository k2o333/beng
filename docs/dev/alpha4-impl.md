# alpha4 实现记录（校准驱动 + 维度补全）

> 依据 `docs/drafts/alpha4/00~04` 方案落地。本文是当期实现快照：改了什么、验证结果、遗留决策。
> 数值结论与 H1~H6 判定见 `docs/reports/alpha4-h1h6-conclusions.md`；静态体检见 `docs/reports/balance.md`。

## 1. 交付清单（对照 00 §2 范围分级）

| 级别 | 项 | 状态 | 落点 |
| --- | --- | --- | --- |
| P0 | ① sim.js 无头模拟器 | ✅ | `scripts/sim.js`（5 策略 × R 默认 200，`--quick` R=20，worker 分片，确定性种子，卡点诊断自动输出） |
| P0 | ② balance 静态报告 | ✅ | `scripts/balance-report.js` → `docs/reports/balance.md`（§A~§F，含死配置自检） |
| P0 | ③ 数据校准 patch | ✅ | `balance.js` 只动旋钮与表数据，6 次迭代收敛（§3） |
| P0 | ④ 掉落 pity S3 | ✅ | `loot.pityRare/240`、`loot.pityEquip/120`（**func 分支口径**，评审修正）；背包双条 + 档案卡公示 + GM 重置 |
| P1 | ⑤ 宠物三阶 S4 | ✅ | `PETS[].stages[3]`，`pets{id:stage}`；条上阶段徽标/进度条，条上 emoji 随阶缩放（像素变体让位，见 §6 偏差 D6-2） |
| P1 | ⑥ 成就二阶 S5 | ✅ | ACHIEVEMENTS +5 条（goal×5，效果=一阶+一半），复用同一检查器 |
| P1 | ⑦ Build 预设+试洗券 S7 | ✅ | `SKILL_PRESETS` 三套 + `applyBuildPreset`；`wash.vouchers/tierDone`，首免优先、券半价一次 |
| P1 | ⑧ 存档 v3→v4 | ✅ | SAVE_VERSION=4，链式幂等迁移（pity/pets/boom/wash/lastActGt + **校准重定基**，见 §4） |
| P2 | ⑨ 景气轮换 S1 + 词条扩容 S8 | ✅ | 周切三档（30/45/25，±20%/−15%），业务量与人脉计入双乘区；COND_FNS +boomHot/hasInvite/riskyRun；i15/s15/c15 转 choice 二选一 |
| P2 | ⑩ 风险三角 S6 | ✅ | T3/4/5 各 1 条 `certainty:'risky'`（vol 烘焙 ×1.15），jit∈[0.7,1.3] 独立乘区，与 k3a/k3b 正交复合 |
| P2 | ⑪ 衰减 Lite S2 | ✅ | `decayEnabled=false` 默认 off（customMode 豁免），≥50 好感 3 日未互动 −1/日，阶段下限钳制，资产免疫 |
| 清理 | REP_PASSIVE / wechatEfficiency | ✅ 已删除 | 01 §4 处置，balance-report §F 永久自检 |

## 2. 工程过程（多 subagent 并行：开发 / debug / review）

- Wave1（并行）：sim.js 与 balance-report.js 双 agent 分治 → 交叉评审揪出 2 blocker（报告 R=8 出货、策略组同质化）→ 修复 agent 全项闭环（策略点数银行、绑定约束诊断、诚实报告头）。
- Wave2（开发 ∥ Wave1 评审）：S3/S4/S5/v4 迁移 + UI + 测试（+117 断言）。
- Wave3（开发 ∥ Wave2 评审）：S1/S6/S2/S7/S8（+94 断言）；评审 finding1（pityEquip 分支口径）+ minors 当场修复。
- 校准：独立 agent 迭代调参（只授权 balance.js 表数据），sim 证据驱动。
- 终审：实机 UI 操作审核（CDP 驱动 + 逐页截图），发现 5 个问题全部修复（§5）。
- 测试基线：283+16 → **514+16 全绿**。

## 3. 校准结果（D1 采纳目标表，standard P50，R=80）

| 里程碑 | 目标区间 | P50 | 判定 |
| --- | --- | --- | --- |
| 首资产 | 1~2 日 | 1.00 | ✅ 贴下限（残余风险 R1） |
| T2 精英圈 | 3~5 | 4.26 | ✅ |
| T3 名流圈 | 8~14 | 11.89 | ✅ |
| T4 富豪圈 | 18~30 | 24.56 | ✅ |
| T5 顶层圈 | 35~60 | 43.73 | ✅ |
| 职级10 总裁 | 45~75 | 49.57 | ✅ |
| 全成就+宠物III | 60~90 | 宠物III 达标（D6 二修后）；全成就结构性受阻 | ⚠ 待拍板 D7 |

主要旋钮动作（完整 changelog 见结论文档）：dropValueRate 1→0.08、dropIntervalRate ×2、TIERS.restraint 24~42（原 1~3）、渠道好感压低+CD 120、favorPerYuanRate 0.35、regen 12/互动耗 30、ATTR_COST_GROWTH 1.7→1.24（拆 T5 品味硬墙）、CAREER need 整形（总裁 25万万→120万万）、约会好感 +33%、日/人预算 26000/6000。

## 4. 存档 v4 迁移（D7 合并一次）

- 新增：`loot{pityRare,pityEquip}`、`pets{id:stage}`（unlocked[] 映射 stage:1）、`career.boom{finance,estate,tech}` + `career.boomWeek` 游标、`wash{vouchers,tierDone}`、`npcs[].lastActGt`。
- **校准重定基**（实机审核发现后补）：v3→v4 且 `customMode=false` 的档，8 个平衡旋钮（regen/互动耗/微信耗/掉落间隔/掉落价值/付费好感/日预算/人预算）对齐新默认——否则旧档带 alpha3 节奏永远偏离校准曲线；自定义档（customMode=true）保留玩家值。
- 幂等：双迁移逐字节一致（含 boomWeek 无版本号字段）；v1/v2/v3 全链路测试在位。

## 5. 实机 UI 审核记录（CDP 驱动 + 逐页截图）

环境：Electron 实机运行，DPI 150%（截图须物理像素；CDP `Page.captureScreenshot` 在锁屏下仍可用）。

| # | 发现 | 修复 |
| --- | --- | --- |
| U1 | 离线简报/确认框在条窗态被 96px 窗口裁剪 | `openOverlay` 借伪页面 `'modal'` 展开窗口，`closeOverlay` 回收（render 对未知页名天然空渲染） |
| U2 | **右键宽度菜单显示不全**（用户报告）：DOM 菜单钳位到 `innerHeight-h-4` 负值 | 连同 ☰ 页签收纳菜单一并改为**原生 Electron 菜单**（`bar:nativemenu` IPC，radio 勾选档位，点外关闭返回 null）；删除 #ctx-menu/#act-menu DOM 与 CSS |
| U3 | 背包页整页空白：htmlBeibao 引用了档案卡局部帮助函数 `rate()`（ReferenceError 使 render 中断且静默） | 提升为模块级 `setRate(st,k,d)`，两处公示共用 |
| U4 | 9 个天赋节点（k1a/k1b/k2a/k2b/k3a/k3b/y1/y2/y3）缺 `name` → 节点标题 undefined（alpha3 遗留） | 补齐命名：广撒网/深耕/夜猫子/日行者/稳健派/豪赌派/情报网/跨界联动/名利双收 |
| U5 | 旧档 settings 保留 alpha3 值，校准不生效（后台显示 regen 20/互动 10） | 见 §4 重定基 |

逐页验证通过：背包（保底双条+掉率公示）、成长（景气/平稳/低谷角标、风险单徽标、溢价基准量 127万、三预设+确认弹窗、二选一节点、伙伴三阶进度、试洗券半价提示）、属性（成就 II 条目）、设置（衰减开关+说明）、管理后台（重置保底实测 100/50→0/0）、工作/圈层/攻略（门槛展示正常）。景气乘区实机证据：boom 态结单 22万→26.4万（×1.2）。

## 6. 偏差与待拍板

| # | 事项 | 说明 |
| --- | --- | --- |
| D6 | 宠物·暖手三阶阈值 200/600/2000 → **8/16/24**（已应用待追认） | sim 实测：totalDates 前期 ~5/日冲到 ~24 后因名册资产化**平台化**（d30~100 P50=24.0~24.5）；2000 不可达、30+ 永不达成，取可达；III 实测 P50≈d5。60~90 锚定需 alpha5 结构提案（回忆约会/高圈层 NPC 分批入场），见结论文档 D6 |
| D7 | 成就 II 阶目标是否随约会/互动经济下调（**未应用**） | touch 5000 / social 500 等按当前行动经济 100 日内不可达；全成就日因此超出目标行，需拍板：下调目标 or 接受超窗 |
| 偏差1 | risky 溢价取整口径统一为半进位（126.5→127） | 评审 nit，测试同步 |
| 偏差2 | S4「条上形象换色/配饰」以阶段徽标+缩放代替像素变体 | 宠物走 emoji 管线，像素三阶变体留待 alpha5 立项 |
| 偏差3 | boomHot 同时受 boomEnabled 总开关约束 | 关闭总开关后陈旧枚举不再触发词条，口径一致 |
| 偏差4 | GM 解锁圈层不发放试洗券/技能点（走 enterTier 正常路径才发） | GM 捷径语义，单测覆盖正常路径 |
| 风险R1 | 首资产 P50 贴 1.0 日下限 | 若实测偏快，下一轮微调 restraint T1 档 |
| 遗留 | 原生右键菜单的视觉复核需解锁桌面会话后人工确认一次 | 锁屏期间 CDP 全功能验证通过（菜单管线 promise 正常 settle） |

## 7. 复跑指引

```bash
npm test                # 514+16 全绿
npm run balance         # 静态体检 → docs/reports/balance.md
npm run sim -- --quick  # R=20 冒烟（≈6 分钟，5 策略）
node scripts/sim.js --strategies=standard --runs=80   # 校准口径复验
npm start               # 实机（托盘退出；右键条=宽度档；☰ 仅 tiny 宽度档出现）
```
