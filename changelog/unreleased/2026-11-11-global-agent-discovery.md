# Discover and delegate to Agents across connected nodes

Date: 2026-11-11
Type: Added
Scope: core, server, web
PR: [#10](https://github.com/liuneng1994/penguin-harness/pull/10)

[中文](2026-11-11-global-agent-discovery.zh.md)

Each Agent has a **Global discovery** switch in its Runtime settings. It is off by default, including for existing Agents. With the switch off, discovery and delegation stay on the current node.

With the switch on, `list_agents` discovers Agents in the same Project on connected nodes. A controller relays queries through its existing node connections, so remote Agents can discover and delegate to siblings connected to that controller. Nodes must belong to the controller's Project and have the same Project ID. Disconnected or unsupported nodes are reported separately. Discovery does not repair or upgrade nodes.

Results include node identity, Agent name and role, and delegation availability. Pass `node_id` and `agent_id` to inspect a remote Agent's enabled skill names or to delegate with `run_subagent`. The model chooses its targets. Directory queries carry metadata only, and slow peers do not prevent the local catalog from returning.

Remote delegation is for temporary data research. Each task starts in an independent empty workspace on the target node, using that Agent's tools, skills and credentials. Code is not fetched or synchronized. Output and approval requests return to the parent; `input_subagent` supports follow-up questions and stopping the current round. Background tasks use the existing completion notifications. A lost parent stops receiving heartbeats, and the remote task is stopped after its lease expires.

Delegation stays at one level, including when a released child Session is resumed. Remote workspaces and full child Traces stay on the target node; the parent retains its tool results. The switch saves independently of other Runtime edits. Both ends and any relaying controller need a version that supports remote delegation.
