# 02 · 行业人脉系统

> 口径源：`career-numbers-mini.md` §3。人脉是**派生值**，不进存档，实时由名册算出——杜绝同步 bug。

## 派生计算

```mermaid
flowchart LR
    NPC["npcs.js 30 条<br/>新增 domain 标注：金融/地产/高科技"]
    VAL["NETWORK_VALUE 按圈层：<br/>t1=2 / t2=4 / t3=7 / t4=11 / t5=16"]
    MS{"好感里程碑<br/>（复用 MILESTONES 25/50/75）"}

    NPC --> VAL
    VAL --> MS
    MS -->|"好感 ≥25"| P30["计入 30%"]
    MS -->|"好感 ≥50"| P60["计入 60%（含前档）"]
    MS -->|"好感 ≥75"| P100["计入 100%"]
    P30 & P60 & P100 --> OUT["派生输出：<br/>金融人脉 / 地产人脉 / 高科技人脉 / 总人脉"]
```

## 用法一：业务闸门

```mermaid
flowchart LR
    TPL["业务模板要求<br/>如：金融≥40 且 银行NPC×1"] --> CHK{"实时比对派生值"}
    CHK -->|"满足"| GO["效率 = 1.0"]
    CHK -->|"不足"| GAP["效率 = min(各条件比)<br/>UI 明示缺口：「缺一个银行家」"]
```

## 用法二：Agent 决策器挂钩

```mermaid
flowchart LR
    BIZGAP["L2 发现业务缺口<br/>如：金融还差 18"] --> FILTER["筛选对应 domain 的未攻略 NPC"]
    FILTER --> PRIO["按 人脉值×可达成率 排序入攻略队列"]
    PRIO --> LOOP["回到循环A：识人→博弈→里程碑→人脉↑"]
```

## 备注

- v1 不衰减：里程碑锁定后永久计入；衰减规则留待三维关系改造一并定。
- 成本：npcs.js 30 条标注 + 派生函数，约 1 天。
