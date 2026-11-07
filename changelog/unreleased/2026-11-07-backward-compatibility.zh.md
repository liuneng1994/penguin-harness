# 升级后保留已有技能文件

- **Date:** 2026-11-07
- **Type:** feature
- **Scope:** core, server, web
- **PR:** https://github.com/liuneng1994/penguin-harness/pull/1

[English](2026-11-07-backward-compatibility.md)

升级后 General 已有的技能目录默认成为共享来源，文件不搬迁、不删除、不复制。该目录作为永久来源，不引入迁移读取器或临时布局。

## 已有 Agent 状态

每个 Agent 已安装的技能继续优先于 General 的同名技能。已有手动同步副本保留为独立文件；删除已安装版本后恢复使用共享版本，沿用该 Agent 的当前开关。缺省开关继续表示启用。

General 的开关只影响它自己的会话。其他 Agent 使用各自的开关，包括共享技能。保留的 Trace 历史继续可读，共享入口读取归属于使用它的 Agent。技能在模型上下文打开时发现，已打开的上下文保留原有目录信息，直到下一个上下文。
