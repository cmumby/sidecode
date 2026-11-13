# SPEC.md — OpenCode IDE Client

## 1. Product vision
A modern, polished OpenCode chat-and-agent experience embedded in the IDE's sidebar, visually aligned with VS Code/VSCodium and comparable in usability to Codex and Claude Code extensions. This is a client for an existing OpenCode runtime, not a new coding agent.

## 2. Target environments
- VS Code and VSCodium on Linux, macOS, and Windows (Linux/VSCodium first).
- Use supported VS Code extension APIs; do not depend on Microsoft-only marketplace services.
- Deliver a locally installable VSIX.

## 3. Core UX
- Register a dedicated OpenCode view using `WebviewViewProvider`, dockable through normal IDE view controls, including the Secondary Side Bar.
- The user may manually group the OpenCode view alongside Codex/Claude; do not attempt to insert tabs into their proprietary interfaces.
- Never open an external window, browser, editor tab, or terminal as the default chat UI. Explicit actions may open editor diffs or files.
- Theme with VS Code CSS variables and codicons where appropriate; honor light, dark, and high-contrast themes.
- Comfortable narrow-width layout, keyboard navigation, visible focus states, accessible labels, and reduced-motion support.
- Header: session picker/new session, connection status, compact actions.
- Conversation: readable Markdown, syntax-highlighted code, copy actions, collapsible tool calls, streaming messages, errors and retry controls.
- Composer: multiline input, submit/stop, file/context attachments, agent/model selectors where the server supports them.
- Tool permissions: explicit allow/deny prompts with clear scope; no silent approvals.
- Diff review: use IDE-native diff editor where possible, with clear accept/reject semantics only when supported by OpenCode.
- Preserve session continuity when switching between CLI and extension using the same server and project context.

## 4. Connectivity
- Support connection to an already-running OpenCode HTTP server via configurable base URL, e.g. `http://127.0.0.1:4096`.
- The server root may serve HTML. Use documented API routes for JSON and SSE; validate response status and content type.
- Health check, initial connection, session listing, and event subscription are distinct states with clear diagnostics.
- Support auth only through documented server mechanisms. Store credentials securely using VS Code SecretStorage when applicable.
- Implement bounded retries with backoff, clean cancellation, reconnection, and event listener disposal.
- No assumption that LM Studio's OpenAI-compatible inference endpoint is an OpenCode agent server; LM Studio configuration belongs in OpenCode's model-provider layer.
- An optional managed-server mode is a future feature and must not be required for MVP.

## 5. Architecture
- Extension host (TypeScript): activation, view registration, configuration, secure credential access, workspace context, connection lifecycle.
- Adapter (TypeScript): supported OpenCode SDK/API client, typed events, session operations, permissions, diagnostics.
- Webview (React + TypeScript): interface and view state.
- Shared typed message contract: validated host ↔ webview commands/events.
- Prefer no direct HTTP from the webview; route privileged operations through the extension host.
- No telemetry by default. Diagnostics redact paths, tokens, credentials, and message contents unless explicitly included by user.

## 6. MVP capabilities
1. Installable VSIX; view appears as a tab in the Secondary Side Bar (beside other chat extensions) and can be moved like any view. (Changed from "Activity Bar" at the user's request.)
2. Connect to an existing OpenCode server; clear status and actionable connection errors.
3. List, create, select, and resume sessions.
4. Send prompts and stream assistant responses reliably.
5. Show tool execution and permission requests with correct handling.
6. Select supported models/agents if exposed by the installed server API.
7. Open referenced files and diffs using supported IDE APIs.
8. No workspace layout mutation, surprise windows, or disruption of other extensions.

## 7. Later capabilities
- Image attachments and drag/drop, richer file mentions, search, session rename/archive, conversation export, multi-workspace handling, notifications, local-model UX, and enhanced diff review.
- Do not promise exact feature parity with proprietary extensions.

## 8. Non-goals
- Reimplementing OpenCode's agent loop, tools, model inference, or CLI.
- Directly connecting the IDE extension to LM Studio as though it were the OpenCode server.
- Recreating Codex or Claude branding or proprietary UI code.
- Modifying IDE layout or settings automatically.

## 9. Acceptance criteria
- Existing server on 127.0.0.1:4096 connects using documented API routes even if `/` returns HTML.
- Sessions and streaming updates work; dropped connections recover without duplicated messages.
- Permission requests are visible and never silently approved.
- View docks in the right sidebar and remains usable at narrow widths.
- Claude and Codex views, workspace layout, and editor settings remain unchanged after install/use/uninstall.
- Works in VSCodium and VS Code with both a folder open and an empty window.
