# Shared skill default compatibility

- **Date:** 2026-11-07
- **Type:** feature
- **Scope:** `core`, `server`
- **PR:** [#3](https://github.com/liuneng1994/penguin-harness/pull/3)
- **Breaking:** yes — a missing consumer switch no longer enables a shared skill.

[中文版](2026-11-07-shared-skills-default-off-compatibility.zh.md)

The missing-switch rule became permanent: owned files remained enabled and borrowed General files became disabled. Enable each shared skill that an Agent should use in its Skills settings. Explicit enabled and disabled settings continued to take precedence. Existing independent files, including older manual-sync copies, were retained with their existing defaults.

Creating a new private or synced copy stored the shared disabled default only when no setting existed. The setting was published atomically, preserving concurrent explicit user choices. No skill content or existing settings were migrated or overwritten.

This default and the existing JSON setting format remained supported permanently, with no migration deadline or removal step. General's own defaults and same-Project scope were preserved.
