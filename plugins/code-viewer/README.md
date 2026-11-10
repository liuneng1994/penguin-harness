# Code Viewer

An optional CodeMirror 6 Workbench. Install **Code Viewer** on the Agent from PenguinHarness's
Plugins page, then click a file reference in its chat, such as `Expr.cpp:785-795`.

The preview opens in the center of the screen with the cited lines highlighted and twelve lines
of context on either side. Expand in either direction or show the full file. Search also reveals
matches outside the current snippet. Code is read only; select and copy text, or use **Copy code**
to copy the cited lines when nothing is selected. **Open in VS Code** remains in the dialog footer.
Escape closes the search panel first, then the preview, and returns to the same chat position.

Select code and use the interaction area below it. **Modify code** sends the file, exact selected
range, source text and your edit request to the main conversation; a busy conversation queues it.
The Agent uses its normal tools and approvals to edit the file. Use **Reload code** after the task
finishes, or **View main chat** to follow the task.

**btw Q&A** streams answers about the selected code in a separate conversation. It receives only
the selected code and its own previous questions and answers. No question or answer is appended
to the main conversation or its Trace; usage is still metered against the Session. It has no
tools and cannot edit files. Closing or reloading the preview clears this conversation; **Clear
Q&A** starts over in place.

C/C++, JavaScript/TypeScript, Python, JSON, Rust and shell load their syntax parsers on demand,
with colored tokens for both light and dark mode.
Other text files use plain text. UTF-8 text up to 2 MB is previewed; larger or binary files can
be opened in VS Code. Files use the Session's existing Workspace access and path resolver,
including unique abbreviated names, on its own server.

The Workbench tab key `code-preview` is the host's preview entry. The iframe receives `session`,
`path`, optional `line`, `column`, `endLine`, `endColumn` and `locale` query parameters. Opening
its tab without a citation shows an instruction to open a file in chat. No Skill is installed,
and the plugin is excluded from the default preinstalled set.

Build with `pnpm --filter @penguinharness/code-viewer build`; the build bundles CodeMirror and
separate parser chunks into the Workbench's `ui/editor/` directory. The host supplies React and
shared UI to the TSX page. The package ships those bundles and their linked MIT license notices.
