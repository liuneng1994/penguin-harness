# Code previews from chat file references

- **Date:** 2026-11-10
- **Type:** feature
- **Scope:** `web`, `server`, `core`, `plugins`
- **PR:** [#6](https://github.com/liuneng1994/penguin-harness/pull/6)

[中文版](2026-11-10-code-viewer.zh.md)

Install the optional Code Viewer plugin on an Agent to open chat file references in a centered,
read-only CodeMirror 6 preview. Citations such as `Expr.cpp:785-795` highlight the referenced
lines and show nearby context with their original line numbers.

## Reading a snippet

Expand above or below the snippet, show the full file, search, wrap long lines, and copy a
selection or the cited code. Escape closes the search panel first, then the preview and returns
to the same chat. The footer keeps the action to open the file in VS Code.

C/C++, JavaScript/TypeScript, Python, JSON, Rust and shell syntax parsers load on demand inside
the plugin. The preview follows the Session's server and existing Workspace access checks,
including resolution of unique abbreviated filenames. Missing and ambiguous filenames show the
resolver's error. Binary files and text over 2 MB stay available through VS Code.

The plugin is available in the library and is not preinstalled. Agents without it keep their
existing file-opening behavior. No conversation records or stored configuration change format.

## Interacting with code

Syntax tokens use a light and dark color palette. Select code to work on a precise range:

- **Modify code** submits the selection and requested change as a normal task in the main
  conversation, queuing it when busy. The Agent edits through its existing tools and approvals.
  Reload the preview after it finishes to read the new code.
- **btw Q&A** uses an independent, tool-free model request with selected code and its own
  follow-up history. Questions and answers never enter the main conversation or its Trace.
  Usage is still metered; closing, reloading or clearing the preview discards the side history.

The selected code stays visible when the question area grows. File-version checks refuse an
answer about changed code until the reader reloads the preview.
