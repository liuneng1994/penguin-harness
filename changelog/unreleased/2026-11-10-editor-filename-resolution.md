# Open abbreviated code file citations

- **Date:** 2026-11-10
- **Type:** fix
- **Scope:** `server`, `web`

[中文版](2026-11-10-editor-filename-resolution.zh.md)

Positioned citations such as `Expr.cpp:1047` opened the matching source file below the Workspace root when the filename identified one file.

## File lookup

- Existing paths kept their exact target. Abbreviated filenames used Git-visible files, including untracked source files, while ignored build copies stayed outside this lookup.
- Workspaces without Git used the existing bounded file search.
- Multiple matches and incomplete searches asked for the complete Workspace path. File targets retained the existing permission and path checks.
