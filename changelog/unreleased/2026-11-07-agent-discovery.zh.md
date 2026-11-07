# 发现当前 Project 的本节点 Agent

- **Date:** 2026-11-07
- **Type:** feature
- **Scope:** `core`
- **PR:** [#2](https://github.com/liuneng1994/penguin-harness/pull/2)

[English](2026-11-07-agent-discovery.md)

模型上下文在委派工具的 Agent 参数说明中获得了当前节点、同 Project 的 Agent ID、名称和职责。模型自行决定是否委派、选择哪个 Agent，以及分配什么工作。

## 发现能力

只读工具 `list_agents` 刷新了 Agent 名单，并支持查看某个 Agent 已启用的技能名称，包括共享技能。发现过程读取了本地 Agent 元数据，排除了未初始化或无效的状态，保留了配置、密钥和会话历史。Agent 名称和职责来自已保存的设置。

委派工具参数中的名单在一个上下文内保持固定，新上下文会刷新名单；运行中的任务可以调用 `list_agents` 获取最新信息。发现和委派限定在当前节点、同一个 Project，子会话保留了既有的一层委派限制。

恢复开放的上下文时，沿用了已记录的名单，其他 Agent 的编辑、新增和删除也保留了这一快照。子会话转发的工具列表没有替换该快照。工具权限和已配置的参数限制仍读取当前 Agent 设置。

已有配置遵循了[兼容行为](2026-11-07-agent-discovery-compatibility.zh.md)。
