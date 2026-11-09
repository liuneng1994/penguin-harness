# 在 VS Code 中打开聊天文件位置

- **Date:** 2026-11-09
- **Type:** feature
- **Scope:** `server`, `web`, `ui`, `desktop`

[English](2026-11-09-open-in-vscode.md)

聊天中的文件引用增加了在 VS Code 中打开并定位到行号、列号的操作。文件面板的菜单和预览工具栏也增加了同一入口。

## 文件位置与连接

- 普通文本、行内代码和 Markdown 链接支持了会话 Workspace 内的 `path:line:column` 和 `path#LlineCcolumn` 格式。行号范围定位到起始行。
- 打开前，文件目标通过了已有的 Workspace 权限与路径检查。
- 浏览器将文件交给用户电脑上的 VS Code；桌面应用通过本机协议处理程序打开文件。
- VS Code 连接设置在浏览器中按用户和机器保存了 SSH 连接名。连接名留空表示本机文件；远程机器没有已知连接名时需先配置。
- 补齐了聊天工具卡片中 `list_agents` 工具的中英文短名。
- 修复了文件菜单聚焦首项时滚动侧栏、导致菜单立即关闭的问题。
