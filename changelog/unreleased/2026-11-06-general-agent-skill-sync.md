# Manual skill sharing from the General Agent

- **Date:** 2026-11-06
- **Type:** feature
- **Scope:** core, server, web
- **PR:** https://github.com/liuneng1994/penguin-harness/pull/1

[中文版](2026-11-06-general-agent-skill-sync.zh.md)

Added a Project settings action to copy the General Agent's skills to other agents in the same Project on this server. The owner could preview pending copies and conflicts, then explicitly run the sync. Missing skills were installed and unedited synced copies were updated.

## Sync behavior

Listing skills, creating an Agent, opening a conversation, and viewing the preview left installed files unchanged. New Agents received shared files only after another manual sync.

Same-name local skills and local edits were preserved. Each Agent kept its own skill switches and activity history. Removing a source retained its installed copies. The results linked conflicts to the affected Agent.

Synced-copy provenance used the [existing-data defaults](2026-11-06-backward-compatibility.md).
