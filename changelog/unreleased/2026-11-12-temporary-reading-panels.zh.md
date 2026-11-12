# 聊天和代码预览中的临时阅读问答

Date: 2026-11-12
Type: Changed
Scope: Web, UI, code-viewer
PR: [#9](https://github.com/liuneng1994/penguin-harness/pull/9)

[English](2026-11-12-temporary-reading-panels.md)

代码预览与聊天回复使用同一个临时问答面板。长回复和多轮对话会扩大阅读空间；标题栏可切换展开阅读和小浮窗，草稿与对话保持不变。

## 阅读与关闭

- 向上翻阅时，新内容不会改变阅读位置。
- 停止生成会保留部分回答；尚无回答时，将问题恢复到输入框。
- 关闭会取消生成并清空临时对话。问题和回答不进入主会话。
- 代码选区高亮与引用范围、当前文件的 Git 改动同时保留。追问始终针对原选区。
