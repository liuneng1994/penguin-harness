# 技能入口别名和使用统计查询

- **Date:** 2026-11-07
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#1](https://github.com/liuneng1994/penguin-harness/pull/1)

[English](2026-11-07-skill-controls-review-fixes.md)

通过符号链接或不同大小写读取技能入口时，开关检查和统计使用了安装目录中保存的名称，并归属于消费 Agent。已禁用的独立技能和共享技能通过这些别名读取时也被拒绝。

## 使用统计

中途追加消息中的技能选择计入了调用次数、会话数和最近使用时间，无需再次读取技能入口。超过 128 个会话的查询在整轮扫描中复用了已缓存的统计摘要，并在 Trace 文件变化时刷新摘要。

保留了现有的[升级行为](2026-11-07-backward-compatibility.zh.md)。已不存在或来自其他主机的入口路径继续按路径文本匹配，没有改写 Trace 记录或技能开关配置。
