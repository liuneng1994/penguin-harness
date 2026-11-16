# Templates in the conversation composer

- **Date:** 2026-11-16
- **Type:** feature
- **Scope:** `web`, `ui`

[中文版](2026-11-16-composer-templates.zh.md)

Added a Templates button beside the composer's attachment menu. Its upward picker searched saved shortcut names and contents, showed prompt summaries, and put recently used templates first.

## Details

- Selecting a template inserted its text at the saved cursor position or replaced the selection. Other draft content stayed in place, and the message remained unsent. Native browser editing preserved undo.
- Templates remained available while a reply streamed. Selecting one returned focus to the composer; Escape dismissed a searched picker, and switching Sessions closed it.
- Manage templates reused the existing shortcut editor and account storage. Reads that arrived after a write could not restore an older list. Recent choices were scoped to the account in this browser and cleared when its data root changed.
- Desktop triggers showed a label; narrow composers used the same icon trigger. The picker stayed above the input and scrolled long lists internally.
