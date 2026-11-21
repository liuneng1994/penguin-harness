# 在 Windows 上通过 Git 定位包含特殊字符的源文件名

- **Date:** 2026-11-20
- **Type:** fix
- **Scope:** `server`
- **PR:** [#15](https://github.com/liuneng1994/penguin-harness/pull/15)

[English](2026-11-20-windows-git-file-targets.md)

在 Windows 上，包含 glob 特殊字符的简写源文件名能够通过 Git 定位。文件名 pathspec 使用字符类保留字面字符，被忽略的构建副本仍被排除。

## 细节

- 在操作系统允许的范围内覆盖了方括号、问号和星号文件名，并加入可能被通配符误选的相邻源文件。
- 在各平台上使用名称包含空格的目录测试嵌套 Git 预览，同时保留 POSIX 上目录名末尾有空格的场景。
