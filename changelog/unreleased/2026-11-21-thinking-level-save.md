# Wait for thinking-level saves in chat

- **Date:** 2026-11-21
- **Type:** fix
- **Scope:** `web`
- **PR:** [#16](https://github.com/liuneng1994/penguin-harness/pull/16)

[中文版](2026-11-21-thinking-level-save.zh.md)

The chat composer waited for thinking-level saves before accepting another pick or message. Failed saves kept the previous level, and direct-switch confirmations stayed open for retry. The compact-then-switch flow reported success after the level was saved.

Saved Session levels also updated the direct lookup used when the conversation fell outside the paged list. New-chat pickers reused the Agent configuration reader, adopted the saved response, and ignored older reads or saves from a previous Agent view. Returning to an Agent kept its pending save locked and reread the final configuration. Compaction switches stayed with their conversation, including delayed success notices.

Agent configuration saves shared one response-handling path, and two unused copies of the conversation controls were removed.
