# Changelog

## Unreleased

- Context meter beside the send button, with a near-limit warning and **Compact
  conversation** (OpenCode's own summarize); compaction shows as a divider with the
  summary folded; Stop works while compacting.
- Each finished exchange shows its duration and generated tokens.
- **Edits: ask / auto** toggle per session (OpenCode session permission rule; no
  configuration change); remembered as the default for new sessions; never relaxes a
  configuration that requires approval.
- Notifications when a reply finishes, fails or needs approval while the view is
  hidden or the window unfocused (`sidecode.notifications`, on by default).

## 0.1.0 — first release

First release of Sidecode, an OpenCode client in the editor's secondary side bar,
tested with OpenCode 1.19.4, VSCodium 1.143 and VS Code 1.145 on Linux.

- Connect to an existing OpenCode server (URL prompt on first Connect, optional
  password in secret storage, recoverable errors, Diagnostics output).
- Sessions shared with the OpenCode CLI: list, create, switch, resume.
- Streaming replies with Markdown and code copy; Stop; reconnect without duplicates.
- Step groups with per-step state, live command output, reasoning, a working line
  with elapsed time, provider-retry and empty-response-loop warnings.
- Explicit permission cards; edit review in the editor's diff view before approval;
  changed files with Open and Changes.
- Agent and model pickers from the server; per-session choice.
- Explicit context: current file, selection, workspace files and folders (project only).
- Pinned question while reading long replies; Enter to send.
- Keyboard accessible, high-contrast and reduced-motion aware; tested at 200–480 px.
