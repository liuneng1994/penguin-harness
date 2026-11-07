# Discover local Project Agents

- **Date:** 2026-11-07
- **Type:** feature
- **Scope:** `core`
- **PR:** [#2](https://github.com/liuneng1994/penguin-harness/pull/2)

[中文版](2026-11-07-agent-discovery.zh.md)

Model contexts included the current node's same-Project Agent IDs, names and declared roles in the delegation tool's Agent parameter. The model chose whether to delegate, which Agent to use and what work to assign.

## Discovery

The read-only `list_agents` tool refreshed the roster and inspected an Agent's enabled skill names, including shared skills. Discovery read local Agent metadata, excluded incomplete or invalid states, and left configuration, secrets and conversation history unchanged. Agent names and role descriptions came from their saved settings.

The roster in the delegation schema stayed fixed for the context. A new context refreshed it; an in-progress task could call `list_agents` for current metadata. Discovery and delegation stayed on one node within one Project, and child Sessions retained the existing one-level delegation limit.

Existing configurations followed the [compatibility behavior](2026-11-07-agent-discovery-compatibility.md).
