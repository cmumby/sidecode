# Discovery — OpenCode 2.3.0 (2026-11-13)

Sidecode targets the OpenCode 2 HTTP API. Everything below was observed against an
isolated OpenCode 2.3.0 server (`@opencode/cli` 2.3.0, its own home, config and data
folders) with the local fake model in `scripts/fixtures/model.ts`. The scripts that
produced it are `scripts/discover-v2*.ts`. The OpenCode 1.19.4 record is in
`docs/discovery-v1.md` and applies to the `v1` branch only.

## Why a port, not an update

OpenCode 2 is a new API, not a revision of 1.x: new routes under `/api`, an
event-sourced history, new event names, a new client package (`@opencode/client`,
"private generation target"), and an `opencode upgrade --major` that removes 1.x.
Its data (`~/.local/share/opencode/opencode.db`) is not readable by 1.x: after 2.x has
run, 1.x fails with "Database is not empty and has no session table" / "Failed query"
until the data is removed (`opencode uninstall --keep-config`).

The 2.3.0 client's convenience wrapper (`OpenCode.make`) throws "Cannot read
properties of undefined (reading 'slice')" on endpoints that answer 204 (rename,
archive, switch agent/model) although the server applied the change. Sidecode uses
its own small HTTP client (`src/adapter/api.ts`) with paths from the generated client.

## Connection

- `GET /api/info` → `{ version: "2.3.0", pid, urls, paths, capabilities }`. The 1.x
  route `/global/health` answers with the web app (HTML). A 1.x server answers
  `/api/info` with its web app and `/global/health` with JSON `{ healthy, version }`.
- Basic auth with `OPENCODE_SERVER_PASSWORD`; the username is always `opencode`
  (`OPENCODE_SERVER_USERNAME` no longer exists). Without credentials: 401
  `{ _tag: "UnauthorizedError" }`.
- `GET /api/location?location[directory]=…` → `{ directory, project: { id, … } }`;
  a folder the server machine does not have → 404 `{ _tag: "LocationNotFoundError" }`.
- `GET /api/event` (SSE, all projects): `data: { id, type, created, location?, data,
  durable? }`; keepalive is a `: heartbeat` comment. The first event is
  `server.connected`.
- Errors are JSON `{ _tag, message, … }`; messages can contain paths.

## Sessions and history

- `GET /api/session?directory=…&limit=` → `{ data: SessionInfo[], cursor }`. A session
  has `location.directory`, optional `title`, `agent`, `model { id, providerID }`,
  `permissions` (rules), `time.archived`, `parentID` for subagent runs.
- `POST /api/session { location, permissions? }` → `{ data: SessionInfo }`.
- `PATCH /api/session/:id { title?, permissions?, archived? }` → 204. `permissions`
  replaces the session's whole rule list.
- `POST /api/session/:id/prompt { id?, text, files? }` → `{ data: inbox item }`. Our
  `msg_…` IDs are accepted. The prompt waits in `GET /api/session/:id/inbox` until the
  run starts.
- `GET /api/session/active` → `{ data: { [sessionID]: { type: "running" } } }`.
- `GET /api/session/:id/message?order=desc&limit=` → `{ data, cursor }` with items:
  `user { text, files? }`, `assistant { agent, model, content[], time { created,
  firstToken, streamed, completed }, finish, tokens, error?, retry? }`, `compaction
  { status: running|completed|failed, summary }`, `idle { outcome:
  succeeded|failed|interrupted, error? }`, and bookkeeping (`agent-switched`,
  `model-switched`, …).
- Text and reasoning are recorded when the part ends; live text arrives as
  `session.text.delta` / `session.reasoning.delta` keyed by `assistantMessageID` and
  `ordinal` (per kind), after `…started`, closed by `…ended { text }`.
- Run lifecycle: `session.execution.started` / `succeeded` / `failed { error }` /
  `interrupted`. `POST /api/session/:id/interrupt` → `{ interrupted }`; the reply gets
  `error.type: "aborted"` and an `idle` item with outcome `interrupted`.
- A session that never switched has no `agent`/`model`; each reply records them.
  `POST /api/session/:id/agent { agent }` and `/model { model }` (204) accept unknown
  names; the next run fails (`idle` failed, "Agent not found" / "Model unavailable").
  With an unknown agent the prompt is not recorded and stays in the inbox; it is
  delivered with the next prompt.
- Agent list (`GET /api/agent`): built-ins only (`build`, `plan` primary; `general`,
  `explore` subagents; hidden `title`, `summary`, `compaction`). Custom agents in
  configuration (inline, config file or agent files) were not listed.
- Model list (`GET /api/model`): `{ data: ModelInfo[] }` with `settings` (API keys,
  base URLs), `limit.context`, `enabled`, `status`, `type`. OpenCode 2 queries LM Studio
  on 127.0.0.1:1234 by itself and lists its loaded models (with their loaded context);
  the test server points that provider at a closed port.
- Config (`GET /api/config`): entries; documents carry `permissions` rules. 1.x-style
  config (`provider`, `permission: { edit: "ask" }`, `agent`) is migrated on read.

## Tools, permissions and changes

- Tool names: `shell` (was `bash`), `read`, `edit`, `write`, `glob`, `grep`, `question`,
  `skill`, `subagent`, `webfetch`, `websearch`, `execute`. File tools take `path`
  (was `filePath`); a `bash` call still runs, with a note to call `shell`.
- Tool state: `streaming { input: string }`, `running { input, metadata }`,
  `completed { input, content[], metadata }`, `error { input, error, content? }`;
  `time { created, ran, completed }`. For this provider 2.3.0 sends no argument
  deltas: only `session.tool.input.started` / `ended`.
- A running command's output is not in the step; `session.tool.progress { metadata:
  { shellID } }` names its shell, read with `GET /api/shell/:id/output?cursor=`.
- `GET /api/session/:id/permission` → `{ data: [{ id, action, resources, save?,
  metadata, source }] }`; edits carry `metadata.files [{ file, patch, status }]`
  (project-relative jsdiff patch). `POST …/permission/:rid/reply { decision:
  once|always|reject }` → 204; a second answer is refused. Deny: "The user declined
  this tool call".
- "Always" saves a rule for the project (`GET /api/permission/saved?projectID=`); it
  applies to every session and survives a server restart.
- Session rules (`{ action: "edit", resource: "*", effect }`) override the
  configuration, so Sidecode never adds `allow` over a configuration that asks.
- Completed `edit` has `metadata.files`; `write` without approval records no patch.
- An empty tool-call response ends the run with one empty reply (1.19.4 looped).
- Provider failures: the reply records `retry { attempt, at, error.message }` while
  OpenCode retries; `session.retry.scheduled` is emitted.

## Compaction and attachments

- `POST /api/session/:id/compact {}` queues a compaction that runs like a reply; the
  model must fill a fixed summary template, otherwise it fails ("did not match the
  required template").
- Prompt `files [{ uri, name, source? }]`: `file://` files and folders (the server reads
  them on its machine) and inline `data:` text all reach the model; history keeps
  `{ data (base64), mime, source, name }`.
