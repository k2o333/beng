# 人脉圈 · alpha4 数值与系统高维优化方案（总览）

> **定位**：用开源游戏策划/数值类 Agent Skills 的方法论，对 `alpha3/09-full-gdd.md`（实现快照）做一次**结构层复盘**。
> 不是调参清单——调参交给模拟器；本方案回答的是「哪些维度缺失、哪些结构可以升维」。
> 排期与版本门禁见 [00-iteration-plan.md](./00-iteration-plan.md)；评审意见直接批注。

## 0. 方法论输入源

| Skill | 来源 | 本文吸收什么 | 落点 |
| --- | --- | --- | --- |
| game-design（《游戏设计的100个原理》） | [jasonxu610/game-design-skills](https://github.com/jasonxu610/game-design-skills) | 核心循环动词化、心流/节奏、三角性（风险↔回报）、Hick 定律、囤积行为、快速平衡法（加倍/减半） | 03 §S6/S7、04 排期 |
| 游戏数值策划（《游戏数值设定入门》） | [ClawHub @wangssi1998-cell](https://clawhub.ai/wangssi1998-cell/game-numeric-design) | **五特性模型**（生成/成长/消亡/变化/联系）、公式工具库（幂函数/数列/正态分布）、临界值模板、目标反推法 | 03 §1 审计表全篇 |
| machinations-diagrams | [adempus/machinations-skill](https://github.com/adempus/machinations-skill) | 经济=资源流+反馈环；source/drain/converter/trader 语义；**每个放大环必须配摩擦**；模式词表（dynamic engine / friction / escalation） | 01 全篇 |
| balance-check | [Donchitos/Claude-Code-Game-Studios](https://github.com/Donchitos/Claude-Code-Game-Studios) `.claude/skills/balance-check` | faucet/sink 映射、死区/尖峰检测、主导策略检测、掉落 ETA、报告输出格式 | 02 全篇 |

辅助参考：[zsc.github.io/numeric_planner_tutorial](https://zsc.github.io/numeric_planner_tutorial) 第 12 章（数据驱动平衡）与第 17 章（数值工具链）。

## 1. 核心结论 TL;DR

1. **最大的缺口不是某个数，而是「校准手段」**：GDD §19 开放问题 #4/#5/#9 全是「未经模拟校准」的曲线问题。alpha4 第一优先级 = 建无头模拟器 + 静态 balance 报告脚本，把所有调参从拍脑袋变成看曲线（02）。
2. **经济有回路视角盲区**：现有数值全景图是表格视角；按 machinations 重画后可见三个嵌套正反馈环（金币环/人脉环/职级环），负反馈全部集中在关系侧，收入侧长期只有 `mult^0.5` 一个阻尼——需要确认这是有意设计还是欠配摩擦（01）。
3. **五特性审计显示两个维度系统性缺失**：「消亡」（衰减/淘汰）与「变化」（环境波动）在几乎所有模块上为零。补法不是加压力，而是加**可关的旋钮**：行业景气轮换（变化）+ 关系衰减 Lite（消亡，默认 off）（03 S1/S2）。
4. **掉落缺确定性补偿**：稀有装备期望 ≈4000 次掉落（单资产约 100+ 游戏小时），「毕业装」情感实际上不可达。透明 pity 计数器既符合红线 4（掉率透明），又直接修复开放问题 #7（03 S3）。
5. **宠物/成就是同一套计数管线上的免费升维位**：宠物三阶成长 + 成就二阶，零新系统、纯数据表改动，给长线玩家复利可视化（03 S4/S5）。

## 2. 文件导览

| 文件 | 内容 |
| --- | --- |
| [00-iteration-plan.md](./00-iteration-plan.md) | **总体迭代方案（排期入口）**：目标/范围分级/三周里程碑/风险/验收门禁 |
| [01-economy-feedback-model.md](./01-economy-feedback-model.md) | 经济反馈回路建模：资源分类、三重正环审计、负反馈盘点、模式命名与摩擦缺口 |
| [02-calibration-and-balance-report.md](./02-calibration-and-balance-report.md) | 模拟校准框架 sim.js 设计、`npm run balance` 静态报告、六条待验证疑点 H1~H6、校准目标表 |
| [03-system-upgrades.md](./03-system-upgrades.md) | 五特性逐模块审计表 + 八项系统改造（景气轮换/衰减Lite/掉落pity/宠物三阶/成就二阶/风险三角/Build预设/词条扩容） |
| [04-roadmap.md](./04-roadmap.md) | 切片排期、依赖图、决策点清单、验收基线、红线自查 |

## 3. 与 alpha3 开放问题（§19）的对应

| 开放问题 | 本方案回应 | 状态 |
| --- | --- | --- |
| #3 连携门槛是否偏晚 | 02 sim 策略组覆盖「前期连携流」，出数据后再定 needOther 4→3 | ✅ 已回应：sim 策略组分化验证通过，needOther 维持 4（见 docs/reports/alpha4-h1h6-conclusions.md） |
| #4 业务周期是否偏慢 | 02 校准目标表定义「每圈层停留天数」区间，sim 出时刻表 | ✅ 已回应：校准后 standard P50 六项主里程碑全部落入区间 |
| #5 提成曲线未校准 | 02 主目标，sim.js 的第一个任务 | ✅ 已回应：sim.js + balance 报告入库，commissionScale 维持 1.0（提成占比由业务量门槛整形约束） |
| #6 人脉永续不衰减 | 03 S2 衰减 Lite（默认 off 旋钮，先模拟后开启） | ✅ 已回应：decayEnabled=false 上线，设置页可见可开 |
| #7 装备 2 槽毕业感 | 03 S3 掉落 pity 让稀有品质可达 | ✅ 已回应：pityRare 240 / pityEquip 120（func 分支口径），背包双条+档案卡公示 |
| #9 洗点定价 | 03 S7 试洗券（每圈层一次半价）；定价由 02 模拟数据定 | ✅ 已回应：首免保留 + 每圈层首通发券半价，实机验证通过 |

不回应项：#1（天赋网轻重——结构已实装且验收通过，动它性价比低）、#2（现实时钟基调）、#8（创业 Lite）、#10（命名美术）。

> alpha4 落地归档（04 §维护约定）：本表已全部打勾；实现记录见 `docs/dev/alpha4-impl.md`，数值结论见 `docs/reports/alpha4-h1h6-conclusions.md`。遗留决策：D6 宠物三阶阈值二修（2000→24，已按 sim 证据应用待追认）、D7 成就 II 阶目标是否随约会经济下调（未应用，待拍板）。
