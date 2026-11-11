# 桌面安装包保留 Workbench 类型声明

- **Date:** 2026-11-11
- **Type:** fix
- **Scope:** `desktop`
- **PR:** [#8](https://github.com/liuneng1994/penguin-harness/pull/8)

[English](2026-11-11-workbench-declarations.md)

桌面安装包保留了内置插件携带的类型声明文件，修复了代码查看器安装到 Agent 后编译失败的问题。打包校验对照原始插件包检查了这些文件。
