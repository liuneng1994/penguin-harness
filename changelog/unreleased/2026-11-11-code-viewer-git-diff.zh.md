# 在代码预览中查看 Git diff

- **Date:** 2026-11-11
- **Type:** feature
- **Scope:** `server`, `plugins`
- **PR:** [#6](https://github.com/liuneng1994/penguin-harness/pull/6)

[English](2026-11-11-code-viewer-git-diff.md)

可选的代码查看器插件增加了当前文件的 Git diff 视图。读者可以切换未暂存和已暂存改动，
使用合并视图或左右对比，查看旧行号、新行号、增删行和行内改动。复制 diff 可以复制补丁，
刷新后读取当前改动。代码视图保留了只读选区和问答功能。

## 文件状态

新增文件显示为新增行，删除文件保留 Git 中的删除行。空文件、二进制文件、仅元数据变化和
没有改动的文件分别显示对应状态；非 Git Workspace 显示提示。读取沿用了已有 Workspace
权限检查，按字面匹配路径，并将补丁限制在 2 MB 内。预览禁用了外部 diff 驱动和
clean/process 过滤器，没有改变 Git 索引。
