# 07 · 全模块总图（All-in-One）

> 整合 01~06 与已实装系统为一张图。口径权威源不变：
> `growth-evolution-mini.md` + `career-numbers-mini.md`；各模块细节见同目录 01~06。

## 图例

| 样式 | 含义 |
| --- | --- |
| 蓝灰实底 | 已实装（NPC 名册 / 决策器 / 消费菜单 / 成就 perks） |
| 金色实底 | 本轮规划新增（①聚合器 ②人脉 ③职业 ④技能 ⑤物品装备 ⑥宠物） |
| 灰色虚边 | 后置项（创业线 / 存档联动为虚线仅示意归属） |

## 总图

```mermaid
flowchart TB
    classDef done fill:#e8ecf4,stroke:#5b6b8c,color:#1a2438
    classDef core fill:#fff3d6,stroke:#c9a13b,color:#3a2f10
    classDef defer fill:#f2f2f2,stroke:#9a9a9a,color:#555,stroke-dasharray:4

    subgraph A["循环A · 社会关系（已实装）"]
        NPC["NPC 名册：30 人 × 5 圈层<br/>新增 domain 标注"]:::done
        REL["关系阶段：破冰→升温→深交→收网<br/>好感里程碑 25 / 50 / 75"]:::done
        AGENT["决策器 Agent L0~L3"]:::done
        NPC -->|"识人 → 博弈"| REL
        AGENT -.->|"自动攻略队列"| NPC
    end

    subgraph N["② 行业人脉"]
        NET["金融 / 地产 / 高科技 + 总人脉<br/>NETWORK_VALUE t1=2 … t5=16，派生值不进存档"]:::core
    end
    REL -->|"里程碑解锁 30% / 60% / 100%"| NET
    NET -->|"缺口反馈：「缺一个银行家」"| AGENT

    subgraph C["③ 职业 · 业务线"]
        POOL["模板池 ~12 条，按圈层解锁"]:::core
        RUN["当前业务单：30 分/单<br/>效率 = min(人脉比, 类型计数比…)"]:::core
        VOL[("累计业务量（万）")]:::core
        LVL{"≥ 下级门槛？"}:::core
        LVL10["打工十级：副专员 → 总裁<br/>提成率 8→18% + 津贴递增"]:::core
        POOL --> RUN
        RUN --> VOL
        VOL --> LVL
        LVL -->|"是"| LVL10
        LVL -->|"否"| POOL
    end
    NET -->|"闸门实时比对"| RUN
    AGENT -->|"放置期自动接单 / 换单"| POOL

    S0["创业线：分成 65% ≈ 打工×10<br/>门槛 = 信任 / 价值感"]:::defer
    LVL10 -.->|"三维关系改造后"| S0

    subgraph G["① bonuses 聚合器（数值底座）"]
        AGG["final = (base+Σflat) × (1+min(Σadd,cap)) × 连乘mul<br/>全来源只注册词条 {attr, kind, value}"]:::core
    end

    LVL10 -->|"津贴 + 提成 → 金币"| AGG
    LVL10 -->|"升职发技能点 +1"| SKP

    subgraph K["④ 关系天赋网"]
        SKP[("技能点余额")]:::core
        TREE["支点/精华/大节点/基石互斥对/跨系连携<br/>收入 14 点 vs 需求 ≈29 点，永远不够"]:::core
        SKP --> TREE
    end
    TREE --> AGG

    subgraph I["⑤ 物品 · 装备"]
        DROP["掉落 rollLoot：品质 80 / 17 / 3<br/>稀有度光效 + 播报"]:::core
        INV[("背包 ≤50 → 扩容 80")]:::core
        SYN["3 合 1 升品质"]:::core
        EQS["装备槽 ×2：手表 / 首饰<br/>常驻词条进聚合器"]:::core
        DROP --> INV
        INV --> SYN --> INV
        INV --> EQS
    end
    NPC -->|"满级资产周期掉落"| DROP
    EQS --> AGG

    subgraph P["⑥ 宠物（账号级永久被动）"]
        CNT["stats 计数器：<br/>约会 200 次 / 上班 100h / 掉落 500 件"]:::core
        PET["3 伙伴：好感+% / 金币+% / 掉落−%<br/>可叠加无上限 · 条上像素形象"]:::core
        CNT --> PET
    end
    PET --> AGG

    PERK["成就 perks（已实装，隐藏层不动）"]:::done --> AGG
    ADMIN["管理后台总旋钮 ×5<br/>bizSpeed / 门槛 / 人脉 / 提成 / 模式"]:::core --> AGG

    subgraph O["结算出口（唯一取值点）"]
        FAV["自动好感 / 互动公式"]
        INC["收入：时薪保底 + 提成主轨"]
        STM["体力上限 / 恢复"]
        LOOTSPD["掉落间隔 / 品质权重"]
    end
    AGG --> FAV & INC & STM & LOOTSPD
    FAV -->|"好感 ↑"| REL

    INC --> SPEND["消费菜单：送礼 / 约会 / 办事"]:::done
    SPEND -->|"好感 ↑"| REL

    SAVE[("存档 v3 新增四组字段<br/>career / skills / equips / pets")]:::core
    LVL10 -.-> SAVE
    SKP -.-> SAVE
    EQS -.-> SAVE
    PET -.-> SAVE
```

## 阅读顺序

1. 左上循环 A（已实装）产出「关系」→ ②人脉；
2. 人脉作闸门喂给 ③业务管线，业务量推 ③十级升职；
3. 升职发点给 ④天赋网、发钱进 ①聚合器；
4. ⑤装备与 ⑥宠物与技能一样只向 ①注册词条；
5. ①是唯一出口：好感/收入/体力/掉落四个结算点取值后回流循环 A——闭环。
