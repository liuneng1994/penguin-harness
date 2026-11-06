# Native TRAE models

- **Date:** 2026-11-06
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `model-catalog`

[中文版](2026-11-06-trae-native-models.zh.md)

Added a TRAE model group that calls the CN TRAE model service using the server machine's existing TRAE CLI login, without a separate model proxy.

## Details

- Added an explicit model sync that reads the CLI catalog, imports available Standard and Max variants, and preserves existing model edits and the Project's default model.
- Displayed CLI login status in the model library and offered models with a valid login in the conversation model picker. Credentials were kept on the server and reread for each request; expired logins prompted another `traecli login`.
- Added native streaming text, reasoning, tool calls, tool-result replay and cache-aware Token accounting. Released each request before its completion event so the following tool-result request could start.
- Added host-owned model client registration shared across core module copies, and a `@prismshadow/penguin-server/trae` entry for SDK users.
- Made CLI model additions select the declared native transport when their group had no protocol configured.
- Added bilingual model and configuration instructions. TRAE model prices were left unspecified, and imported models started with vision disabled.
