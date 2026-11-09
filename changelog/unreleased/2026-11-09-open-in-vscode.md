# Open chat file locations in VS Code

- **Date:** 2026-11-09
- **Type:** feature
- **Scope:** `server`, `web`, `ui`, `desktop`
- **PR:** [#4](https://github.com/liuneng1994/penguin-harness/pull/4)

[中文版](2026-11-09-open-in-vscode.zh.md)

Chat file references gained an action that opened VS Code at the referenced line and column. The Files panel gained the same action in its menus and preview toolbar.

## File locations and connections

- Plain text, inline code and Markdown links accepted `path:line:column` and `path#LlineCcolumn` locations inside the conversation's Workspace. Line ranges opened at their first line.
- File targets were resolved through the existing Workspace permissions and path checks before opening.
- The browser handed the file to the reader's VS Code; the desktop app opened it through its local protocol handler.
- VS Code connection settings stored the reader's SSH alias per user and machine in the browser. An empty connection name selected local files; a remote machine without a known alias required configuration.
- The `list_agents` tool gained its missing English and Chinese short names in chat tool cards.
- File menus stopped closing immediately when browser focus scrolled the dock.
