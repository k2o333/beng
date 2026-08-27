# alpha3 实装说明（2026-08-25）

> 依据 `docs/drafts/alpha3/`（README + 01~08 + 两份 mini 口径源）完成 ①~⑦ 切片；
> ⑧创业线按文档约定【后置】（依赖三维关系改造，未实装）。

## 已实装范围

| 模块 | 落点 |
| --- | --- |
| ① bonuses 聚合器 | `engine.js`：`bonusOf/bonusMulOf/bonusFlatOf`，词条 `{attr,kind:flat|add|mul,cond?}`；叠序 `(base+Σflat)×(1+min(Σadd,+100%cap))×Πmul`，add 溢出按条转独立 mul（降序填充）。缓存 `_bCache/_bSig` 签名自动重建、不入档（app.save 时剔除） |
| ② 职业数据表 | `balance.js`：`CAREER_LEVELS`(打工十级) / `BIZ_TEMPLATES`(15 条按圈层) / `COMMISSION_PER_WAN=300`；旋钮进 `SETTINGS_DEFAULT`：bizSpeed / bizThresholdMul / networkGainMul / commissionScale / careerMode(仅 employee 生效) / identifyCdMin / identifyStaminaCost / respecBase / equipDropRate |
| ③ 行业人脉 | npcs.js 30 条 `domain` 标注（金融/地产/高科技各 10）；`Engine.networkOf` 派生值不入档；里程碑 ≥25→30% / ≥50→60% / ≥75→100%；Agent 候补新增 `gap` 排序模式 |
| ④ 业务管线 | 单槽状态机 `currentBiz{tplId,eff,workMs,doneMs}`；效率=min(人脉比/类型计数比)+慧眼识珠情报加成−稳健派保底；提成=`量×率×mult^0.5×300×commissionScale×incomeFactors`；津贴随结单周期发放；升职跨档发技能点；放置自动跑单、离线照跑并入简报 |
| ⑤ 天赋网 | `SKILLS.nodes` 全树（支点9/精华6/大节点3/基石3对/连携3），职级门槛 gate1/6/8，大节点需本系≥5点，同对基石互斥（存档校验剔除），洗点费=已投×respecBase×(1+已洗次数)首次免费；透视点亮即全揭示「已结识」对象 |
| ⑥ 装备槽 ×2 | items.js 新增 watch_steel/jewel_jade（effect.kind='equip'），品质 ×1.5/×2 放大后常驻注册；旧件回包原子预检；装备只从掉落 func 分支获得（合成/回礼池排除 equip，防毕业装被刷）；掉落占比走 equipDropRate 旋钮 |
| ⑦ 宠物 | 三只（约会200/上班100h/掉落500）解锁即永久注册；条上像素跟随（ui-bar drawPets）；属性成长页一览 |
| 存档 v3 | `normalizeV3` 幂等补齐 career/skills/equips/pets 四组字段；v1→v2→v3 链式迁移；非法行业/节点/互斥对/槽位物品剔除 |

## 新增 UI

- 主条新页签「成长」：职业方向与业务单（进度条实时刷新）/ 人脉四维 / 天赋网点亮与洗点 / 装备槽穿脱 / 伙伴一览；
- NPC 弹窗新增「识人」动作（识人系宿主动作：读一条隐藏情报，附小额好感）；
- 稀有掉落金色脉冲光效 + 播报（longterm #2 同点实装）；离线简报含业务量/提成/津贴/离线升职。

## 对文档的实现性偏差（有意为之，均已注释）

1. **提成换算系数** `COMMISSION_PER_WAN=300`：文档只给「基准量×提成率×mult^0.5」未定万→金换算；取值使中期提成与资产收入同数量级。调参走 commissionScale。
2. **识人动作**为新增宿主机制（文档技能树隐含「识人冷却/体力耗」，原代码无此动作）：12 体力 / 360 游戏分冷却，读 third/line/mine 之一。
3. **知心收网区**实现为「好感≥100 后收益 ×2」（等价方向的口径具体化），上限 120。
4. **总裁思维**换单携带已耗时（钳到新单工时），跨模板生效。
5. **账房 incomeMul(+8%)** 应用面：时薪、业务提成、掉落金包（在线+离线）；不含声望/物品。
6. **基石互斥**解释为「同对二选一」（可跨对不同对各取一），拓扑图标签口径。

## 验证

- `npm test`：test-engine 283 项 + test-agent 16 项全绿；
- 新增用例覆盖：聚合叠序与 add 封顶溢出、人脉三分支派生、业务效率/缺口文案/保底/满条件加成、提成公式与跨档升职、天赋网门槛/互斥/连携/洗点回退、装备穿脱换装与品质放大、宠物解锁叠乘、v2→v3 迁移幂等、识人动作、总裁思维换单携带。
