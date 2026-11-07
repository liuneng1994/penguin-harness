# Agent 发现功能的配置兼容性

- **Date:** 2026-11-07
- **Type:** feature
- **Scope:** `core`
- **PR:** [#2](https://github.com/liuneng1994/penguin-harness/pull/2)

[English](2026-11-07-agent-discovery-compatibility.md)

已有配置包含 `run_subagent` 时，在新上下文打开时获得了发现能力，无需改写 YAML。上下文组装保留了已配置的工具说明和参数限制，在 Agent 参数中补充了名单，并在旧委派工具列表尚未包含 `list_agents` 时提供该工具。两个工具都未配置的 Agent 保留了原有的工具选择。

这一组装行为永久保留，适用于启用了委派的配置，没有迁移期限或移除步骤。`2026-11-07` 内核记录了新的默认发现工具，既有的显式内核更新操作保留了上一代工具摘要。自定义工具页和 MCP 配置继续遵循该操作的保留规则。

没有迁移 Agent 文件、技能、密钥或 Trace 记录，保留了既有的一层委派限制。
