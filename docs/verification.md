# Verification through Phase 2

Automated tests cover the exact bridge schema, unknown/malformed messages,
HTML escaping/CSP, resource restrictions, activation without privileged APIs,
listener disposal, manifest contributions and isolated editor lifecycle.

Acceptance matrix (native automation now covers rendering and docking):

- [x] VSCodium: open view with folder and empty window; visible React content (native automation).
- [x] VS Code: open view with folder and empty window; visible React content (native automation).
- [x] Move view to Secondary Side Bar through native controls in disposable profiles (both editors).
- [x] Restore/reload view placement and test disable/re-enable (`test:lifecycle`, `test:placement`; both editors).
- [x] Existing unrelated views/editor groups retain placement after activation (`test:editor`, `test:coexistence`).
- [x] Readable at 200/240/320 px widths with no horizontal overflow (browser fixtures).
- [x] Light, dark, high contrast dark/light themes; visible labels and boundaries (`test:webview`, 4 themes).
- [x] Keyboard navigation, screen reader labels, zoom, reduced motion (`test:webview`, `test:lifecycle`; a manual screen-reader pass is tracked below).
- [x] Disable/re-enable, hide/show and reload restore the shell cleanly (`test:lifecycle`, both editors).
- [x] Install/uninstall leaves Codex/Claude, settings and layout unchanged (`test:editor`, `test:coexistence`, both editors).

Use disposable profiles for every editor test. Never test layout moves or theme
changes in the user's live profile. Automated group/configuration checks do not
prove visual docking, assistive technology behavior or third-party coexistence.

## Automated results — 2026-11-12

Passed on VSCodium 1.143.17232 and VS Code 1.145.2: packaged extension
activation and view focus, folder/empty window, unchanged configuration and tab
groups, isolated installation/uninstallation/reinstallation. These checks do not
inspect native webview pixels.

Passed in installed headless Chrome: 12 combinations of 200/240/320 px widths
and simulated light/dark/high-contrast theme tokens; actual React bundle runs
under the generated CSP, mock host handshake works, placeholder controls are
disabled, no page overflow or browser errors. Dark and high contrast light
screenshots visually inspected. Native themes and manual docking remain open.

All test profiles were temporary. Host file-watcher/GPU/proposal warnings occurred
in both editors but did not fail the suites.


## Phase 2 continuation

Native tests now inspect the real rendered webview in both editors, drive Move View
through the UI into Secondary Side Bar, focus Connect, and exercise live Connect/
Disconnect. Temporary profiles only. Native dark-theme screenshots inspected;
full native theme matrix and assistive technology checks remain outstanding.

The 17 unit tests now include connection lifecycle, SDK response validation,
SecretStorage endpoint separation, cancellation and trust gating. OS keyring
persistence is not established by mocks and remains a release check.

`test:server` uses a real isolated OpenCode 1.19.4 process with generated Basic auth
credentials, private temporary config/data paths and no plugins. Missing credentials
fail without retries; correct credentials connect and survive a test-server restart.
The user's server is never stopped or modified. Live SDK scope is still limited to
health, listing, connection/heartbeat events and recovery—not conversations.

Final Phase 2 VSIX was rebuilt and installed/uninstalled/reinstalled successfully
in both editors. Empty/folder activation preserves configuration and tab groups.
The expanded browser matrix also checks action dispatch, connected/error states
and narrow expanded connection options.

## Phase 3 conversations

- `npm run check`: 24 unit tests, including 7 chat tests (projection/redaction,
  stale switches, event-burst coalescing, no automatic resend, busy gating, late
  results after disconnect, protocol validation).
- `npm run test:conversations` passes against isolated OpenCode 1.19.4: directory
  scope, create/select, streamed snapshots, CLI ↔ IDE continuity, reconnect without
  duplicates, Stop and session switching.
- `npm run test:webview`: 12 theme/width fixtures now include a populated
  conversation with untrusted Markdown (no links/images/HTML/script executed), long
  unbroken lines without page overflow, busy/permission notice, Stop and Send gating.
- VSIX repackaged; VSCodium clean-profile install/activation/uninstall/reinstall passes.
- [x] Native editor end-to-end chat through the real webview (`test:native:chat`,
  isolated server + model fixture): passes in VSCodium 1.143.17232 and VS Code 1.145.2.
- [x] Code-block copy button exercised in both native webviews.
- [x] `test:editor` with the Phase 3 bundle passes in both editors. One VS Code run
  failed an assertion in the folder-window case and three reruns passed; the cause
  was not captured. Treat as intermittent until reproduced.
- [x] Extensions view name is **Sidecode** (VSIX manifest and installed package).

## Phase 4 — tool calls and permissions

- [x] 29 unit tests: tool/permission projection and redaction, explicit-only replies,
  no automatic retry, `replyUncertain` lifecycle, protocol validation.
- [x] `npm run test:permissions` (isolated 1.19.4): held until answered, Allow once,
  Deny, Stop while waiting (no tool run, orphan hidden), Always scope, duplicate refused.
- [x] `npm run test:webview`: tool rows with hostile output stay text, permission card
  fits 200–320 px in all four themes, focus never moved into the card, reply dispatch.
- [x] `npm run test:native:chat` permission flow passes in VSCodium 1.143.17232 and
  VS Code 1.145.2. VSCodium `test:editor` passes with the Phase 4 bundle.
- [ ] (Manual, open) Screen-reader announcement of new permission cards (only a visually hidden
  alert is provided; needs assistive-technology check in Phase 5).

## Phase 4 — agent and model selectors

- [x] 35 unit tests: agent/model projection (hidden/subagent/deprecated excluded,
  provider options never forwarded, 500 cap), last-used selection, local refusal of
  unlisted values, failed list loads keep previous lists, `session.error` handling.
- [x] `npm run test:selectors` (isolated 1.19.4, two models, custom primary agent and
  subagent): offered lists, default send, explicit agent/model reach the model,
  `used` reported back, subagent refused locally, stale name → fixed error → recovery.
- [x] `npm run test:webview`: selects start from the session's last choice, models
  grouped by provider, untrusted names stay text, send carries the choice, no
  overflow at 200–320 px in all four themes.
- [x] `npm run test:native:chat` selector step passes in VSCodium 1.143.17232 and
  VS Code 1.145.2; earlier conversation and permission suites still pass.

## Phase 4 — explicit context

- [x] 40 unit tests: attachment projection without URLs/contents, protocol validation
  of context commands/items, per-session pending context (dedupe, cap, removal, kept
  after an uncertain send, cleared after a confirmed one), real-filesystem path
  boundary (symlink escape, sibling prefix, `..`, project root, missing file).
- [x] `npm run test:context` (isolated 1.19.4): file, folder and unsaved selection
  reach the model; history shows labels only; no paths/contents in chat state;
  context not repeated on the next message.
- [x] `npm run test:webview`: chips, unsaved note, Add/Remove dispatch, hostile labels
  stay text, no overflow at 200–320 px in all four themes.
- [x] `npm run test:native:chat` context step (real editor: Current file of a dirty
  file, keyboard selection of unsaved text, workspace quick pick) passes in VSCodium
  1.143.17232 and VS Code 1.145.2. VSCodium `test:editor` passes; VSIX rebuilt.

## Phase 4 — native file and diff views

- [x] 45 unit tests: strict patch apply/reverse (CRLF, no-newline, multi-hunk,
  mismatch refusal), edit/write/permission change projection without paths or
  patches, host-only change sources per selected session, ID-only commands, path
  boundary for new files and symlinked folders.
- [x] `npm run test:changes` (isolated 1.19.4, non-git, `edit: ask`): reviewable
  proposal built from disk, nothing written while pending, before view reconstructs
  the original, new-file proposal, Deny leaves no file and no change row.
- [x] `npm run test:webview`: change summaries, Review/Open/Show changes dispatch IDs
  only, hostile labels stay text, focus never auto-moves into permission cards.
- [x] `npm run test:native:chat` edit review in the real diff editor (before approval
  and after) passes in VSCodium 1.143.17232 and VS Code 1.145.2; VSCodium
  `test:editor` passes; VSIX rebuilt.

## Direction B webview

- [x] 46 unit tests; `npm run test:webview` covers step states (waiting, unknown
  while reconnecting, failed, folded summary), the ⋯ and + menus closing after a
  choice, Stop replacing Send, hostile text staying plain, no overflow at 200–320 px
  in four themes. Real-server suites unchanged and passing.
- [x] `npm run test:native:chat` (all 8 steps) passes in VSCodium 1.143.17232 and
  VS Code 1.145.2 with the new layout; VSCodium `test:editor` passes; VSIX rebuilt.
- [x] Keyboard-only walkthrough (automated in `test:webview`, Phase 5). Screen-reader check: see the manual item below.

## Phase 5 — release verification

Support matrix (all automated, Linux x64): OpenCode 1.19.4; VSCodium 1.143.17232;
VS Code 1.145.2; minimum editor 1.106 (secondary side bar contribution).

- [x] `npm run check` (unit tests, typecheck, lint, build).
- [x] `test:webview`: 16 theme/width cases incl. keyboard order, focus rings, Escape,
  reduced motion, high-contrast borders, run-end announcement.
- [x] `test:native` and `test:native:chat` in VSCodium and VS Code.
- [x] `test:editor` (clean-profile lifecycle) in VSCodium and VS Code.
- [x] `test:coexistence` with the installed Codex and Claude Code in VSCodium and VS Code.
- [x] `test:placement`; real-server suites (`conversations`, `permissions`,
  `selectors`, `context`, `changes`, `progress`).
- [ ] Manual screen-reader pass with Orca (not automated).
- [ ] macOS / Windows (not tested; documented as such).

Release run note: in one full batch run, `test:native:chat` in VS Code passed only its
first step; the batch recorded PASS counts only, so the failure was not captured.
Four further VS Code runs (alone and directly after the VSCodium run) passed 8/8.
Treated as an intermittent, unexplained test failure; capture full logs next time.
