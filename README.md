# Sidecode

Sidecode puts an [OpenCode](https://opencode.ai) chat in your editor's side bar.
It connects to an OpenCode server you already run; it never starts one, never runs
a model itself, and never approves anything on your behalf.

It opens as an **OpenCode** tab in the right-hand (secondary) side bar, next to
other chat extensions such as Codex and Claude Code.

## Support matrix

| Component | Tested | Notes |
|---|---|---|
| OpenCode server | 2.3.0 | OpenCode 2 only. Other 2.x versions are untested; the API is validated and mismatches show "Unexpected API response". A 1.x server is recognized and asked to upgrade. For OpenCode 1.x, use the `v1` branch (tested with 1.19.4). |
| VSCodium | 1.143 (Linux x64) | Full automated suite. |
| VS Code | 1.145 (Linux x64) | Full automated suite. |
| Minimum editor | 1.106 | Needed for the secondary side bar tab. |
| macOS, Windows | Not tested | Nothing platform-specific is known, but no claims are made. |
| Remote / containers | Not tested | Works only if the server sees the same file paths as the editor (see Known limitations). |

Tested alongside the Codex and Claude Code extensions: their placement, settings,
saved layout and files are unchanged by Sidecode (`npm run test:coexistence`).

## Install

```sh
codium --install-extension sidecode-0.1.0.vsix --force   # or: code --install-extension …
```

Then **reload every editor window** (**Developer: Reload Window**) or restart the
editor. This is required: until a window reloads it keeps running the previous
version in the background. Work already running on your OpenCode server is not
affected; reconnect and reopen the session afterwards.
Uninstall with `codium --uninstall-extension sidecode-local.sidecode`.

## Start an OpenCode server

```sh
opencode serve --port 4096
```

`--port` matters: without it `opencode serve` picks a random port. Sidecode needs
OpenCode 2 (`opencode --version`; upgrade a 1.x install with `opencode upgrade --major`).
The server uses your normal OpenCode configuration, including your model provider
(for example LM Studio); OpenCode 2 reads 1.x-style `provider` settings too. To require
a password, start it with `OPENCODE_SERVER_PASSWORD=… opencode serve --port 4096` and
enter the same password in Sidecode (username `opencode`).

## Connect

1. Open the **OpenCode** tab in the right-hand side bar.
2. Choose **Connect**. The first time, Sidecode asks for the server URL
   (prefilled with `http://127.0.0.1:4096`). Change it later from **⋯ → Server URL**.
3. If your server has a password, use **⋯ → Set credentials** (stored in the
   editor's secret storage, per server URL).

The open folder is the OpenCode project. With several folders open you are asked
which one; with none, you pick a folder. Untrusted (Restricted Mode) and virtual
workspaces cannot connect.

## A server on another machine

OpenCode reads, edits and runs commands **on the machine where `opencode serve`
runs**, in the folder Sidecode asks for. Sidecode sends the editor's folder path, so
that path must exist on the server's machine. A Mac editor talking to a Linux server
over Tailscale sends something like `/Users/you/Projects/app`, which the Linux machine
doesn't have; Connect then reports "The OpenCode server cannot open this folder".

Ways to set it up:
- **Edit the server machine's files remotely:** use Remote-SSH (or another remote
  extension host) to open the project on the server machine, and install Sidecode there.
  The folder path then matches. Use the server's local URL (`http://127.0.0.1:4096`).
- **Keep files on your machine, borrow the GPU:** run `opencode serve` on the machine
  with the files, and point its model provider at the other machine (for example
  LM Studio's server on the GPU machine, reached over Tailscale).

## Using it

- **Sessions.** The title is the current session; click it to switch. **+** starts
  a new one. Sessions created in the OpenCode CLI appear here too, and vice versa.
- **Send.** **Enter** sends, **Shift+Enter** adds a line. While a reply runs the
  send button becomes **Stop**, which cancels the work on the server. (Disconnect
  only stops updates in the editor.)
- **Agent and model.** The pickers under the message box list what your server
  offers. Each session keeps the agent and model it last used ("Default"); if that one
  is no longer offered, Sidecode asks you to pick another before sending.
- **Context.** **+** in the message box attaches the **current file**, the
  **selection** (exactly as shown in the editor, unsaved edits included) or
  **workspace files and folders**. Only files inside the connected project can be
  attached, and only when you choose them.
- **What's happening.** Each reply's tool calls form a step group where every step
  shows its own state: ✓ done, ✕ failed (with the reason), a spinning ring while
  running (with live command output), an empty ring while the model is still
  writing the step, and **!** when it needs you. Finished groups fold to a summary
  like "4 steps · 1 failed". A model's reasoning streams in a **Thinking** block.
  The line at the bottom says what OpenCode is doing and for how long.
- **Edits: ask / auto.** The toggle in the message toolbar decides whether OpenCode
  asks before each file edit in this session (like Claude Code's edit mode). Turned on,
  every edit and file write stops for approval, with **Review changes** for a diff.
  Your choice also becomes the default for new sessions. It is a per-session rule on
  the server, not a change to your OpenCode configuration. If your configuration
  already requires approval for edits, the toggle stays on and can't be turned off
  here; if it blocks edits, the toggle says so.
- **Approvals.** When OpenCode asks permission, a card shows the request. For file
  edits, **Review changes** opens the editor's diff view of the proposed change
  before you choose **Allow once** or **Deny**. **More options → Always allow**
  allows the shown pattern in every session of the project from then on: OpenCode 2
  saves the rule on the server (it survives restarts), not in your configuration
  file. Nothing is approved or focused automatically.
- **Changed files.** Files OpenCode edited stay listed under the reply with **Open**
  and **Changes** (a before/after diff in the editor).
- **Context and usage.** A small meter next to the send button shows how full the
  model's context window is (when the server reports the model's limit). At 80% a
  warning offers **Compact conversation**, which asks OpenCode to summarize the
  conversation so far (a divider and a folded summary appear; you can press Stop).
  Each finished exchange shows how long it took and how many tokens it generated.
- **Notifications.** If a reply finishes, fails or needs your approval while the
  OpenCode view is hidden or the window isn't focused, you get an editor
  notification with **Show**. Turn this off with the `sidecode.notifications` setting.
- **Pinned question.** While you read a long reply, your question stays pinned at
  the top; click it to jump back.

## Troubleshooting

**"Cannot reach the server."** Check the server is running on that port
(`opencode serve --port 4096`) and the URL under **⋯ → Server URL**. The error
offers **Change server URL**.

**"The OpenCode server cannot open this folder on its machine."** The server runs on
another machine that doesn't have this folder. See "A server on another machine".

**"Server authentication failed."** The server has a password: use
**⋯ → Set credentials** (username `opencode` unless you changed it).

**"Unexpected API response."** The URL points at something that is not an OpenCode
API (for example a web page), or a server version that behaves differently from
2.3.0.

**"The model provider returned an error. OpenCode is retrying…"** OpenCode keeps
retrying a failing provider with growing waits, indefinitely. The notice shows the
provider's own message. Common causes: the model isn't loaded in LM Studio, LM
Studio isn't running, or the context is too long. Fix it and wait, or press Stop.

**"This OpenCode server is version 1."** Sidecode needs OpenCode 2. On the server
machine run `opencode upgrade --major`, restart `opencode serve`, and reconnect. OpenCode
2 stores its data in a format 1.x can't read, so to go back to 1.x run
`opencode uninstall --keep-config` before installing it. The `v1` branch of Sidecode
still works with OpenCode 1.

**A reply is empty.** The model said it would call a tool but sent none (OpenCode 2 then
ends the run). This is a model setup problem: use a model with tool-calling support,
the right prompt template, and enough context length in your provider.

**A step shows "model is writing it" for a long time.** The model is generating the
step's arguments (for example the content of a large file). OpenCode 2.3.0 sends the
step's details only when the model finishes, so neither can Sidecode. Large edits can
take minutes with local models; Stop is safe.

**"This conversation is using 85% of the model's context."** Local models often fail,
loop or forget earlier messages near their limit. Use **Compact conversation**, start
a new session, or give the model a larger context length in your provider.

**"Waiting for the model" for a long time.** Local models can take a while to load.
Check your provider.

**The OpenCode tab is on the left / in the wrong place.** Reload the window after
installing. If the editor remembered an old position, right-click the icon and
choose **Reset Location**, or drag it where you want it.

**"Connected", but nothing can be selected or typed (or "Sidecode was updated").** The
window is still running the previous version in the background after an install.
Run **Developer: Reload Window**.

**Buttons seem to do nothing.** Prompts such as Server URL open at the top centre of
the window. **⋯ → Diagnostics** shows each action Sidecode received (names only).
If credentials can't be read or saved within 10 seconds (a locked system keyring),
you get "Could not read or save credentials".

**Diagnostics.** **⋯ → Diagnostics** opens the "OpenCode Connection" output: fixed
state names, retry counts, error codes and action names only. It never contains
URLs, paths, credentials, sessions or message text.

## Known limitations

- Tested with OpenCode 2.3.0, VSCodium 1.143 and VS Code 1.145 on Linux only.
- OpenCode 2.3.0 lists only its built-in agents (`build`, `plan`); agents defined in
  configuration do not appear in its agent list, so Sidecode can't offer them.
- Paths are sent to the server as the editor sees them, so the server must share the
  editor's filesystem (a local server, or one in the same remote or container).
- Agent questions (OpenCode's `question` tool and forms) are not shown; answer them in
  the CLI or press Stop.
- Only OpenCode's `edit` and `write` tools get change summaries and diffs; a file
  written without approval offers Open only (2.3.0 records no patch for it).
- Attached files are sent as text; images and other binary files are untested. The
  workspace picker excludes only `node_modules` and `.git`, lists at most 5,000
  files, and with multiple cursors only the main selection is attached.
- No model "variant" (reasoning effort) picker. With "Default model" in an existing
  session, OpenCode keeps that session's last model.
- No session rename, delete, share, revert or "all changes" view.
- Messages render Markdown without links or images (shown as text), by design.
- Screen readers hear a short notice when a reply ends, not the reply itself.

## Privacy and safety

- The webview runs under a strict Content Security Policy with no network access;
  all server traffic goes through the extension host.
- Credentials live in the editor's secret storage and never reach the webview or logs.
- Model output, tool output and file contents are treated as untrusted: Markdown is
  rendered without HTML, links or images; tool output and reasoning are plain text.
- Only paths inside the connected project (after resolving symlinks) can be
  attached or opened; OpenCode itself would read any path.
- Settings: `sidecode.serverUrl` and `sidecode.notifications`. The only setting Sidecode writes is `sidecode.serverUrl`, and only when you
  choose **Server URL** or confirm it on first Connect. It does not move views,
  change editor groups, or touch other extensions.

## Development

Node.js 22.12+ and npm:

```sh
npm ci
npm run check      # typecheck, lint, unit tests, build
npm run package    # sidecode-0.1.0.vsix
```

The integration tests start their own isolated OpenCode 2.3.0 (the pinned
`@opencode/cli` dev dependency, with its own home and data folders; your installed
OpenCode and its data are never used) and a local fake model (no provider, credits or
personal config involved), and disposable editor profiles. OpenCode 2 looks for LM
Studio on port 1234 by itself; the test server is pointed elsewhere so it never
contacts a model server on your machine. `test:server` also checks that an installed
OpenCode 1.x (`~/.opencode/bin/opencode`) is recognized, when present.
Set `SIDECODE_EDITOR_BINARY=/usr/share/code/code` (and for
`test:editor` also `SIDECODE_EDITOR_CLI=/usr/bin/code`) to run against VS Code.

| Script | What it checks |
|---|---|
| `test:webview` | 16 theme/width cases (200–480 px) in headless Chrome: layout, keyboard order and focus rings, Escape, reduced motion, high contrast, untrusted content, all UI states. |
| `test:native`, `test:native:chat` | The real editor webview: placement, dialogs, connect, streaming, Stop, permissions, selectors, context, edit review in the diff editor. |
| `test:editor` | VSIX install/uninstall/reinstall in a clean profile; no setting or editor-group changes. |
| `test:placement` | Upgrading from the old left-side build shows the tab on the right. |
| `test:lifecycle` | Installed VSIX: hide/show, zoom, reload, disable and re-enable. |
| `test:coexistence` | Copies of the installed Codex and Claude Code extensions are unaffected. |
| `test:conversations`, `test:permissions`, `test:selectors`, `test:context`, `test:changes`, `test:progress`, `test:server` | Real-server behaviour for each feature. |

See `docs/discovery.md` for the verified OpenCode 2.3.0 behaviour this relies on
and `docs/verification.md` for the verification record.

The publisher `sidecode-local` is for local installation; the project is private
and currently has no distribution license.
