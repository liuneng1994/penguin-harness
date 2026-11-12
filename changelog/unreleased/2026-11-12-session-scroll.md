# Restore reading positions when switching conversations

- **Date:** 2026-11-12
- **Type:** fix
- **Scope:** `web`
- **PR:** [#11](https://github.com/liuneng1994/penguin-harness/pull/11)

[中文版](2026-11-12-session-scroll.zh.md)

Switching between Sessions restored each conversation's reading position within the current page. Conversations left at the bottom continued following new replies.

## Details

- Saved a prompt and its viewport offset, and loaded older history when needed to return to that prompt.
- Kept restored historical views still while replies streamed below them.
- Preserved the original reading target when switching away before its history finished loading. Scrolling during restoration gave control back to the reader.
- Scrollbar, keyboard, outline and find jumps also took control when older history was still loading.
- Prevented the previous Session's transcript from overwriting the new Session's reading position during a switch. Returning to the latest message immediately canceled pending restoration.
