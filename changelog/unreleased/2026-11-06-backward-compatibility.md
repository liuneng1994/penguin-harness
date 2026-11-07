# Existing skill files

- **Date:** 2026-11-06
- **Type:** feature
- **Scope:** core, server
- **PR:** https://github.com/liuneng1994/penguin-harness/pull/1

[中文版](2026-11-06-backward-compatibility.zh.md)

Kept existing installed skill files unchanged. Missing `agent_state/skill-settings/<name>.json` meant enabled, and only switch operations wrote that state. The same absence default applied to new installations; this was a permanent configuration default, with no legacy format adapter, migration, or removal deadline.

Activity was derived from retained Trace records without rewriting them or adding record fields. A Trace without explicit selections or completed `read_file` entry reads contributed no last-used time.

Synced-copy hashes were kept under `agent_state/skill-sync/`, outside skill content, and scoped to their source Project. Existing skill directories without those records were treated as local content and preserved. These were new provenance records, with no old data migration or format adapter.
