# 共享技能默认关闭

- **Date:** 2026-11-07
- **Type:** feature
- **Scope:** `core`, `server`, `web`
- **PR:** [#3](https://github.com/liuneng1994/penguin-harness/pull/3)
- **Breaking:** yes — 未保存 Agent 开关的共享技能需要启用后才能使用。

[English](2026-11-07-shared-skills-default-off.md)

消费 Agent 从 General 引用的共享技能改为默认关闭。技能页仍然显示这些技能，可以逐项启用。关闭的共享技能不再进入模型技能列表和输入框选项，启用前新的入口读取和显式调用也会被拒绝。

General 自己的技能和独立安装的技能保留了默认启用状态。创建独立副本或手动同步新的共享副本时，保留了消费 Agent 的开关，包括默认关闭状态。

General 替换技能文件期间，共享技能也保持关闭。入口暂时缺失不再允许显式调用，并发创建的独立副本保留了原有开关。

已有设置遵循了[兼容行为](2026-11-07-shared-skills-default-off-compatibility.zh.md)。
