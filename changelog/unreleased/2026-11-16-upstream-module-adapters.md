# Keep fork extensions through the upstream module split

- **Date:** 2026-11-16
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `ui`, `tooling`
- **PR:** [#14](https://github.com/liuneng1994/penguin-harness/pull/14)

[中文版](2026-11-16-upstream-module-adapters.zh.md)

Replayed the fork's extensions onto the upstream module layout. Skill sharing and activity remained in Agent settings, file citations still opened the code viewer or configured editor, and temporary questions and saved reading positions remained attached to their Session.

## Details

- Skill metadata and per-Agent availability stayed in the separate catalog module, using upstream's image-only icon reader. The Plugins tab displayed shared skills separately from installed plugin parts, with their switches and activity; Project settings kept manual sharing. The removed Skills tab and monolithic project dialog were not restored.
- Workbench catalog reading and iframe presentation moved into shared libraries. Code previews used those libraries without a dependency cycle with the Workbenches module. File citation parsing, editor launching and editor preferences also moved into shared libraries.
- File actions, preview state and preview dialogs joined the upstream chat composition through separate hooks. Reply file renderers and temporary questions both remained present. Temporary question popups used the shared layer scale.
- The native TRAE model default was applied in the server's contributed CLI model command. Agent authors and the global discovery switch coexisted, and remote delegation retained the upstream approval reason when consulting the parent.
- Kernel defaults carried the `2026-11-16` stamp while preserving the upstream authorization and memory-script defaults. Existing edited tabs retained their ordinary update protection.
- The installer fixture used in-place sed flags accepted by both GNU and BSD sed. Release stamping expressions were retained.
