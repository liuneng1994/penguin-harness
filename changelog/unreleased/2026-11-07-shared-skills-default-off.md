# Shared skills start disabled

- **Date:** 2026-11-07
- **Type:** feature
- **Scope:** `core`, `server`, `web`
- **PR:** [#3](https://github.com/liuneng1994/penguin-harness/pull/3)
- **Breaking:** yes — shared skills without an explicit Agent switch require enablement.

[中文版](2026-11-07-shared-skills-default-off.zh.md)

Skills borrowed from General started disabled on consuming Agents. The Skills tab kept them visible and allowed enabling each one. Disabled shared skills stayed out of the model's skill list and composer choices, and new entry reads and explicit selections were refused until enabled.

General's own skills and independently installed files kept their default enabled state. Creating a private copy or manually syncing a new shared copy preserved the consumer's switch, including the disabled default.

Shared skills also stayed disabled while General replaced their files. A temporary missing entry no longer allowed an explicit invocation, and a concurrent private copy kept its preserved switch.

Existing settings followed the [compatibility behavior](2026-11-07-shared-skills-default-off-compatibility.md).
