# 01 · 数值底座：bonuses 聚合器

> 口径源：`growth-evolution-mini.md` §0。这是全部后续模块的前置依赖。
> 唯一改造点：结算公式不再散落 `perkMul` 硬编码，所有来源只注册词条。

## 聚合管线

```mermaid
flowchart TB
    subgraph SRC["词条来源（只注册，不算数）"]
        PERK["成就 perks<br/>已有，平移接入"]
        SKILL["技能节点"]
        EQP["装备槽 ×2"]
        PET["宠物被动"]
        CAR["职级津贴 / 提成率"]
        ADM["后台总旋钮"]
    end

    subgraph AGG["Bonuses 聚合器（engine.js 单例）"]
        REG["register：attr + kind + value<br/>kind ∈ flat / add / mul / cond"]
        SUM["同 attr 同 kind 归并：<br/>Σflat、Σadd、连乘mul"]
        CAP["add 封顶：同类总上限 +100%<br/>超出部分转独立 mul"]
    end

    PERK --> REG
    SKILL --> REG
    EQP --> REG
    PET --> REG
    CAR --> REG
    ADM --> REG
    REG --> SUM --> CAP --> OUT["final = (base + Σflat) × (1 + min(Σadd, cap)) × 连乘mul"]
```

## 结算时序（boot 注册 → step 取值）

```mermaid
sequenceDiagram
    participant Boot as app.boot()
    participant Agg as Bonuses聚合器
    participant Step as Engine.step(1s)

    Boot->>Agg: reset()
    Boot->>Agg: 注册 perks / skills / pets / equips / career 词条
    Note over Agg: 按 flat→add→mul 分型缓存，不重复注册
    loop 每 1s 心跳与每次动作结算
        Step->>Agg: get(attr)，如 favorGain / incomeMul / staminaMax
        Agg-->>Step: final 公式结果
    end
    Note over Agg: 存档只存来源数据，词条表可随时重算
```

## 验收要点

- 任一词条增删不改公式本体，只动数据表；
- `tests/test-engine.js` 新增三型叠序单测（顺序固定且档案卡公示）；
- 存档 v3 迁移幂等。
