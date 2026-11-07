# General Agent skills shared within a Project

- **Date:** 2026-11-07
- **Type:** feature
- **Scope:** core, server, web
- **PR:** https://github.com/liuneng1994/penguin-harness/pull/1

[中文版](2026-11-07-general-shared-skills.zh.md)

General's existing skills became the shared source for the other Agents in its Project. The source files stayed in place, and discovery did not create copies. Each consuming Agent kept its own skill switches and activity.

## Private versions

A locally installed skill took precedence over a shared skill with the same name, including when the local version was disabled. Agent settings showed the source, allowed exporting a shared skill and offered an explicit action to create a private copy. Removing that copy restored sharing and preserved the Agent's switch.

The Project's manual sync action continued to create and update unedited copies, preserving local conflicts. Shared skill updates did not overwrite private versions. MCP servers and hooks remained installed per Agent.

Existing data followed the [upgrade behavior](2026-11-07-backward-compatibility.md).
