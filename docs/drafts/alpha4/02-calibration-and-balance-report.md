# 02 · 模拟校准框架与 Balance 报告

> 方法：balance-check skill 的五阶段（定域→读数据→读设计目标→分析→报告）+ 数值策划教程「目标反推法」。
> 本篇解决一个元问题：**alpha3 所有曲线都没有校准工具**（GDD §19 #5 原话「未经模拟校准」）。先造尺子，再量数。

## 1. sim.js 无头模拟器（第一优先级）

### 1.1 形态

```text
scripts/sim.js
  复用 engine.js 的纯函数层（step / grantFavor / settleBiz / pickBestBiz）
  输入：策略配置 + 天数 N + 运行次数 R
  输出：docs/reports/sim-[strategy]-[date].json → 汇总表 markdown
```

引擎已是确定性时间步进、决策器已 L0~L3 分层——模拟器只需把 `decisionIntervalSec` 调小、禁用 UI 事件，即可让 Agent 全自动跑图。`npm test` 已证明引擎可无头运行（283 项用例），成本低。

### 1.2 策略矩阵（覆盖 Build 光谱）

| 策略 | settings 组合 | 验证什么 |
| --- | --- | --- |
| frugal-net | frugal + autoSlotOrder=gap + 广撒网基石 | 白嫖流下限 |
| standard | standard 默认 | 中位体验（主口径） |
| lavish-deep | lavish + 深耕 + 知心 + 豪赌派 | 上限/主导策略检测 |
| night-owl | 夜猫子 + 夜班挂机 | 时段基石收益差 |
| synergy-early | 优先点连携（needOther 压满） | 开放问题 #3 前期张力 |

每次运行 R=200 取分位数（P25/P50/P75），抖动类数值（JITTER/PACK_JITTER/约会事件）天然蒙特卡洛。

### 1.3 输出指标

- 金币/游戏日曲线（分位数带）；各收入源占比随天数迁移（工资/掉落/提成/津贴/售物）；
- 关键时刻表：首资产、T2/T3/T4/T5 进入日、职级 2/4/6/8/10 日、全成就日、宠物解锁日；
- 动作性价比矩阵：每动作 gold-per-favor / stamina-per-favor，按圈层分层（balance-check 的 dominant-option 检测）；
- 死区检测：相邻门槛间预期空转天数 > 阈值即标记；尖峰检测：单日能力跳变倍数。

## 2. `npm run balance` 静态报告脚本

不需要跑模拟、每次改 balance.js 后即时可看的体检报告（balance-check Phase 4 清单的静态子集）：

```text
scripts/balance-report.js
  读 balance.js + npcs.js + items.js，输出 docs/reports/balance.md：
  §A faucet/sink 映射表（来源×去向×速率公式，来自 01 §2/§3）
  §B 动作性价比矩阵（静态部分：固定好感动作的 gold/favor 曲线）
  §C 掉落 ETA 表：每种物品品质×类型的期望掉落次数与时长的解析解
  §D 成本断点：属性升级边际收益拐点等级（150×1.7^lv vs +0.04 favor/分的回本周数）
  §E 门槛台阶比：rep/fee/taste 相邻圈层跳变倍数表
```

## 3. 待验证疑点清单（假设 H1~H6，全部交给上面两把尺子）

| # | 疑点 | 当前手算指标 | 判定标准 |
| --- | --- | --- | --- |
| H1 | 收入结构后期是否向业务单边倾斜（提成 vol 增长 ×520 vs 掉落净增速 ×33 vs 工资恒定） | T5 提成单 ≈ 88万金/单 vs 工资 45/h | 各收入源 P50 占比不应有 >90% 的独占期；若独占，考虑津贴/掉落补一档 |
| H2 | **稀有装备实际不可达**：func(10~45%) × equip(8%) × rare(3%) ≈ 万分之几/掉落 | 单资产期望 ≈4000 掉落 ≈ 100+ 游戏小时 | 引入 S3 pity 后 ETA 应落在「总裁前可达」区间 |
| H3 | T3→T4 门槛死区：rep ×5.8、入场费 ×15、品味 10→25 三重同时跳 | 手算中位玩家在此停留最长 | sim 时刻表中单圈层停留 ≤ 目标区间上限（§4） |
| H4 | errand 性价比倒挂检查：80 gold/favor vs 大礼 32、匹配约会最优 ~9 | — | 不应成为唯一理性选择（每人限一次已兜底，验证即可） |
| H5 | 属性指数成本 vs 线性收益的弃坑点：+8%/级的 favor 增益对 1.7^lv 成本 | lv12≈2.9万/级 | 弃坑点应晚于 T3 达成；否则成本基数降为 120 或指数降 1.65 |
| H6 | 死配置（REP_PASSIVE / wechatEfficiency） | 未接线 | 按 01 §4 处置后从报告消失 |

## 4. 校准目标表（先拍板再模拟）

> 数值策划 skill 的「确定目标→反推数值」：没有目标函数就没有校准。以下区间为建议值【待拍板】。

| 里程碑 | 目标区间（standard 策略 P50） |
| --- | --- |
| 首资产 | 第 1~2 游戏日 |
| T2 精英圈 | 第 3~5 日 |
| T3 名流圈 | 第 8~14 日 |
| T4 富豪圈 | 第 18~30 日 |
| T5 顶层圈 | 第 35~60 日 |
| 职级 10 总裁 | 第 45~75 日 |
| 全成就 + 宠物 III 阶 | 第 60~90 日 |

超出区间 → 动 02 号总旋钮（bizSpeed / dropValueRate / priceRate），不动结构。每个圈层「有意义决策数」（换 Build、接风险单、换主攻域）≥2 次/停留期，低于此视为死区。

## 5. 与 CI 的关系

- `npm run balance`：每次 PR 改 balance.js 必跑，报告入库供 diff；
- `npm run sim -- --quick`：R=20 快档，冒烟级回归（防某词条改动把 T5 时间推爆）；
- 全量 R=200 仅在调参周跑。
