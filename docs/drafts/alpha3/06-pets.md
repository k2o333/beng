# 06 · 宠物系统

> 口径源：`growth-evolution-mini.md` §3 + gamemad TBH 宠物说明。
> 照抄 TBH 四定理：**永久全局生效 / 无需上阵 / 可叠加无上限 / 越早解锁复利越大**。

## 解锁与生效链路

```mermaid
flowchart LR
    subgraph CNT["stats 累计计数器（现成字段）"]
        C1["累计约会次数"]
        C2["累计上班时长 h"]
        C3["累计掉落件数"]
    end

    C1 -->|"≥ 200 次"| P1["伙伴·暖手<br/>全局好感 +5%"]
    C2 -->|"≥ 100 h"| P2["伙伴·账房<br/>全局金币收入 +8%"]
    C3 -->|"≥ 500 件"| P3["伙伴·拾荒<br/>掉落间隔 −6%"]

    P1 & P2 & P3 --> REG["解锁即永久注册进 bonuses<br/>存档 pets{unlocked[]}"]
    P1 & P2 & P3 --> SPR["条上像素伙伴跟随<br/>复用 sprites 管线（可见收集层）"]
```

## 与成就 perks 的分工

```mermaid
flowchart LR
    subgraph HIDDEN["隐藏被动层（不动）"]
        PERK["成就 perks：<br/>达成即得，设置页展示，无常驻形象"]
    end
    subgraph VISIBLE["可见收集层（新增）"]
        PET["宠物：累计行为解锁，<br/>条上有形象，属性页一览表"]
    end
    PERK --> AGG["bonuses 聚合器"]
    PET --> AGG
```

## 后置项（只记录不实施）

- 更多宠物按新行为计数器扩充（累计识人次数 / 完成业务单数）；
- DLC 卖宠物的商业化路线：TBH 案例为「付费弱于免费」反教材，若上 Steam 只做外观向。

## 备注

- 首版 3 只对应三资源；数值全部进 balance.js 可后台调。
- 成本约 2~3 天（依赖 01 聚合器 + sprites）。
