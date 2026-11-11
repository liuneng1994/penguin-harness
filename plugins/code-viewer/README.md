# Code Viewer

An optional CodeMirror 6 Workbench. Install **Code Viewer** on the Agent from PenguinHarness's
Plugins page, then click a file reference in its chat, such as `Expr.cpp:785-795`.

The preview opens in the center of the screen with the whole file available to scroll and the cited lines highlighted.
Search finds matches throughout the file. Code is read only; select and copy text, or use **Copy code**
to copy the selection or the clicked line. Before choosing code, it copies the cited lines.
**Open in VS Code** remains in the dialog footer.
Escape closes the floating question panel or search first, then the preview, and returns to the
same chat position.

Drag the mouse to select any code, including part of a line or several lines outside the original
citation, or click a line to ask about that whole line. The original citation and Git change highlights remain visible while you select code or ask
questions. Click **Ask** beside the selection. A question panel floats below the selected
line and follows it as you scroll, without changing the code viewport's height. **btw Q&A**
streams answers using the selected code, the main conversation's current readable context and
its own previous questions and answers. Each question reads the main context again, including
new main-conversation messages. Images and private reasoning are excluded from that snapshot.

No question or answer is appended to the main conversation or its Trace; usage is still metered
against the Session. The question request has no tools and cannot edit files. Closing or
reloading the preview clears this conversation; **Clear Q&A** starts over in place.

C/C++, JavaScript/TypeScript, Python, JSON, Rust and shell load their syntax parsers on demand,
with colored tokens for both light and dark mode.
Other text files use plain text. UTF-8 text up to 2 MB is previewed; larger or binary files can
be opened in VS Code. Files use the Session's existing Workspace access and path resolver,
including unique abbreviated names, on its own server.

Git changes appear in the same code view: added and modified lines have gutter marks, with
changed words highlighted. Removed code appears directly below its corresponding location,
with the old lines and their original line numbers. **Show changes** hides or restores these
marks without changing the source or selection.
One edit has a **Locate change** button; multiple edits have **Previous change** and **Next change**.
These actions are hidden when changes are hidden, and a file without edits has no change controls.

Choose **Unstaged** to read working-tree code or **Staged** to read the Git index. **Copy code**
only copies the selected current-version source, even while old code is displayed. **More**
contains **Copy diff**, which copies the complete patch. **Reload code**
refreshes both source and changes, and clears
side questions. Questions use the displayed version and nearby Git hunks; a changed snapshot
requires a reload before asking.

New text files appear as additions; deleted files retain their removed lines and support
questions about that diff. A complete chat path can reopen a deleted file; abbreviated names
require an existing file to resolve. Binary, empty, metadata-only and unchanged files have explicit states.
A non-Git Workspace still shows ordinary code. Diff reads are confined to the current Workspace
file, bounded to 2 MB and leave the Git index unchanged. The preview does not run external diff
drivers or clean/process filters.

The Workbench tab key `code-preview` is the host's preview entry. The iframe receives `session`,
`path`, optional `line`, `column`, `endLine`, `endColumn` and `locale` query parameters. The
preview renderer stays registered without adding a standalone Code tab beside Chat. No Skill is installed,
and the plugin is excluded from the default preinstalled set.

Build with `pnpm --filter @penguinharness/code-viewer build`; the build bundles CodeMirror and
separate parser chunks into the Workbench's `ui/editor/` directory. The host supplies React and
shared UI to the TSX page. The package ships those bundles and their linked MIT license notices.
