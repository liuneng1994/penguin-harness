# Workbench declarations in desktop packages

- **Date:** 2026-11-11
- **Type:** fix
- **Scope:** `desktop`
- **PR:** [#8](https://github.com/liuneng1994/penguin-harness/pull/8)

[中文版](2026-11-11-workbench-declarations.zh.md)

Desktop installers retained the declarations shipped by built-in plugins, fixing Code Viewer compilation after installation on an Agent. Package verification checked those files against the original plugin packages.
