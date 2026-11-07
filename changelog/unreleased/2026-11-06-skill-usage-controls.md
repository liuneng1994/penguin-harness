# Skill activity and individual switches

- **Date:** 2026-11-06
- **Type:** feature
- **Scope:** core, server, web
- **PR:** https://github.com/liuneng1994/penguin-harness/pull/1

[中文版](2026-11-06-skill-usage-controls.zh.md)

Added an independent switch and activity readings to each installed skill in Agent settings. Disabling a skill kept its files, removed it from discovery and the composer, and refused new explicit invocations and `read_file` entry reads. Re-enabling restored availability.

## Activity

The list displayed explicit selections, completed entry reads, failed reads, distinct conversations, and the latest selection or completed read. Readings were derived from retained Trace history, including older records, with forwarded child records excluded from the parent's totals. Model token use and task success were not attributed to skills.

Switches were stored separately from installed content and survived updates and reinstallation. Existing files used the [default-enabled behavior](2026-11-06-backward-compatibility.md).
