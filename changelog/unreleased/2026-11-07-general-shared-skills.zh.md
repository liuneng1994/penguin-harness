# 在 Project 内共享 General Agent 的技能

- **Date:** 2026-11-07
- **Type:** feature
- **Scope:** core, server, web
- **PR:** https://github.com/liuneng1994/penguin-harness/pull/1

[English](2026-11-07-general-shared-skills.md)

General 已有的技能成为同 Project 其他 Agent 的共享来源。源文件保留原位，发现技能不生成副本。每个使用共享技能的 Agent 保留独立的开关和统计。

## 独立版本

已安装的独立技能优先于同名共享技能，禁用独立版本也不会回退到共享版本。Agent 设置显示技能来源，支持导出共享技能，并提供显式创建独立副本的操作。删除副本后恢复共享，保留该 Agent 的开关。

Project 的手动同步继续创建和更新未修改的副本，保留本地冲突。共享技能更新不会覆盖独立版本。MCP 服务和钩子仍按 Agent 分别安装。

已有数据遵循[升级行为](2026-11-07-backward-compatibility.zh.md)。
