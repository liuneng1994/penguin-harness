# Git diff in code previews

- **Date:** 2026-11-11
- **Type:** feature
- **Scope:** `server`, `plugins`
- **PR:** [#6](https://github.com/liuneng1994/penguin-harness/pull/6)

[中文版](2026-11-11-code-viewer-git-diff.zh.md)

Added a Git diff view for the current file in the optional Code Viewer plugin. Readers switched
between working-tree and staged changes, with unified or side-by-side layouts showing old and
new line numbers, added and deleted lines, and changed words. Copy diff copied the patch;
reloading fetched the current changes. The Code view kept its read-only selection and questions.

## File states

New files appeared as additions. Deleted files retained their removed lines from Git. Empty,
binary, metadata-only and unchanged files had explicit states, and non-Git Workspaces showed a
notice. Reads kept the existing Workspace access checks, treated paths literally and limited
patches to 2 MB. The preview disabled external diff drivers and clean/process filters, and left
the Git index unchanged.
