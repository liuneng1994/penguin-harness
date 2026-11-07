# 手动同步 General Agent 的技能

- **Date:** 2026-11-06
- **Type:** feature
- **Scope:** core, server, web
- **PR:** https://github.com/liuneng1994/penguin-harness/pull/1

[English](2026-11-06-general-agent-skill-sync.md)

在 Project 设置中增加了手动同步操作，以 General Agent 为来源，将技能复制到本服务端同一个 Project 的其他 Agent。Project owner 可以查看待同步内容和冲突，再点击按钮执行同步。同步安装了缺少的技能，并更新没有本地改动的同步副本。

## 同步行为

读取技能列表、新建 Agent、开启对话和查看预览均不改动已安装的技能文件。新 Agent 仅在下一次手动同步后获得共享文件。

同名本地技能和本地修改得以保留。每个 Agent 的技能开关和使用历史保持独立。移除源技能保留了已安装的副本。同步结果提供了前往冲突 Agent 的链接。

同步副本的来源记录采用了[已有数据的缺省行为](2026-11-06-backward-compatibility.zh.md)。
