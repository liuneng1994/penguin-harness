# Resolve literal source filenames with Git on Windows

- **Date:** 2026-11-20
- **Type:** fix
- **Scope:** `server`
- **PR:** [#15](https://github.com/liuneng1994/penguin-harness/pull/15)

[中文版](2026-11-20-windows-git-file-targets.zh.md)

Abbreviated source filenames containing glob punctuation resolved through Git on Windows. The filename pathspec used character classes to preserve literal characters, while ignored build copies remained excluded.

## Details

- Covered bracket, question-mark and asterisk filenames where the operating system allowed them, including a neighboring source file that a wildcard must not select.
- Tested nested Git previews with a space-containing directory on every platform and retained the trailing-space directory case on POSIX.
