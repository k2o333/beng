# docs/skills · 游戏策划 / 数值平衡类 Skill 存档

> 本目录收录 alpha4 调研期间阅读并采用其方法论的四个开源 Agent Skills 原文，
> 统一为 `SKILL.md` 开放标准格式，供团队复用与后续接入 Kilo / Claude Code 等兼容宿主。
> 版权归原作者/原仓库所有，仅作内部学习与设计参考。

| 目录 | 名称 | 来源 | 许可 |
| --- | --- | --- | --- |
| [game-design](./game-design/SKILL.md) | 游戏设计全流程助手（《游戏设计的100个原理》体系） | [jasonxu610/game-design-skills](https://github.com/jasonxu610/game-design-skills)（原书 © Wendy Despain） | 内容版权归原书作者，个人学习研究用 |
| [game-numeric-design](./game-numeric-design/SKILL.md) | 游戏数值策划（《游戏数值设定入门》方法论） | [ClawHub @wangssi1998-cell/game-numeric-design](https://clawhub.ai/wangssi1998-cell/game-numeric-design) | MIT-0 |
| [machinations-diagrams](./machinations-diagrams/SKILL.md) | 游戏内部经济建模（Machinations 图语言） | [adempus/machinations-skill](https://github.com/adempus/machinations-skill) | MIT |
| [balance-check](./balance-check/SKILL.md) | 数值平衡体检报告流程 | [Donchitos/Claude-Code-Game-Studios](https://github.com/Donchitos/Claude-Code-Game-Studios) `.claude/skills/balance-check` | 随原仓库 |

## 在本项目中的用法

- 四个 skill 的方法论已沉淀进 `../drafts/alpha4/`（00~04：回路审计 / 模拟校准 / 五特性改造 / 排期）；
- 若接入 Agent 宿主：把单个 skill 目录复制到对应 skills 目录即可被自动发现
  （Claude Code：`~/.claude/skills/`；Kilo 项目级：`.kilo/` 相关配置见 kilo.json）；
- 辅助参考（未收存档）：[zsc.github.io/numeric_planner_tutorial](https://zsc.github.io/numeric_planner_tutorial)《游戏数值策划完全教程》。
