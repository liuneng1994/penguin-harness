# 从聊天文件引用预览代码

- **日期：** 2026-11-10
- **类型：** feature
- **范围：** `web`, `server`, `plugins`
- **PR:** [#6](https://github.com/liuneng1994/penguin-harness/pull/6)

[English](2026-11-10-code-viewer.md)

在 Agent 上安装可选的代码查看器插件后，点击聊天中的文件引用，会居中打开 CodeMirror 6
只读预览。`Expr.cpp:785-795` 这样的引用会高亮目标行，并显示附近上下文和原始行号。

## 阅读局部代码

可以向上或向下展开、显示完整文件、搜索、自动换行，以及复制选中的文本或引用代码。Esc
先关闭搜索栏，再关闭预览，返回原来的聊天位置。底部保留在 VS Code 中打开文件的入口。

C/C++、JavaScript/TypeScript、Python、JSON、Rust 和 Shell 的语法解析器在插件内按需加载。
预览使用 Session 所在服务器和已有的 Workspace 权限检查，并支持唯一简写文件名的解析。
文件不存在或有多个同名文件时显示解析错误。二进制文件和超过 2 MB 的文本可通过 VS Code 打开。

插件可从插件库安装，默认不预装。未安装插件的 Agent 保持现有的文件打开方式。
聊天记录和已保存配置的格式不变。
