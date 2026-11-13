# OpenCode adapter boundary

`transport.ts` uses only `@opencode-ai/sdk/v2/client`, pinned to 1.19.4. The host
supplies a normalized base URL, explicit project directory and optional credentials.
Custom fetch checks statuses and JSON/SSE content types and disallows redirects.
Only the outer event envelope is consumed in Phase 2; session data and all event
payloads stay private to the adapter. Future operations must validate consumed fields.

`connection.ts` owns health/session/subscription stages, first-event and idle
watchdogs, bounded backoff, cancellation and stale-attempt suppression. SDK internal
retries are limited to one attempt, so there is only one retry owner. A new Connect
cancels its predecessor; explicit Disconnect also cancels delayed retries.

No SDK errors, URLs, paths, credentials or server payloads cross the UI protocol.
`conversations.ts` wraps session list/create/messages/status/promptAsync/abort and
projects only IDs, titles, text parts and statuses; sessions from another directory
and parts from another session are rejected. `promptAsync` acknowledges with an
empty 204, which the transport accepts only for that route. The SDK `path` list
parameter is not a directory filter; the `directory` instance header is used.

`chat.ts` treats SSE events as invalidation signals, coalesces them, and replaces
state from history snapshots, so missed/repeated events and reconnects cannot
duplicate text. OpenCode 1.19.4 persists a text part only when it finishes, so live
text comes from `message.part.delta`: an overlay starts only from a
`message.part.updated` full-text event seen while connected, appends ordered deltas,
and is dropped on disconnect, session change or once the message finishes. Part IDs
are host-only and stripped before the bridge. Stale reads after session switches or disconnects are
discarded. Mutations are never retried automatically.

Tool parts project only tool name, status, title (or compact input JSON while
running) and clipped output/error text. Permissions project only id, permission,
patterns and `always` patterns, and only while the session is busy: 1.19.4 leaves
a request listed after Stop, and no Allow button may be shown for it. `Chat.reply`
runs only for an explicit command naming a request currently shown for the selected
session; it is never retried. A failed reply keeps `replyUncertain` only while the
request is still pending.

`options` lists selectable agents (`primary`/`all`, not hidden) and non-deprecated
models of configured providers; provider options (which can hold keys) are never
read into the projection. `Chat.send` passes `agent`/`model` only when they are in
the latest lists, because 1.19.4 accepts unknown names and fails only through
`session.error`. That event becomes a fixed `sessionError`; its text is never shown.

Context parts (`ContextPart`) are built by the extension host from explicit user
actions and passed to `send`; they never cross the bridge. The host checks real paths
against the project folder (`src/extension/context.ts`) because 1.19.4 reads any
`file://` path. History projects file parts to `{ kind, label }` from `filename` and
MIME only; URLs and the synthetic injected contents are dropped.

File changes come from tool/permission metadata (`toolChange`, `permissionChange`):
the bridge gets `{ label, additions, deletions, diff }`; the server path and patch
stay in `ProjectedMessage.changes` / snapshot `reviews` and are reachable only via
`Chat.changeSource` / `Chat.reviewSource` for the selected session. `patch.ts` is a
strict unified-diff applier used only for read-only previews.

No event causes tool execution, permission approval, a session mutation or an IDE
command.
