# 已有技能文件

- **Date:** 2026-11-06
- **Type:** feature
- **Scope:** core, server

[English](2026-11-06-backward-compatibility.md)

保留了已有技能文件。缺少 `agent_state/skill-settings/<name>.json` 表示启用，仅切换开关时写入状态。新安装也采用相同的缺省行为；这是永久的配置默认值，没有旧格式适配层、迁移步骤或待移除代码。

使用统计从保留的 Trace 记录推导，没有改写历史记录或增加协议字段。未出现显式指定或成功通过 `read_file` 读取技能入口的记录，不提供最近使用时间。
