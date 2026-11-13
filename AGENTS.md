# AGENTS.md — OpenCode IDE Client

## Mission
Build a polished, native-feeling graphical OpenCode client for VS Code-compatible editors, prioritizing VSCodium and VS Code. The extension is a UI/client for the existing OpenCode server, not a replacement agent runtime.

## Working agreement
- Read `SPEC.md` and `PLAN.md` before changing code.
- Implement one small, verifiable milestone at a time. Update `PLAN.md` with progress and decisions.
- Prefer simple, maintainable TypeScript, React, and VS Code extension APIs. Do not introduce a framework or dependency without a clear need.
- Confirm SDK and API behavior against the installed OpenCode version or official API definitions; do not invent endpoints, config keys, event types, or authentication semantics.
- Do not assume the server's root URL returns JSON: it may serve the OpenCode web UI. Validate API routes and SSE content types separately.
- Never change user or workspace settings, editor group layout, view placements, or other extensions' state without an explicit user action.
- Never auto-run destructive commands or silently approve permissions. Preserve OpenCode's approval model.
- Treat model outputs, tool outputs, file contents, and server events as untrusted. Sanitize rendered content and enforce a strict webview Content Security Policy.
- Keep secrets out of logs, diagnostics, webview state, and source control.
- Avoid claiming support for capabilities until tested against a real server.

## Architecture boundaries
- Extension host: VS Code API, server connection, authentication, workspace context, and bridge to webview.
- Webview: React UI and presentation state; no direct Node access and no privileged operations.
- OpenCode adapter: isolated, typed layer around the supported OpenCode SDK/API, including reconnect and event lifecycle.
- Shared protocol: typed extension-host ↔ webview messages with runtime validation.

## Verification
- Typecheck, lint, and test changes before calling them complete.
- Add unit tests for connection state, event handling, and message protocol.
- Run integration tests against a real OpenCode server for sessions, messages, SSE, permissions, and reconnect behavior.
- Manually verify in VSCodium and VS Code, with an existing workspace and no workspace open.
- Confirm that installing, activating, disabling, and uninstalling the extension leave Codex, Claude, editor layout, and user settings untouched.
- Package a `.vsix` and verify installation in a clean editor profile.

## Definition of done
A feature is done only when its acceptance criteria in `PLAN.md` pass, failures are recoverable, and documentation reflects actual behavior.
