# OpenCode adapter boundary

Sidecode targets the OpenCode 2 HTTP API, verified against 2.3.0 (see
`docs/discovery.md`). OpenCode 1.x is supported only on the `v1` branch.

`api.ts` is a small HTTP client for the endpoints Sidecode uses; paths and shapes come
from the official `@opencode/client` 2.3.0 definitions (a dev dependency, used only for
reference and discovery scripts). The host supplies a normalized base URL, the project
folder and optional credentials (OpenCode 2's username is always `opencode`). Every
request disallows redirects; 401/403, 5xx/429 and non-JSON (or non-SSE) answers become
fixed connection errors. A declared 4xx answer keeps only its `_tag`; the server's
message is dropped because it can contain paths.

`transport.ts` checks `/api/info` (major version 2; a 1.x server, recognized by its
`/global/health`, gets `oldServer`), then `/api/location` for the project folder (a
folder the server machine lacks is `LocationNotFoundError` → `folderMissing`) and the
session list, then reads `/api/event`. The stream carries every project on the server;
events for another folder are dropped, keepalive comments become a synthetic
`server.heartbeat` for the idle watchdog, and `{ type, data }` becomes the internal
`{ type, properties }`.

`connection.ts` owns the health/sessions/events stages, first-event and idle
watchdogs, bounded backoff, cancellation and stale-attempt suppression. There is one
retry owner. A new Connect cancels its predecessor; Disconnect cancels delayed retries.

`conversations.ts` projects OpenCode 2 history items: `user` (text and attachment
labels), `assistant` (`content`: text, reasoning, tools), `compaction` (a divider and a
summary) and `idle` (how a run ended). An unfinished reply is streaming while the
session is active, otherwise stopped or failed by the following `idle` outcome; a run
that failed before any reply (2.3.0 records no prompt for an unknown agent) becomes a
failed reply. A session is busy while it is active or a prompt waits in its inbox.
Agent and model live on the session in 2.x: `send` switches them only when the choice
differs, then posts the prompt. Model listings carry provider settings (keys, URLs);
only ID, name, provider ID and context size are read.

`chat.ts` treats SSE events as invalidation signals, coalesces them, and replaces
state from history snapshots, so missed or repeated events and reconnects cannot
duplicate text. Text and reasoning are recorded only when a part ends, so live text
comes from `session.text.delta` / `session.reasoning.delta`: an overlay keyed by
message, kind and ordinal starts only from a `started` event seen while connected and
is dropped on disconnect, session change or once the message finishes. A running
command's output lives in its shell (`session.tool.progress` names it); the chat reads
new output from `/api/shell/:id/output` every half second while the step runs. Keys
and shell IDs are host-only. Mutations are never retried automatically.

Tool calls project only name, status, a title (the main argument; file tools get the
project-relative path) and clipped output or error text. Permissions project only id,
action, resources and `save` patterns, and only while the session is running. "Always"
in 2.x saves a rule for the project that survives restarts; the UI says so.
`Chat.reply` runs only for an explicit command naming a request shown for the selected
session; it is never retried.

Context parts are built by the extension host from explicit user actions and sent as
prompt `files` (`file://` URIs, or inline `data:` for a selection). The host checks
real paths against the project folder because OpenCode reads any `file://` path.
History shows only each file's name and kind; contents (base64 `data`) are dropped.

File changes come from tool and permission metadata (`files: [{ file, patch }]`,
project-relative): the bridge gets `{ label, additions, deletions, diff }`; the
resolved path and patch stay host-side and are reachable only through
`Chat.changeSource` / `Chat.reviewSource` for the selected session. `patch.ts` is a
strict unified-diff applier used only for read-only previews.

No event causes tool execution, permission approval, a session mutation or an IDE
command.
