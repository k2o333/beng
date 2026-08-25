# alpha3 · 成长与职业系统图集（Mermaid）

> 本目录只放图，不放口径。数值权威源：`growth-evolution-mini.md`（成长四件套）+ `career-numbers-mini.md`（职业数值）。
> 已实装系统（NPC 名册 / 决策器 Agent / 消费菜单）只作边界节点出现，不在本目录展开。

## 总览：实现后的完整循环

```mermaid
flowchart TB
    subgraph SOCIAL["循环A · 社会关系（已实装）"]
        NPC["NPC名册：30人 × 5圈层"] -->|"识人 → 博弈 → 好感里程碑"| REL["关系阶段：破冰/升温/深交/收网"]
        REL --> NETIN["行业人脉计入"]
    end

    NETIN --> NET["行业人脉：金融/地产/高科技 + 总人脉"]
    NET -->|"满足业务模板条件"| BIZ["业务单：现实30分/单，放置自动跑"]
    BIZ -->|"累计业务量 ≥ 门槛"| CAREER["打工十级：副专员→总裁"]
    BIZ -.->|"分成65%（后置）"| STARTUP["创业线：需信任/价值感门槛"]

    CAREER -->|"升职 → 技能点 +1"| SKILL["关系天赋网：四层节点+基石互斥对"]
    CAREER -->|"职级津贴 + 提成"| MONEY["金币收入"]

    SKILL --> AGG
    EQ["装备槽×2：手表/首饰"] --> AGG
    PET["宠物：账号级永久被动"] --> AGG
    PERK["成就 perks（已有）"] --> AGG
    ADMIN["管理后台总旋钮"] --> AGG

    AGG["① bonuses聚合器<br/>flat → add → mul 固定叠序"] -->|"好感 / 收入 / 体力 / 掉落"| SOCIAL
    MONEY --> SPEND["消费菜单：送礼/约会/办事"]
    SPEND -->|"好感↑"| REL
```

## 文件索引

| 文件 | 模块 | 图 |
| --- | --- | --- |
| [01-bonus-aggregator.md](01-bonus-aggregator.md) | 数值底座 | 聚合管线图 + 结算时序图 |
| [02-network.md](02-network.md) | 行业人脉 | 派生计算图 + 业务闸门用法 |
| [03-career-business.md](03-career-business.md) | 职业/业务 | 跑单管线图 + 业务单状态机 |
| [04-skills.md](04-skills.md) | 关系天赋网 | 全树拓扑图 + 点数经济 + 洗点与实现 |
| [05-items-equipment.md](05-items-equipment.md) | 物品/装备 | 物品生命周期图 |
| [06-pets.md](06-pets.md) | 宠物 | 解锁与生效链路图 |
| [07-all-in-one.md](07-all-in-one.md) | **全模块总图** | 单图整合 01~06 与已实装系统（含配色图例与阅读顺序） |
| [08-numbers-map.md](08-numbers-map.md) | **数值全景速查** | 资源流向总图 + 已有/规划数值明细表 + 公式速查 + 通胀护栏 |
| [09-full-gdd.md](09-full-gdd.md) | **完整策划案（单文件）** | 截至 alpha3 的全部设计整合一册，供外部策划通读评审；含开放问题清单 |

## 实现顺序（依赖关系）

```mermaid
flowchart LR
    A["01 聚合器<br/>半天"] --> B["02 人脉标注<br/>1天"]
    B --> C["03 业务管线 MVP<br/>2~3天"]
    C --> D["04 天赋网挂钩<br/>0.5天（拓扑UI另计约4~5天）"]
    A --> E["05 装备槽<br/>2天"]
    A --> F["06 宠物<br/>2~3天"]
    C -.->|"三维关系改造后"| G["创业线（后置）"]
```

## 存档契约（全模块共用）

v2 → v3 迁移幂等，仅新增四组字段：

```mermaid
flowchart LR
    OLD["save.json v2"] --> MIG["engine.migrate()<br/>缺省补齐，旧字段不动"]
    MIG --> NEW["v3 新增：<br/>career{industry,level,bizVolumeTotal,currentBiz}<br/>skills{points,nodes}<br/>equips{watch,jewel}<br/>pets{unlocked[]}"]
```
