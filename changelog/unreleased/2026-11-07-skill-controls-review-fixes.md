# Skill entry aliases and activity queries

- **Date:** 2026-11-07
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#1](https://github.com/liuneng1994/penguin-harness/pull/1)

[中文版](2026-11-07-skill-controls-review-fixes.zh.md)

Skill entry reads through symlinks and alternate casing used the installed directory's name for the consuming Agent's switch and activity. Disabled local and shared entries were refused through those aliases.

## Activity

Skill selections in steering messages contributed to invocation counts, session counts and the last-used time without requiring an entry read. Queries over more than 128 sessions reused cached summaries throughout each scan and refreshed summaries when Trace files changed.

The existing [upgrade behavior](2026-11-07-backward-compatibility.md) was preserved. Missing or foreign-host entry paths retained lexical matching without rewriting Trace records or skill settings.
