# 已有技能文件

- **Date:** 2026-11-06
- **Type:** feature
- **Scope:** core, server

[English](2026-11-06-backward-compatibility.md)

保留了已有技能文件。缺少 `agent_state/skill-settings/<name>.json` 表示启用，仅切换开关时写入状态。新安装也采用相同的缺省行为；这是永久的配置默认值，没有旧格式适配层、迁移步骤或待移除代码。

使用统计从保留的 Trace 记录推导，没有改写历史记录或增加协议字段。未出现显式指定或成功通过 `read_file` 读取技能入口的记录，不提供最近使用时间。

同步副本的摘要存放于 `agent_state/skill-sync/`，位于技能内容之外，并标明来源 Project。缺少来源记录的已有技能目录被视为本地内容并予以保留。这些是新增的来源记录，没有迁移旧数据或添加旧格式适配层。
