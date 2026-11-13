> **Historical — OpenCode 1.19.4.** This record applies to the `v1` branch. Sidecode now
> targets OpenCode 2; see `docs/discovery.md`. The scripts named below are on the `v1` branch.

# Discovery — 2026-11-12

The initial findings below are historical; see **Phase 2 findings** at the end for
verified authentication/reconnect support and the current SDK runtime boundary.

## Decisions and concerns

The specification mandates a dedicated Activity Bar view; this resolves the
roadmap's open question about the default container. Moving it remains a user
action. Provisional identifier: `sidecode-local.sidecode`, view `sidecode.chat`.
Do not publish this provisional identity. No Git repository existed in this folder.

Keep the host, adapter, protocol and React UI separate. Use esbuild for two bundles,
TypeScript, React, ESLint, Node tests and vsce. No UI framework, router, state
library, runtime validation dependency or agent runtime is needed for the shell.
Use exact dependencies and the lockfile. SDK 1.19.4 is a development-only
discovery dependency, matching the installed server, not a declared compatibility range.

The roadmap asks for discovery before implementation and integration coverage
before feature completion. Read-only discovery is verified below; authenticated
server behavior and conversation semantics remain outstanding. Phase 1 has no
connection feature and can be tested independently. Final visual language is
explicitly deferred until the planned concept exploration. Manual layout and
accessibility checks must not be inferred from a passing build.

## Sources inspected

- Official [SDK documentation](https://opencode.ai/docs/sdk/), currently redirecting
  to V1 documentation: client-only `createOpencodeClient`; `createOpencode` starts
  a server and must not be used by this extension.
- Official [server documentation](https://opencode.ai/docs/server/): `/doc` OpenAPI,
  health, session and SSE routes. Basic auth uses `OPENCODE_SERVER_PASSWORD` and
  optional `OPENCODE_SERVER_USERNAME` (default `opencode`). Provider auth endpoints
  are not server login endpoints.
- [Versioned SDK client source](https://github.com/anomalyco/opencode/blob/v1.19.4/packages/sdk/js/src/v2/client.ts)
  and installed `@opencode-ai/sdk@1.19.4` generated types/SSE implementation.
- Live server `/doc`: lists legacy `/session`, `/event`, `/global/health`,
  `/permission/{requestID}/reply` alongside newer `/api/*` routes. Its schema
  `info.version` is `1.0.0`, which is NOT the running server version.
- [VS Code webviews](https://code.visualstudio.com/api/extension-guides/webview)
  and [packaging](https://code.visualstudio.com/api/working-with-extensions/publishing-extension):
  stable WebviewViewProvider, message passing, theme variables, CSP, local VSIX.
  Minimum API target 1.90 is a build target; tested editor versions are recorded separately.
  (Raised to 1.106: the view is a tab in the secondary side bar via
  `viewsContainers.secondarySidebar`, the mechanism the installed Codex and Claude Code
  extensions use; both treat 1.106 as the first editor version that supports it.)

## Live read-only findings

Local binary and `/global/health` both report **1.19.4**. The network sandbox
initially prevented connecting; the same probes succeeded with network access.
No server was started, stopped or reconfigured.

| Request | Observed response |
| --- | --- |
| `/` | 200, `text/html` |
| `/global/health` | 200, JSON, healthy and version 1.19.4 |
| `/doc` | 200, JSON OpenAPI |
| `/session?directory=<project>` | 200, JSON array; zero sessions for this directory |
| `/event?directory=<project>` | 200, `text/event-stream`, `server.connected` |
| `/global/event` | 200, `text/event-stream`, wrapped `server.connected` |

These endpoints required no credentials on this server. Basic auth protection
has NOT been tested against an authenticated instance. No prompts, permissions,
sessions or existing server configuration were modified.

`@opencode-ai/sdk/v2/client` exposes flat arguments. `session.list({ directory })`
and `event.subscribe({ directory })` correspond to the observed legacy routes.
The SDK passes directory context via query/header handling; `session.list` also
exposes `scope: 'project'` and `path`. Do not assume a global session list or infer
CLI continuity from an empty array. Phase 3 must test a real CLI-created session
using matching server, directory and session ID, including project/worktree scope.

SSE supports AbortSignal, custom fetch and bounded retry options. The probe adds
status/content-type validation to custom fetch because SDK HTML checks alone do
not cover every invalid response. Global and directory event envelopes differ.
Phase 2 must distinguish health, session initialization and event subscription,
validate events, own cancellation/reconnection, and bound retries explicitly.
No streaming, permission, reconnect or cross-version support is claimed yet.

## Tooling verification

The SDK probe passes using the pinned package and requires ESM imports. The host
remains bundled CommonJS. Unit tests, lint and packaging pass with the
`minimatch@11.0.1` development override; npm reports zero vulnerabilities. This
override resolves the glob-matching advisory in lint/packaging dependencies and
should be reviewed when upstream packages update. No overridden package ships
in the extension bundle. `playwright-core` uses installed Chrome for layout
fixtures; `@vscode/test-electron` uses installed editors with temporary profiles.

## Phase 2 findings

The pinned SDK SSE generator reports failures through `onSseError` and ends its
iterator; EOF is also a normal end. The adapter must turn both into connection
state changes and own retries itself (`sseMaxRetryAttempts: 1`). It must not rely
on an iterator throwing or on the SDK's default retry loop. Verified with both
unit fixtures and a real authenticated 1.19.4 server stop/restart.

Test isolation flags were checked against upstream 1.19.4
[flags](https://github.com/anomalyco/opencode/blob/v1.19.4/packages/core/src/flag/flag.ts),
[global paths](https://github.com/anomalyco/opencode/blob/v1.19.4/packages/core/src/global.ts)
and [config paths](https://github.com/anomalyco/opencode/blob/v1.19.4/packages/opencode/src/config/paths.ts).
`OPENCODE_TEST_HOME` is test-only; HOME is not changed. Runtime never spawns a server.

Basic auth, initial session listing, SSE/heartbeat and reconnect now pass against
an isolated real server. Native Connect/Disconnect also passes against the existing
server in both editors. CLI continuity, session/message mutations and permission
response semantics remain untested and unimplemented.

## Phase 3 findings

Verified against isolated OpenCode 1.19.4 with a local model fixture
(`npm run test:conversations`):

- Sessions are scoped by the `directory` instance parameter. A session created for
  another directory is not listed. The `path` list parameter is not a directory filter.
- `opencode run --attach <url> --dir <project>` creates sessions visible to the IDE
  in the same directory; `--session <id>` continues an IDE-created session. History
  from both clients is identical on refresh.
- `session.promptAsync` returns 204 with no content type; completion is observed via
  `session.status`, message `time.completed` and SSE invalidation.
- `session.abort` returns `true`; the aborted assistant message carries
  `MessageAbortedError`, shown as status `stopped`.
- Snapshot refresh after a dropped event stream reconciles by message ID with no
  duplicates.

Correction found during native verification: a text part's stored history stays
empty until that part finishes; while streaming, text exists only in
`message.part.delta` events (`sessionID`, `messageID`, `partID`, `field`, `delta`),
preceded by a `message.part.updated` with the part's full text so far. Snapshot-only
rendering therefore showed nothing until completion. The adapter now applies an
ordered delta overlay (see `src/adapter/README.md`). Deltas do not trigger refreshes.

## Phase 4 findings — tools and permissions (isolated 1.19.4)

- Tool parts: `tool`, `callID`, `state.status` pending → running → completed/error;
  completed has `title`, `output`, `metadata`; error has `error`. Running may lack a title.
- With `permission.bash = "ask"`, `permission.asked` carries `id`, `sessionID`,
  `permission`, `patterns`, `metadata` (e.g. `command`), `always` (e.g. `echo *`) and
  `tool.{messageID,callID}`. Session status stays `busy` while waiting.
- `permission.reply({ requestID, reply: once|always|reject, message? })` returns
  `true` and emits `permission.replied`. A second reply to the same request fails
  (PermissionNotFound → 404), so double answers cannot double-approve.
- Reject marks the tool `error` with "The user rejected permission…" (+ message).
- `always` applies to later sessions on the same server, is lost on server restart
  and writes no config file (`scripts/discover-always.ts`).
- Abort leaves the request in `permission.list` while the session is idle and the
  tool is already "Tool execution aborted"; replying then is harmless
  (`scripts/discover-abort-permission.ts`). The client hides such orphans.

## Phase 4 findings — edits and diffs (isolated 1.19.4, `scripts/discover-diffs.ts`)

- With `permission.edit = "ask"`, both `edit` and `write` ask `permission: "edit"` with
  `metadata.filepath` (absolute) and `metadata.diff` (jsdiff unified patch with
  absolute-path headers); `patterns` is the path without its leading slash and
  `always` is `["*"]`.
- Completed `edit`: `metadata.filediff { file, patch, additions, deletions }` and
  `metadata.diff`. Completed `write`: `metadata.filepath`, `exists`, no patch.
  `state.title` is the server-relative path. Input `filePath` may be relative.
- `session.diff` (with or without `messageID`) and `session.summary` are empty in a
  non-git project. In a git repository `session.diff({ messageID })` returns
  `{ file (relative), patch, additions, deletions, status }` per user message, and
  `vcs.diff` returns the working-tree diff. Events: `session.diff`, `file.edited`,
  `file.watcher.updated`.

## Progress signals while a run is busy (isolated 1.19.4, `scripts/discover-progress.ts`)

- Reasoning (`reasoning_content` from an OpenAI-compatible provider such as LM
  Studio) becomes a `reasoning` part: `message.part.updated` with empty text, then
  `message.part.delta` (`field: "text"`) by part ID, then the full text; stored in
  history.
- A running `bash` tool updates `state.metadata.output` live through
  `message.part.updated` (output so far; `exit` added on completion).
- A failing provider (HTTP 500) puts the session in `status: { type: "retry",
  attempt, message, next }` (next = epoch ms) and retries with growing delays
  (attempt 3 ≈ 9 s) until aborted; no assistant text is produced meanwhile.
- While a model streams a tool call's arguments (for example a large `write`), the
  tool part stays `pending` with `input: {}` and `raw: ""`; no argument deltas are
  sent. Everything arrives at once when the arguments are complete (`running` with
  full input). So nothing about a pending step (file, size) can be shown early.
- Empty-response loop (seen on the user's server with an LM Studio model: 2,260
  messages, nearly all `step-start, step-finish(tool-calls)` with no text or tool):
  when a model ends with `finish_reason: "tool_calls"` but sends no tool call,
  OpenCode creates an empty assistant step and asks again, indefinitely, while the
  session stays `busy`. Reproduced with the fixture (`EMPTY_LOOP`).

## Per-session permission rules (isolated 1.19.4, `scripts/discover-session-permission.ts`)

- `session.create` and `session.update` accept `permission: [{ permission, pattern,
  action }]`; `session.get` and `session.list` return it. `update` **appends** rules
  (it never replaces), and the newest matching rule wins.
- With no configured permission, a session rule `edit / * / ask` makes both `edit` and
  `write` ask; `allow` lets them apply.
- A session rule **overrides the configuration**: with `permission.edit = "ask"` in
  config, a session `edit / * / allow` let edits apply without asking. Sidecode
  therefore never adds `allow` when the configuration asks, denies or has
  per-pattern edit rules.
- An `edit` step can be reported `completed` a moment before the file write is
  visible on disk (tests poll briefly).

## Usage and compaction (isolated 1.19.4, `scripts/discover-usage.ts`)

- Assistant messages carry `time.created/completed` (epoch ms), `tokens { input,
  output, reasoning, cache { read, write } }`, `cost`, `providerID`, `modelID`,
  `finish`; user messages carry `time.created`, `agent`, `model`.
- `config.providers` models report `limit { context, output }`.
- `session.summarize({ sessionID, providerID?, modelID? })` runs the model and
  returns `true` when done; history gains a user message with a `compaction` part
  and an assistant message with `summary: true`, `mode: "compaction"` holding the
  summary text.

## Phase 4 findings — file context (isolated 1.19.4, `scripts/discover-context.ts`)

- A `file` part with a `file://` URL makes the server run its Read tool on that path
  and add two `synthetic` text parts (the call and the numbered contents) before the
  file part. `?start=5&end=7` limits it to those lines. `application/x-directory`
  lists the folder's entries. The stored file part keeps our `filename`.
- The server reads paths **outside the project** too (a temp file elsewhere was read),
  so the client must restrict attachments.
- A missing file emits `session.error` ("File not found: …") while the prompt still
  runs with a "Read tool failed" note.
- A `data:text/plain;base64,…` part is injected verbatim as a synthetic text part
  (the "Read tool" call names the `filename`), so editor text can be sent unsaved.

## Phase 4 findings — agents and models (isolated 1.19.4, `scripts/discover-selectors.ts`)

- `app.agents` returns every agent: `name`, `description`, `mode`
  (`primary`/`subagent`/`all`), `native`, `permission`, `options`, optional `hidden`
  and `model`. Built-ins: build, plan (primary), explore, general (subagent), and
  hidden primary title, summary, compaction. Custom agents report `hidden: null`.
- `config.providers` returns `{ providers, default }`. Each provider has `id`, `name`,
  `source`, `env`, `options` (may include keys, so never forwarded) and `models`
  keyed by ID with `name`, `status`, `cost`, `limit`, `variants`, … The built-in
  `opencode` provider (free models) is listed even on a `--pure` isolated server.
  `default` maps each provider to *its* preferred model and is not the configured
  `model` (it reported `second` while the config said `fixture`).
- `promptAsync` honors `agent` and `model { providerID, modelID }`; a primary
  agent's own `model` applies when none is given. User messages record `agent` and
  `model`; assistant messages record `agent`, `providerID`, `modelID`.
- Omitting fields on a later prompt in an existing session: the agent resets to the
  default agent (plan → build) while the model stays the session's last model.
- Unknown model: the prompt is stored, no reply, `session.error` with
  "Model not found: …". Unknown agent: nothing stored, `session.error` with
  "Agent not found … Available agents: …". Both follow with a stack-trace error.
  `promptAsync` itself returns 204 in both cases.
