# Existing skill files on upgrade

- **Date:** 2026-11-07
- **Type:** feature
- **Scope:** core, server, web
- **PR:** https://github.com/liuneng1994/penguin-harness/pull/1

[中文版](2026-11-07-backward-compatibility.zh.md)

General's existing skill directory became the shared source by default after upgrade. No files were moved, deleted or copied. This directory remained the permanent source; no migration reader or temporary layout was introduced.

## Existing Agent state

Each Agent's installed skills continued to take precedence over General's same-name skills. Existing manual-sync copies remained independent files. Removing an installed version restored access to the shared version, using that Agent's current switch. Missing switches continued to mean enabled.

General's switches applied to General's own sessions. Other Agents used their own switches, including for shared skills. Retained Trace history remained readable, and shared entry reads were attributed to the consuming Agent. Skills were discovered when a model context opened; an already open context retained its catalog until the next context.
