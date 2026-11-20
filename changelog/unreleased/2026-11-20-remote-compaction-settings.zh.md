# 将 compact 阈值保存到会话所在的机器

- **Date:** 2026-11-20
- **Type:** fix
- **Scope:** `web`
- **PR:** [#15](https://github.com/liuneng1994/penguin-harness/pull/15)

[English](2026-11-20-remote-compaction-settings.md)

在远程会话的上下文面板中修改阈值标记后，数值保存到该机器上的 Agent。主聊天页使用 Agent 配置 hook 读取、保存和刷新阈值，并在切换不同机器上的会话时更新阈值和默认思考级别。

## 细节

- 移除了主聊天页中重复且固定指向本机的配置处理。
- 保留了原有确认弹窗和保存被拒绝时的错误处理。
- 移除了未使用的 setter 和配置 hook 中重复的 Skill 读取。
