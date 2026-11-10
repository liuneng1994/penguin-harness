# 打开简写的代码文件引用

- **Date:** 2026-11-10
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#5](https://github.com/liuneng1994/penguin-harness/pull/5)

[English](2026-11-10-editor-filename-resolution.md)

`Expr.cpp:1047` 这类带位置的引用，在文件名唯一时打开了 Workspace 子目录中对应的源文件。

## 文件查找

- 已有路径保留了原来的目标。简写文件名从 Git 可见文件中查找，包括未跟踪的源文件；被忽略的构建副本不参与此次查找。
- 没有 Git 的 Workspace 使用了已有的有上限的文件搜索。
- 多个匹配或搜索未完成时，提示使用 Workspace 内的完整路径。文件目标保留了已有的权限和路径检查。
