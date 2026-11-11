# Git changes within code previews

- **Date:** 2026-11-11
- **Type:** feature
- **Scope:** `server`, `web`, `plugins`
- **PR:** [#6](https://github.com/liuneng1994/penguin-harness/pull/6)

[中文版](2026-11-11-code-viewer-git-diff.zh.md)

Git changes appeared directly in the optional Code Viewer's code view. Added and modified lines
had gutter marks and changed-word highlights. Old code appeared directly below its corresponding location,
with original line numbers. Citation and change highlights stayed visible during selections and
questions. Show changes toggled the marks without altering
the source or selection; previous and next change buttons navigated this file's edits.

## Source and questions

Unstaged displayed working-tree code; Staged displayed the Git index. Copy code excluded old
code, while Copy diff copied the complete patch. Reload refreshed source and changes together.
Questions used the displayed source and nearby Git hunks, including for deleted code, and
rejected a changed snapshot until reload. Answers stayed in the question popup.

## File states

New files appeared as additions. Deleted files retained their removed lines from Git. Empty,
binary, metadata-only and unchanged files had explicit states, and non-Git Workspaces retained
ordinary code previews. Reads kept the existing Workspace access checks, treated paths literally
and limited source and patches to 2 MB. The preview disabled external diff drivers and
clean/process filters, and left the Git index unchanged.

## Preview controls

The standalone Code tab was hidden; chat file references continued to open the preview.
More held Show full file and Copy diff. The footer omitted the repeated source-version label.
One edit had Locate change, multiple edits had Previous and Next change, and hiding changes
hid their navigation. Files without edits had no change controls.
