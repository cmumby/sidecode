# PLAN.md — Implementation Roadmap

## Working rules
Work phase by phase. Before coding, validate the installed OpenCode server's supported SDK/API, version, authentication, and event contracts. Update checkboxes only after verification. Record unexpected incompatibilities and decisions here.

## Phase 0 — Discovery and feasibility
- [x] Inspect official OpenCode SDK/API and server event contracts; record supported versions.
- [x] Verify `/global/health`, session endpoints, event streams, and auth against a real server.
- [x] Determine whether sessions are project/directory scoped and how to resume CLI sessions.
- [x] Confirm supported VS Code APIs and VSCodium packaging requirements.
- [x] Record architecture decision and minimal dependencies.

**Exit:** A small command-line proof of connectivity can list sessions and receive events without confusing HTML web routes with API routes.

## Phase 1 — Extension shell and layout safety
- [x] Scaffold TypeScript extension, React webview, and shared typed protocol.
- [x] Register a dockable OpenCode sidebar view; no external window or editor tab for chat.
- [x] Apply IDE theme tokens, light/dark/high-contrast, and responsive narrow-width styling.
- [x] Add a placeholder header, message list, and composer.
- [x] Add VSIX packaging and local installation instructions.

**Exit:** The view opens and can be moved to Secondary Side Bar; installing it does not rearrange existing views or editor groups.

## Phase 2 — Server connection and diagnostics
- [x] Implement configurable existing-server URL.
- [x] Add documented API health/version checks and precise error reporting.
- [x] Handle SSE subscription, reconnection, cancellation, and disposal.
- [x] Add optional supported authentication using SecretStorage.
- [x] Add redacted diagnostic output and unit tests.

**Exit:** A live server connects, and stopping/restarting it produces recoverable status changes.

## Phase 3 — Conversations
- [x] List/create/select/resume sessions in correct project context.
- [x] Send prompts and stream assistant text without duplicates.
- [x] Render Markdown, code blocks, copy controls, and message status.
- [x] Implement stop/cancel and retry where API supports them.
- [x] Verify CLI ↔ IDE session continuity.

**Exit:** A real end-to-end chat works, including reconnection and switching sessions.

## Phase 4 — Agent workflow
- [x] Display tool calls/results, progress, and errors.
- [x] Implement explicit permission prompts and responses.
- [x] Add agent/model selectors based on server-supported options.
- [x] Support open-file, selected-text, and workspace context explicitly.
- [x] Open IDE-native file/diff views when supported.

**Exit:** A coding task can be reviewed and approved without leaving the IDE chat experience.

## Phase 5 — Polish and release
- [x] Keyboard accessibility, focus handling, high contrast, and reduced motion.
- [x] Responsive layout tests at narrow sidebar widths.
- [x] Integration tests on Linux VSCodium and VS Code.
- [x] Confirm no changes to Codex, Claude, layout, settings, or workspace state.
- [x] Build, install, uninstall, and reinstall VSIX in clean profiles.
- [x] Write README, troubleshooting, and known limitations.

**Exit:** A stable first VSIX release with documented support matrix.

## Phase 6 — Later capabilities (SPEC §7), in the user's order
- [x] Local-model experience and notifications: context usage with a near-limit
  warning, per-reply duration and tokens, notifications when a reply finishes or needs
  approval while the view is hidden.
- [ ] Session rename and archive; search.
- [ ] `@file` mentions and drag-and-drop.
- [ ] Image attachments (verify 1.19.4 support first).
- [ ] Conversation export; multi-workspace handling.

**Exit:** each item verified against the real server and both editors, documented.

## Design exploration (after documents are agreed)
Produce 2–3 distinct static UI concepts before implementing the final visual language:
- A. Native minimal — very close to VS Code's built-in Chat appearance.
- B. Modern restrained — Claude/Codex-like conversation rhythm, subtle cards and tool states.
- C. Dense developer — compact message/tool layout optimized for long coding sessions.
Choose a direction, then refine narrow sidebar, empty state, active chat, tool approval, and error states.
(Direction chosen: B with per-step status — see "Design exploration" below.)

## Decisions to confirm
- ~~Extension display name and identifier.~~ Decided by user: Extensions view shows
  **Sidecode** (`displayName`); ID stays `sidecode-local.sidecode`. Views, commands and
  settings keep the OpenCode label because they describe the server being used.
- ~~Initial supported OpenCode version range.~~ 1.19.4 only (the only tested version);
  others are untested and documented as such in the README support matrix.
- ~~Server auto-start.~~ Not offered: the README documents `opencode serve --port 4096`.
- ~~View placement.~~ Decided by user: a tab in the secondary side bar beside Codex and
  Claude Code (`viewsContainers.secondarySidebar`, editor 1.106+).


## Implementation record — 2026-11-12

Historical Phase 1 record: implementation was in place with native verification open.
See the continuation record below for native docking and Phase 2 completion.

### Discovery and decisions
- Read AGENTS.md, SPEC.md and this roadmap in full before changes.
- Local OpenCode binary/server: 1.19.4. Pinned SDK 1.19.4, client-only
  `@opencode-ai/sdk/v2/client`; ESM discovery script, CommonJS extension bundle.
- Real server: `/` serves HTML; `/global/health`, `/doc`, directory-scoped
  `/session`, `/event` and `/global/event` passed read-only probes. SDK proof
  lists session count and receives `server.connected` without logging contents.
- Phase 0 connectivity proof passes for this unauthenticated instance. Authenticated
  Basic auth, CLI continuity and precise project/worktree scope remain unverified;
  their combined checklist items above intentionally stay open. No broader server
  version range or conversation support is claimed. See `docs/discovery.md`.
- Dedicated Activity Bar container follows SPEC.md; no automatic movement.
  Provisional display name OpenCode IDE Client (Sidecode), ID `sidecode-local.sidecode`.
- Native minimal shell is provisional; final visual design still needs 2–3 concepts.
- React + TypeScript, esbuild, ESLint, Node tests, vsce. Separate extension,
  adapter, shared protocol and webview directories. SDK stays development-only.
- TypeScript/ESLint tooling pinned for installed Node 22.12; minimatch overridden
  to 11.0.1 to resolve a development dependency advisory. Lint/build/package tests
  validate this override; review/remove when upstream tools adopt the fix.
- No Git metadata was present; no repository URL, release license or marketplace
  identity was invented. Package is private and for local testing.

### Verification and limits
- `npm run check`: strict typecheck, lint, 4 protocol/security/lifecycle tests, build pass.
- `npm run package`: local VSIX built; package contains only manifest, README,
  bundled host/webview and the Activity Bar icon (no SDK, tests or server runtime).
- `npm run probe`: SDK health 1.19.4, zero sessions in project context, SSE connected.
- `npm run test:editor`: VSCodium 1.143.17232 passes installed-VSIX activation,
  view focus, unchanged tab groups/configuration with folder and empty window,
  plus clean-profile install/uninstall/reinstall.
- Same test passes in VS Code 1.145.2. All editor tests use new temporary user-data
  and extension directories. The user's existing configuration/layout/extensions
  were not modified by project code or test commands.
- Editors emitted host-environment file watcher (EMFILE), GPU and built-in proposal
  warnings; suites still passed. No machine/editor settings were changed to hide them.
- Dependency installation audit: zero vulnerabilities after packager update and override.
- `npm run test:webview`: 12 passing combinations (200/240/320 px; light, dark,
  high contrast dark/light), bridge handshake, disabled controls and no overflow
  or browser errors. Dark and high contrast light screenshots inspected.
- Browser layout checks use simulated IDE theme tokens; they do not replace native
  theme, docking, screen-reader or third-party coexistence testing.
- Manual Secondary Side Bar movement, visual inspection in both native editors,
  disable/re-enable and existing Codex/Claude coexistence remain unchecked in
  `docs/verification.md`. Thus the full Phase 1 exit is not yet declared passed.

### Historical next milestone (superseded below)
Finish the isolated manual Phase 1 checklist, then implement Phase 2 existing-server
connection states and diagnostics behind the adapter boundary. Add state/event tests
with that implementation and verify authenticated mode and bounded reconnect against
an isolated real server. Do not proceed to conversations or managed server mode yet.


## Continuation — Phase 2 connection milestone

### Delivered
- Explicit Connect/Disconnect, machine-scoped `sidecode.serverUrl`, native URL and
  credential dialogs, endpoint-scoped SecretStorage and fixed-code Output diagnostics.
  No automatic connection or configuration writes; Set Server URL is an explicit
  user action. No secrets or server content cross the host/webview bridge.
- Pinned SDK client is now a runtime dependency, bundled into the host. No server
  launcher, model runtime or session mutation was added to the extension.
- Health, sessions, event startup and connected states are distinct. JSON/SSE
  status/content types and consumed data are validated. Redirects are refused.
- Three retries with 0.5/1/2-second backoff; 10-second startup/request and 45-second
  event-idle watchdogs. Retry budget resets after a minute of stable connection.
  Cancellation covers fetch, SSE, timers, replaced connections and disposal.
- Project selection is explicit for multiple folders/empty windows. Workspace or
  server URL changes disconnect. Trust is required; virtual workspaces are disabled.
  Filesystem context must match the server (no arbitrary remote path mapping).
- Authenticated remote URLs require HTTPS; loopback HTTP is supported. SecretStorage
  stores server credentials separately for each normalized URL. Clear credentials
  affects only that endpoint. Native OS keyring persistence remains a release check.

### Verification
- 17 unit tests pass: protocol/CSP, activation safety, endpoint-scoped credentials,
  cancelled dialogs, trust gate, config-change cancellation, connection stages,
  timeouts, stale attempts, bounded retries, redaction, event validation and SDK routes.
- Typecheck/lint/build pass. Browser checks pass for 12 theme/width fixtures,
  including Connect/Disconnect actions, status/error updates and expanded controls.
- Final Phase 2 VSIX packaged successfully. Clean-profile install, activation in
  empty/folder windows, unchanged configuration/tab groups, uninstall and reinstall
  all pass again in VSCodium 1.143.17232 and VS Code 1.145.2. Host watcher warnings
  persist; no system settings were changed to suppress them.
- Native Playwright/Electron checks pass in both VSCodium and VS Code: visible React
  UI, focusable Connect control, movement via native Move View to Secondary Side Bar,
  and real Connect/Disconnect through the webview against existing OpenCode 1.19.4.
  Both empty-window and folder rendering were exercised in disposable profiles.
- Isolated real-server test passes: OpenCode 1.19.4 rejects missing credentials,
  accepts Basic auth, lists sessions, streams connection/heartbeat traffic, then
  recovers after stopping/restarting only the test process. No prompts or session
  mutations, no changes to the user's running server or its credentials/config.
- Test-server isolation uses upstream-verified XDG paths, OPENCODE_TEST_HOME,
  OPENCODE_CONFIG_DIR, project-config/model-fetch/autoupdate disable flags and --pure.
  This launcher is test-only; it is not shipped in the VSIX.
- Phase 2's connection/restart exit is met for tested version 1.19.4. Phase 1 native
  docking is now verified. Broad Codex/Claude coexistence, screen reader behavior,
  native theme matrix and disable/re-enable checks remain explicit Phase 5 gates.

### Next milestone
Stop here before conversations. Phase 3 should first verify CLI-created session
scope/continuity, then implement session selection and streaming with deduplication.
Keep permissions visible and explicit when Phase 4 adds tool interaction.


## Continuation — Phase 3 conversations (resumed from interrupted Codex session)

### Delivered
- `src/adapter/conversations.ts`: session list/create, message history, status,
  pending-permission detection, `promptAsync`, `abort`; validated, directory-scoped
  projection to IDs/titles/text/status only.
- `src/adapter/chat.ts`: snapshot-based chat state. SSE events only invalidate;
  coalesced refreshes replace messages by ID (no delta accumulation, so no
  duplicates after reconnects). Stale reads discarded; mutations never auto-retried;
  uncertain sends/creates surface a "refresh before resending" error.
- Shared `ChatState` and chat commands are validated in both bridge directions.
- Webview: session picker, New session, Markdown rendering (`react-markdown`
  + `rehype-highlight`, pinned; raw HTML skipped, links/images not rendered),
  code copy button, per-session drafts, Send/Stop, load earlier messages, busy and
  permission-waiting notices. Permissions are never answered by the extension.
- Test-only fixtures: isolated server helper and a deterministic local
  OpenAI-compatible model so real-server tests spend no credits.

### Decisions
- Snapshot reconciliation over delta streaming: simpler and duplicate-proof;
  200 ms coalescing gives visible incremental streaming (verified multiple
  intermediate lengths). Revisit if very long histories make refreshes costly.
- No automatic prompt resend after an uncertain failure (avoids duplicate prompts).
- Disconnect stops updates only; Stop is the explicit server-side cancel.

### Verification
- `npm run check` (typecheck, lint, 24 unit tests, build) passes.
- `npm run test:conversations` passes against isolated OpenCode 1.19.4 (directory
  scope, streaming, CLI ↔ IDE continuity, reconnect without duplicates, Stop, switching).
- `npm run test:webview` passes 12 theme/width cases including populated untrusted
  conversation, busy/permission/send gating and no overflow at 200–320 px.
- VSIX repackaged (8 files, no fixtures/SDK sources); VSCodium 1.143.17232
  clean-profile install/activation/uninstall/reinstall passes.

### Native end-to-end verification (Phase 3 exit)
- New `npm run test:native:chat` drives the real editor webview against isolated
  OpenCode 1.19.4 + model fixture: native URL/credential dialogs, Connect, New
  session, Send, live streaming, Markdown, code copy, Stop, reconnect without
  duplicates. Passes in VSCodium 1.143.17232 and VS Code 1.145.2.
- Defect found and fixed: 1.19.4 stores a text part's text only when the part
  finishes, so snapshot-only rendering showed replies all at once. Added an ordered
  `message.part.delta` overlay in `chat.ts` (snapshots remain authoritative; overlay
  dropped on disconnect/session change/finish). The integration test now requires
  ≥3 partial lengths while streaming (12 observed); the old ≥2 check was too weak.
- 25 unit tests (new overlay test) pass; `test:conversations` and `test:webview` pass.
- Display name changed to **Sidecode** per user; VSIX rebuilt; clean-profile
  install/uninstall/reinstall passes in both editors (one intermittent VS Code
  folder-window failure, not reproduced in three reruns; see docs/verification.md).

**Phase 3 exit met** for OpenCode 1.19.4.

### Next milestone
Phase 4: display tool calls/results, then explicit permission prompts and responses
(verify the 1.19.4 permission reply API against an isolated server first).


## Continuation — Phase 4: tool calls and permissions

### Delivered
- Messages carry display-only `tools` (name, status, title, clipped output/error);
  collapsible rows rendered as plain text. Other part types still show a notice.
- `ChatState.permissions` lists pending requests for the selected session (id,
  permission, patterns, always). Webview card: Allow once / Deny; Always allow behind
  "More options" with its verified scope stated. No auto-focus, no auto-answer.
- `permission` bridge command → `Chat.reply` → `permission.reply`. Only for a shown
  request in the selected session; never retried; `replyUncertain` while still pending.
- Test-only model fixture can request one harmless `bash echo` (`RUN_TOOL`).

### Decisions
- Show permissions only while the session is busy: 1.19.4 keeps a request listed
  after Stop; hiding it avoids offering Allow/Always for a dead request.
- No free-text rejection message yet (SDK supports it); Deny sends plain `reject`.
- Agent `question` requests are not rendered; a notice points to the CLI/Stop.

### Verification
See docs/verification.md (Phase 4). Unit, real-server, browser and native tests pass
in VSCodium and VS Code; Phase 3 conversation test still passes; VSIX rebuilt.

### Known polish
- Running tools show compact input JSON until OpenCode supplies a title.
- Screen-reader behavior of permission cards is unverified (Phase 5).

### Next milestone (done below)
Phase 4: agent/model selectors from server-reported options.


## Continuation — Phase 4: agent and model selectors

### Delivered
- `ConversationApi.options` → `app.agents` + `config.providers`. Agents: `primary`/`all`
  and not hidden (subagents and internal title/summary/compaction agents excluded).
  Models: every configured provider's non-deprecated models, capped at 500.
  Loaded on connect and on Refresh; a failed load keeps the previous lists.
- `ChatState.agents`, `models` and `used` (agent/model of the selected session's
  latest user message). Composer gets Agent and Model selects (models grouped by
  provider, "OpenCode default" omits the field). Choices are per session in the
  webview, like drafts; otherwise the selects start from `used`.
- `send` carries `agent` and `model` (`null` = omit). The host sends only values in
  the latest lists; anything else gets `optionUnavailable` and is not sent.
- `session.error` for the selected session (except a Stop) shows a fixed
  `sessionError` message; the raw server text (paths, stack traces) is never shown.
  It clears on the next send or session change, or once a failed/stopped reply
  explains the failure.

### Decisions
- Start from the session's last agent/model rather than "default": omitting `agent`
  resets an existing session to the default agent while omitting `model` keeps its
  last model (see docs/discovery.md), so a blank default would silently switch agents.
- `config.providers().default` is a per-provider default, not the configured model,
  so it is not presented as "the default".
- Unknown names are accepted by `promptAsync` and fail only via `session.error`;
  hence local validation against the lists plus the generic error message.

### Verification
`npm run check` (35 unit tests), `npm run test:selectors`, `test:webview`,
`test:permissions`, `test:conversations`, and `test:native:chat` in VSCodium and
VS Code pass; VSIX rebuilt (8 files).

### Known limitations
- No model variants (reasoning effort) selector yet.
- With "OpenCode default" chosen for the model in an existing session, the server
  keeps that session's last model, not the configured default.

### Next milestone (done below)
Phase 4: explicit open-file, selected-text and workspace context.


## Continuation — Phase 4: explicit context

### Delivered
- Composer "Add context" buttons: **Current file**, **Selection**, **Workspace…**
  (multi-select quick pick of project files and their folders; `node_modules` and
  `.git` excluded, capped at 5000 files). Nothing is attached without a click.
- The host resolves context (`src/extension/controller.ts`, `context.ts`): files and
  folders become `file://` parts that OpenCode reads itself; a selection is sent as
  a `data:` part with exactly the editor text (unsaved edits included). Files with
  unsaved changes carry a note that the saved version is read.
- `projectLabel` resolves real paths (symlinks included) and accepts only paths
  strictly inside the connected project folder.
- Pending context is per session in the host (`Chat.addContext/removeContext`);
  the webview gets only `{ id, kind, label, note }` chips and can remove them. The
  same URL is attached once, at most 20 items, sent with the next prompt and
  cleared only after a confirmed send (kept after an uncertain one).
- History shows attachment chips (kind + `filename` label) on user messages instead
  of the "other activity" notice; URLs and injected contents never cross the bridge.
- Harness allowlists now include read-only `realpath`, `node:path`, `node:url`.

### Decisions
- Host-side boundary: OpenCode 1.19.4 reads any `file://` path, including outside
  the project (see docs/discovery.md), so the extension enforces the project folder.
- Selection as data rather than `file://…?start=&end=`: what the user sees is what
  is sent, even unsaved. Whole files use `file://` so OpenCode reads them with line
  numbers and its own size limits.
- Labels are workspace-relative; absolute paths are never shown in the webview.

### Verification
40 unit tests (incl. real-filesystem symlink/sibling/`..` boundary tests),
`npm run test:context`, `test:webview`, `test:selectors`, `test:permissions`,
`test:conversations`, `test:native:chat` in VSCodium and VS Code, VSCodium
`test:editor`; VSIX rebuilt (8 files).

### Known limitations
- Paths are sent as the extension host sees them; the server must share that
  filesystem (local server, or a server in the same remote/container).
- Only the primary selection of a multi-cursor selection is attached.
- `findFiles` exclusions are fixed (`node_modules`, `.git`); `files.exclude` and
  `.gitignore` are not applied to the workspace picker.
- At 240 px the composer (context buttons, selectors, actions) is tall; revisit in
  the design pass.
- Native test hardening: the first webview click is retried because the frame can
  be found before React mounts (one intermittent failure observed).

### Next milestone (done below)
Phase 4: IDE-native file and diff views.


## Continuation — Phase 4: native file and diff views (Phase 4 complete)

### Delivered
- **Before approval:** `edit` permission cards show "Proposed change: path +n −m" and
  a **Review changes** button. The host applies the request's `metadata.diff` to the
  file on disk and opens `vscode.diff` (current file ↔ read-only proposed copy; empty
  ↔ proposed for new files). Reviewing never answers the request or writes a file.
- **After the edit:** completed `edit`/`write` tool rows show the file label and
  counts with **Open file** and **Show changes** (before ↔ current, the patch
  reversed against the file; a new file is shown against empty).
- If a patch no longer matches the file, the patch itself is shown read-only with
  a notice instead of a guessed diff.
- `src/adapter/patch.ts`: strict single-file unified-diff parse/apply/reverse/stats
  (no new dependency). Read-only `sidecode-preview:` documents, provider registered
  on first use, at most 20 kept.
- Paths and patches are host-only (`ProjectedMessage.changes`, snapshot `reviews`);
  `Chat.render` now builds bridge messages from an explicit field allowlist. The
  webview sends only request/tool IDs (`reviewPermission`, `openChange`).
- `projectTarget` re-checks every path against the real project folder, including
  not-yet-existing files (nearest existing ancestor resolved, so symlinked folders
  cannot escape).
- Model fixture: `RUN_EDIT` (edit `src/a.ts`) and `RUN_WRITE` (create `notes.md`).

### Decisions
- Tool and permission metadata, not `session.diff`: in 1.19.4 `session.diff` is
  empty unless the project is a git repository, while the metadata is always there.
- The proposed diff is built from disk content, matching what OpenCode will edit;
  unsaved editor changes are not part of the preview.
- Diff views open as preview editors and only on an explicit click.

### Verification
45 unit tests, `npm run test:changes` (non-git project, `edit: ask`), `test:webview`,
`test:context`, `test:selectors`, `test:permissions`, `test:conversations`,
`test:native:chat` in VSCodium and VS Code (real diff editor before and after
approval), VSCodium `test:editor`; VSIX rebuilt (8 files).

### Known limitations
- Only `edit` and `write` tools are recognized; other editing tools (e.g. a model's
  `apply_patch`) show as plain tool rows.
- An overwrite by `write` (`exists: true`) has no patch in 1.19.4: Open file only.
- The permission card still lists the server's raw `patterns`, which for edits is the
  server-side absolute path without its leading slash.
- No session-wide "all changes" list or revert (OpenCode `session.revert` exists but
  is a destructive operation; not in scope without explicit design).

### Phase 4 exit
A coding task can be reviewed (proposed diff in the editor) and approved or denied
from the chat, and the result inspected in native file/diff views. Next: Phase 5
(polish and release) and the design exploration.


## Design exploration — concepts ready for a decision

`docs/design/directions.html` (static, not shipped in the VSIX) shows three sidebar
concepts with the same real session content, switchable by state (new session,
working, edit approval, connection lost) and width (240/300/380 px):
A native minimal, B modern restrained, C dense developer.

Shared changes in all three: connection controls move into a ⋯ menu with only a
status dot visible; the session picker becomes the header title; Add context and
agent/model move into the composer toolbar with pending context as chips inside
the input; connection loss becomes a slim banner.

Decision (user): **B, modern restrained**, with per-step status: each step shows
its own state by shape and color (✓ completed, ✕ failed + short reason, spinning
ring running, empty ring queued, ! waiting for approval), the group header
summarizes the run, and finished runs fold to one line. Also kept: A's ⋯ menu,
session-as-title and composer toolbar; C's collapsed finished runs. Adjustments:
contrast borders instead of shadows/fills in high-contrast themes, tighter radii
and padding below 260 px, steps stay expandable to plain-text output.


## Continuation — Direction B implemented in the webview

### Delivered
- Header: the session picker is the title (accessible name "Session"), with **+**
  (New session) and **⋯** (Connection options: Disconnect, Refresh, Server URL,
  credentials, Diagnostics; closes after a choice, Escape closes). The status line
  keeps a dot and a visible **Connect** button while disconnected. Errors and
  "updates paused" while reconnecting are slim banners.
- Conversation: your messages as soft bubbles; replies full width. Each reply's
  tools form a step group (`StepGroup`): per-step mark by shape and color with a
  hidden text label, a failure reason from the first output line, "needs approval"
  for the step held by a permission, and "unknown" (dashed ring) while disconnected.
  The group is open while active and folds to "n steps · done / k failed" when
  finished. Changed files (`FileChanges`) stay visible below with Open / Changes.
- Permission card: raised card; edit requests lead with the file and +n −m (raw
  absolute patterns hidden when they repeat the file); Review changes, Deny,
  Allow once (primary). Never focused or answered automatically.
- Composer: one rounded box with pending context chips, the textarea, and a toolbar
  (+ Add context menu, agent and model pickers, one round Send/Stop button).
- High contrast: shadows and fills replaced by contrast borders. ≤260 px: tighter
  padding and radii. Reduced motion: no spinner or caret animation.
- Running tools are titled by their main argument (`filePath`, `command`, …)
  instead of raw input JSON; the streaming caret hides while waiting for approval.
- Markdown lists are scoped to `.markdown` so step/file/chip lists are not indented.

### Verification
46 unit tests; `test:webview` (12 theme/width cases incl. step states, folded
summary, menus, Stop replacing Send, no overflow); `test:changes`, `test:context`,
`test:selectors`, `test:permissions`, `test:conversations`; `test:native:chat` in
VSCodium and VS Code; VSIX rebuilt (8 files); VSCodium `test:editor` passed 3/3 in
three consecutive runs (one earlier run reported fewer PASS lines in a counted grep
with exit 0, likely interleaved editor output; not reproduced).

### Next
Phase 5: keyboard/focus review (menus, step groups, approval), screen-reader
announcements, high-contrast check in the real editors, narrow-width review.


## Placement: secondary side bar tab (user request)

The view container moved from `activitybar` to `viewsContainers.secondarySidebar`,
so OpenCode is a tab in the right-hand side bar beside Codex and Claude Code. Both
of those extensions use the same contribution point and treat VS Code 1.106 as the
first version supporting it; their left-side fallback for older editors needs
`onStartupFinished` activation, which this project avoids, so `engines.vscode` is
now `^1.106.0` instead. This is a static manifest default; users can still move the
tab, and nothing changes layout at runtime. Verified: unit test asserts the manifest;
`test:native:chat` asserts the tab is in the secondary side bar (VSCodium and VS
Code, all 8 steps); `test:editor` passes in both editors; VSIX rebuilt.

## Fix: connection buttons silently ignored (user report)

User report: ⋯ menu actions (Server URL, …) "just collapse" and nothing happens.
A fresh install of the VSIX (trusted and Restricted Mode) opened the Server URL
prompt correctly, so the user's window was likely running an older extension host;
the user's own session logs could not be located to confirm. The code did have a
matching flaw: one shared `dialog` lock covered every action, including Connect's
SecretStorage read, and clicks were silently dropped while it was held. A keyring
read that stalls (possible on Linux) would make every later click do nothing.

Fixed: no shared lock (a new input box cancels an open one; the epoch drops stale
Connect attempts); secret read/store time out after 10 s with the existing
"Could not read or save credentials" error and `credentials=read-timeout` /
`store-timeout` in the output; every action is logged by name only
(`action=configure`). The workspace picker keeps its own `picking` flag.
Tests: 2 new controller tests (stalled keyring does not block Server URL and fails
visibly; a second prompt opens instead of being ignored); 48 unit tests,
`test:native:chat`, `test:editor`, `test:placement` pass; VSIX rebuilt.


## User feedback round: Enter, send button, visible progress, first Connect

- Enter sends, Shift+Enter adds a line (IME composition respected). The send button
  is always filled with the primary button color (dimmed when disabled); it was
  transparent while disabled because `button.icon` outranked `.send`.
- "It just hangs": discovery (docs/discovery.md) showed the hidden signals. Now:
  `ChatMessage.reasoning` (stored + live via the delta overlay) in a Thinking block
  that folds once the reply starts; running tools show `metadata.output` (newest
  end) and their latest line in the step row; `ChatState.retry` (attempt, provider
  message as plain text ≤500 chars, next try) replaces the spinner with a notice
  and hint; the working line names the phase (waiting for the model / thinking /
  running <tool> / writing the reply) with elapsed time, plus a hint after 30 s with
  no model response.
- First Connect with no saved `sidecode.serverUrl` opens the URL prompt (prefilled)
  and connects to the confirmed address; connection errors offer "Change server
  URL" or "Set credentials".
- Verification: 52 unit tests (+ first-Connect, reasoning, live output, retry
  validation), `test:progress` (new, real server), `test:webview`, all real-server
  suites, `test:native:chat` in VSCodium and VS Code (sends with Enter),
  `test:editor`; VSIX rebuilt.

- Pending steps (user report: "edit {}" with no explanation): 1.19.4 sends no
  argument progress (see docs/discovery.md). The step now reads "model is writing
  it · <elapsed>" (no `{}` placeholder), expands to an explanation, the working line
  says "Model is writing the <tool> step", a hint appears after 30 s, and the stray
  streaming cursor is hidden under unfinished steps. Elapsed times are measured from
  when this view first saw the step. Tests: unit, `test:webview`, `test:progress`
  (new RUN_LONGWRITE fixture streams arguments slowly); all suites and both native
  editors pass; VSIX rebuilt.
- Intermittent `test:editor` failure (recorded since Phase 3) explained: VSCodium's
  built-in external-terminal component registers `terminal.explorerKind` and
  `terminal.external.*` with defaults asynchronously, so a whole-configuration
  snapshot sometimes gained keys mid-test. The suite now fails only if an existing
  setting changes or disappears, or a `sidecode.*` key appears, and reports the
  changed paths; newly registered keys are counted in a note. 4/4 runs pass (one
  hit the race and passed with the note).

## Pinned question (user request, like Claude Code)

While you read an exchange whose question has scrolled out of view, a slim bar at the
top of the conversation shows that question (plain text, two lines); scrolling into
an earlier exchange pins its question instead; the bar disappears while the question
itself is visible; clicking it scrolls back to the question. Computed from scroll
position (not CSS sticky) so it behaves in narrow side bars. Verified in
`test:webview` (all 12 theme/width cases: latest pinned at the bottom, earlier
exchange pins its own, none at the top, click jumps back, no overflow) and both
native editors; VSIX rebuilt.


## Empty-response loop (user report: "running forever", content bumping up)

Cause (read-only inspection of the user's server): the model kept ending turns with
`finish_reason: tool_calls` and no tool call; OpenCode looped, creating ~2,200 empty
assistant steps while busy. The view rendered each as blank space, so the
conversation "bumped" every step with no explanation.
Fix: runs of empty assistant replies render as one counted line; a run of 2+ at the
end of a busy session is a warning (count, cause, what to check, Stop) that replaces
the spinner; finished runs show "N empty responses from the model."; no streaming
cursor for empty replies. Tests: `test:progress` reproduces the loop against the real
server (EMPTY_LOOP fixture) and Stop ends it; `test:webview` checks the warning, no
blank rows, and the finished note in all themes/widths; native tests in both editors
pass; VSIX rebuilt.


## Phase 5 — polish and release (complete)

- Keyboard: Escape closes the ⋯ and + menus from the button or the menu and returns
  focus to the button; choosing a menu item returns focus too. `test:webview` walks
  the whole view with Tab in 16 cases and asserts order (session, new, menu, …,
  message box, context, agent, model, send) and a visible focus ring on every stop
  (found and fixed: no fallback for `--vscode-focusBorder`, which dropped the
  outline when the variable is absent).
- Screen readers: a polite status announces when a run ends ("OpenCode finished
  replying." / failed / stopped), not the reply text.
- Reduced motion and high contrast asserted (no animations; borders, no shadows).
- Widths: 200, 240, 320 and 480 px in four themes.
- Coexistence: new `test:coexistence` copies the installed Codex and Claude Code
  extensions into a disposable profile and launches without, with and again without
  Sidecode: container placement (including overflowed tabs), settings file, saved
  view locations and the extensions' files are unchanged; passes in VSCodium and
  VS Code (where the built-in Chat container is also unchanged).
- Lifecycle: `test:editor` (clean-profile install/uninstall/reinstall, no setting or
  editor-group changes) passes in VSCodium and VS Code; `test:native` updated for the
  default secondary side bar placement and verifies users can still move the view.
- Docs: README rewritten for users (support matrix, install, server start, connect,
  usage, troubleshooting, known limitations, privacy and safety, development);
  CHANGELOG.md added and shipped in the VSIX.

**Exit met:** first VSIX release (0.1.0) with a documented support matrix. Next: bug
fixes and refinements from use.


## Phase 6.1 — local-model experience and notifications (done)

- `ChatMessage.time` (epoch ms), `tokens { context, output }` and `kind`
  (`message` / `compaction` / `summary`); `ModelOption.context` from `limit.context`.
- Context meter (latest step's context vs the session/selected model's limit;
  after compaction, the summary's size), warning at ≥80% with **Compact
  conversation** (`compact` command → `session.summarize` with the session's model,
  10-minute wait, never retried, `compactFailed` if unconfirmed); Stop works during
  compaction without reporting a failure. Compaction marker → divider; summary →
  folded block. Reply stats per finished exchange (duration from your message to the
  last reply, generated tokens).
- Notifications (`src/extension/notify.ts`, setting `sidecode.notifications`,
  default on): finished / failed / waiting for approval, only when the view is
  hidden or the window unfocused, never for Stop or session switches; **Show**
  focuses the view only when chosen.
- Bugs found by the native test and fixed before release: the new timestamp
  validator capped values at 1e12 (epoch ms is ~1.8e12) so real states were
  rejected; tests now use real timestamps. The notification rule ignored the
  snapshot that ends a run (it arrives while `loading` is true); the unit test now
  follows the real update order. The clipboard check now polls briefly.
- Verified: 57 unit tests; `test:webview` (meter, warning, Compact, divider, summary,
  stats, compacting phase, Stop) in 16 cases; `test:progress` (real timing/tokens,
  model context size, real compaction); `test:native:chat` 9/9 incl. a real
  notification and Show, in VSCodium and VS Code; `test:editor`, `test:lifecycle`,
  `test:native` and all real-server suites pass; VSIX rebuilt.


## Edit approval toggle (user request, like Claude Code)

"Edits: ask / auto" in the composer toolbar sets a per-session OpenCode permission rule
(`edit / * / ask|allow` via `session.update`); nothing is written to configuration. The
choice is remembered in extension storage (`globalState.askBeforeEdits`) and applied
when creating sessions. State comes from the session's newest `edit / *` rule, else the
configuration (`config.permission`), else OpenCode's default (allow). Because a session
`allow` overrides a configured `ask`, the toggle is locked on when the configuration
asks, denies or uses per-pattern edit rules; `deny` shows "Edits: blocked". Toolbar
wraps at narrow widths so the label stays readable.
Verified: 59 unit tests (rule parsing, lock, remembered default); `test:edit-approval`
(new, two real servers: on asks, off applies, default carries to new sessions, refresh
reads state back, configured ask cannot be relaxed); `test:webview` (states, lock,
blocked, no overflow in 16 cases); `test:native:chat` 9/9 in VSCodium and VS Code
(locked state with a configured ask); other suites pass (`test:changes` failed once at
its last step and passed on two reruns: intermittent). VSIX rebuilt.

- Outdated extension host (user report: "connected but can't type or select"): after
  `--install-extension --force` without reloading, the window kept the old extension
  host while the view loaded the new build; the view rejected every chat state (new
  fields), so it stayed empty and disabled while "Connected". Verified against the
  user's server that the data itself validates. Now the view detects a well-formed
  but unrecognised host message and shows "Sidecode was updated. Reload the window…"
  (no button: the old host could not handle a new command). README install steps say
  reloading is required. Covered in `test:webview`.
- Elapsed timers reset on session switch / view reload (user report): they used the
  view's own clock from when it first saw a run or step. Now the run time comes from
  the latest question's server `time.created`, and each step from its server
  `state.time.start` (new `ToolCall.started`; a step still being written uses its reply's
  `time.created`). Local timers removed. Tests: unit (start time projected),
  `test:progress` (real running step has a start time), `test:webview` (after switching
  away and back, a 90 s run reads "1m 3xs" and a 65 s step "running · 1m 0xs").
  While fixing the test fixtures, a bulk edit wrongly added `started` to a permission
  fixture; the new "Sidecode was updated" notice correctly flagged the invalid state.
- File step names (user report: edit/write steps don't show the file): OpenCode's title
  is the full path without its leading slash, cut off before the file name in a narrow
  view. File steps (read/edit/write/patch/multiedit) are now titled by the
  project-relative `input.filePath` (outside the project: file name only), rendered
  file name first with the folder muted and truncated (the name wraps, never hides);
  the working line says "Running edit · routes.js". Steps the model is still writing
  say "file not known yet" (1.19.4 sends no arguments until complete). Tests: unit
  (relative titles), `test:webview` (name visible at 200 px with a deep path, wording,
  working line), real-server suites and native 9/9.

- Remote server folder (user report: every prompt errors from a second machine over
  Tailscale): the Mac client sent `/Users/…/Projects/git`; the Linux server's log shows
  `ENOENT … realPath` for every prompt, while Connect succeeded (listing sessions does
  not touch the folder). Discovery (`scripts/discover-missing-dir.ts`): `file.list`
  answers 500 for a folder missing on the server, 200 when present. The sessions stage
  now lists the folder once; a server error becomes `folderMissing` (not retried) with a
  clear message. README: "A server on another machine" (Remote-SSH, or run OpenCode
  where the files are and point its provider at the GPU machine). Tests: unit (request
  sequence, 500 → folderMissing), `test:folder` (real server: missing fails without
  retries, existing connects), `test:server`, `test:conversations`, native 9/9.

## Port to OpenCode 2 (user request, 2026-11-13)

Trigger: OpenCode 2.3.0 installed on the Mac; Sidecode (1.19.4 API) could not connect.
2.x is a new API (see docs/discovery.md), so the server layer was rewritten; the UI,
protocol and host are unchanged apart from wording. The last 1.x build is the `v1`
branch (pushed, commit 4bb4a0c).

- [x] Discovery against isolated 2.3.0 (`scripts/discover-v2*.ts`); the 2.3.0 client
  wrapper mishandles 204 answers, so `src/adapter/api.ts` is a small own client.
- [x] Transport: `/api/info` (major 2; 1.x → `oldServer` message), `/api/location`
  (`folderMissing`), session list, `/api/event` with heartbeats and project filtering.
- [x] Conversations: 2.x history items, run outcomes, failed runs without a reply,
  inbox-aware busy state, agent/model switching on the session, retry from the reply,
  compaction items, prompt files, `metadata.files` changes, saved "always" wording.
- [x] Chat: `session.text/reasoning.*` overlay, `session.execution.failed`, live shell
  output, explicit choice when the session's agent/model is no longer listed.
- [x] Tests: fixture runs pinned `@opencode/cli` 2.3.0 with its own home and data and
  never reaches the developer's LM Studio; fake model uses 2.x tool names and fills the
  compaction template. All unit (65), real-server (10 suites), native, webview,
  editor, lifecycle, placement and coexistence suites pass on Linux (VSCodium).
- Not supported/claimed: custom agents (2.3.0 does not list them), early file names
  for steps being written (2.3.0 sends no argument deltas), macOS (user to verify).
