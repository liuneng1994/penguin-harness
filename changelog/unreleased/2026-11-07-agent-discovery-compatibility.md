# Agent discovery configuration compatibility

- **Date:** 2026-11-07
- **Type:** feature
- **Scope:** `core`

[中文版](2026-11-07-agent-discovery-compatibility.zh.md)

Existing configurations with `run_subagent` gained discovery when a context opened, without a YAML rewrite. Context assembly preserved configured tool descriptions and parameter restrictions, added the Agent roster to the Agent parameter, and supplied `list_agents` when the stored delegation tool list did not yet include it. Configurations with neither tool kept their explicit tool selection.

This composition behavior remained permanent for configurations that enabled delegation. It had no migration deadline or removal step. The `2026-11-07` kernel recorded the new default discovery tool and retained the previous tools hash for the existing explicit kernel-update action. Customized tools tabs and MCP settings continued to follow that action's preservation rules.

No Agent files, skills, secrets or Trace records were migrated, and the existing one-level delegation limit was preserved.
