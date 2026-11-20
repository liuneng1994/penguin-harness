# Save compaction thresholds on the conversation's machine

- **Date:** 2026-11-20
- **Type:** fix
- **Scope:** `web`
- **PR:** [#15](https://github.com/liuneng1994/penguin-harness/pull/15)

[中文版](2026-11-20-remote-compaction-settings.zh.md)

Changing the threshold marker in a remote conversation's context panel saved the value to that machine's Agent. The main chat used the Agent-config hook for threshold reads, writes and focus refreshes, and switched its threshold and thinking default when the conversation moved between machines.

## Details

- Removed the main chat's duplicate config handling that targeted the local server.
- Kept the existing confirmation dialog and the error path for refused saves.
- Removed unused setters and duplicate Skill fetching from the config hook.
