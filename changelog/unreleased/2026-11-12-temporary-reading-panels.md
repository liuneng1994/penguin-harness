# Temporary reading questions in chat and code previews

Date: 2026-11-12
Type: Changed
Scope: Web, UI, code-viewer
PR: [#9](https://github.com/liuneng1994/penguin-harness/pull/9)

[中文](2026-11-12-temporary-reading-panels.zh.md)

Code previews and chat replies use the same temporary question panel. Long answers and multiple turns expand its reading space; the header switches between expanded reading and a compact popup without losing the draft or conversation.

## Reading and closing

- Scrolling up keeps the reading position while new text arrives.
- Stopping keeps the partial answer, or restores the question when no text has arrived.
- Closing cancels generation and clears the temporary conversation. Questions and answers stay outside the main conversation.
- Code selections remain highlighted alongside the cited range and current-file Git changes. Follow-ups keep the original selection.
- Follow-up history keeps each question and answer once; the selected code and diff are supplied as source context.
- Fragmented network line endings do not interrupt code answers. Late clipboard feedback is discarded when its answer changes.
