import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { contextSources, isHostMessage, type ConnectionAction, type WebviewMessage } from '../shared/protocol';
import { disconnected, errorMessages, type ConnectionState } from '../shared/connection';
import { chatErrors, emptyChat, limits, sessionTitle, type ChatState, type ModelOption, type Selection } from '../shared/chat';
import { Markdown } from './Markdown';
import { AttachmentList, fileTools, FileChanges, formatElapsed, Mark, PendingContext, PermissionCard, RetryNotice, StepGroup, Thinking } from './Activity';

const contextLabels: Record<typeof contextSources[number], string> = { activeFile: 'Current file', selection: 'Selection', workspace: 'Workspace…' };

export interface HostBridge { postMessage(message: WebviewMessage): void }
export function App({ bridge }: { bridge: HostBridge }) {
  const [state, setState] = useState<ConnectionState>(disconnected);
  const [chat, setChat] = useState<ChatState>(emptyChat);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [menu, setMenu] = useState(false);
  /** The extension host speaks an older protocol than this view (see receive). */
  const [outdated, setOutdated] = useState(false);
  const [contextMenu, setContextMenu] = useState(false);
  /** When the current run started (this view's clock), for the elapsed time on the working line. */
  const [now, setNow] = useState(() => Date.now());
  /** Explicit per-session choices; otherwise the session's last-used agent/model. */
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  /** Name being typed for the selected session (null: not renaming). */
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  /** Set once Enter/Escape/blur has finished a rename, so the closing blur does not save again. */
  const renameDone = useRef(false);
  /** Enter/Escape return focus to the session picker once the field has closed. */
  const refocus = useRef(false);
  const submission = useRef<{ id: string; session: string; text: string } | null>(null);
  const conversation = useRef<HTMLElement>(null);
  const follow = useRef(true);
  const labels = { disconnected: 'Not connected', health: 'Checking server health…', sessions: 'Loading project sessions…', events: 'Subscribing to events…', connected: 'Connected', retrying: `Reconnecting (${state.attempt}/3)…`, error: 'Connection failed' };
  const active = !['disconnected', 'error'].includes(state.phase);
  const online = state.phase === 'connected';
  const action = (type: ConnectionAction | 'refresh' | 'newSession' | 'older') => bridge.postMessage({ version: 1, type });
  const menuButton = useRef<HTMLButtonElement>(null);
  const contextButton = useRef<HTMLButtonElement>(null);
  const menuAction = (type: ConnectionAction | 'refresh') => { setMenu(false); menuButton.current?.focus(); action(type); };
  const draft = chat.selectedId ? drafts[chat.selectedId] ?? '' : '';
  const base = (chat.selectedId && selections[chat.selectedId]) || chat.used;
  // Only values the server currently lists; anything else falls back to the server default.
  const agent = base.agent !== null && chat.agents.some(a => a.name === base.agent) ? base.agent : null;
  const modelIndex = base.model ? chat.models.findIndex(m => m.providerID === base.model!.providerID && m.modelID === base.model!.modelID) : -1;
  const selection: Selection = { agent, model: modelIndex >= 0 ? { providerID: chat.models[modelIndex]!.providerID, modelID: chat.models[modelIndex]!.modelID } : null };
  const choose = (patch: Partial<Selection>) => { if (chat.selectedId) setSelections(previous => ({ ...previous, [chat.selectedId!]: { ...selection, ...patch } })); };
  const providers = chat.models.reduce<{ name: string; models: [ModelOption, number][] }[]>((groups, model, index) => {
    const group = groups.find(g => g.name === model.provider);
    if (group) group.models.push([model, index]); else groups.push({ name: model.provider, models: [[model, index]] });
    return groups;
  }, []);
  const controlsEnabled = online && !!chat.selectedId && chat.operation === 'none';
  const canSend = online && !!chat.selectedId && !chat.busy && !chat.waiting && !chat.loading && chat.operation === 'none' && !pending;
  const running = !!chat.selectedId && (chat.busy || chat.waiting);
  const title = chat.sessions.find(s => s.id === chat.selectedId)?.title;
  const canRename = online && !!chat.selectedId && chat.operation === 'none';
  const startRename = () => { if (canRename) { renameDone.current = false; setRenaming({ id: chat.selectedId!, text: title ?? '' }); } };
  /** Saves only a valid, changed name; anything else leaves the name as it was. */
  const finishRename = (save: boolean) => {
    if (!renaming || renameDone.current) return;
    renameDone.current = true;
    const next = sessionTitle(renaming.text);
    if (save && next && next !== title && renaming.id === chat.selectedId) bridge.postMessage({ version: 1, type: 'rename', sessionId: renaming.id, title: next });
    setRenaming(null);
  };
  useEffect(() => { if (!renaming && refocus.current) { refocus.current = false; document.getElementById('session')?.focus(); } }, [renaming]);
  // A rename in progress ends (unsaved) when the session changes or the connection drops.
  useEffect(() => { if (renaming && (renaming.id !== chat.selectedId || !online)) { renameDone.current = true; setRenaming(null); } }, [chat.selectedId, online, renaming]);
  const lastAssistant = [...chat.messages].reverse().find(m => m.role === 'assistant')?.id;
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (!isHostMessage(event.data)) {
        // A well-formed envelope with an unexpected state: the editor is still running an
        // older extension host than this view (installed without reloading the window).
        const data = event.data as { version?: unknown; type?: unknown } | null;
        if (data && typeof data === 'object' && data.version === 1 && (data.type === 'chat' || data.type === 'connection')) setOutdated(true);
        return;
      }
      setOutdated(false);
      if (event.data.type === 'connection') setState(event.data.state);
      else {
        const next = event.data.state;
        const sent = submission.current;
        if (sent && next.submitted === sent.id) {
          setDrafts(previous => previous[sent.session] === sent.text ? { ...previous, [sent.session]: '' } : previous);
          submission.current = null; setPending(false);
        } else if (next.operation === 'none' && (next.error || !next.selectedId)) { submission.current = null; setPending(false); }
        setChat(next);
      }
    };
    window.addEventListener('message', receive);
    bridge.postMessage({ version: 1, type: 'ready' });
    return () => window.removeEventListener('message', receive);
  }, [bridge]);
  /** Short screen-reader announcement when a run ends (not the reply itself, which would be too long). */
  const [announcement, setAnnouncement] = useState('');
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !chat.busy) {
      const last = chat.messages.at(-1);
      setAnnouncement(last?.status === 'failed' ? 'OpenCode could not complete the reply.' : last?.status === 'stopped' ? 'Stopped.' : 'OpenCode finished replying.');
    } else if (chat.busy) setAnnouncement('');
    wasBusy.current = chat.busy;
  }, [chat.busy, chat.messages]);
  useEffect(() => {
    if (!chat.busy) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [chat.busy]);
  /**
   * Pinned question: the question of the exchange you are reading, once it has scrolled
   * out of view above. Scrolling into an earlier exchange pins that one instead.
   */
  const [pinned, setPinned] = useState<string | null>(null);
  const updatePinned = () => {
    const element = conversation.current;
    if (!element) return;
    const questions = [...element.querySelectorAll<HTMLElement>('.message.user')];
    const top = element.scrollTop;
    const current = questions.filter(question => question.offsetTop <= top + 8).at(-1);
    const next = current && current.offsetTop + current.offsetHeight < top + 4 ? current.dataset.id ?? null : null;
    setPinned(previous => previous === next ? previous : next);
  };
  useEffect(() => {
    if (follow.current && conversation.current) conversation.current.scrollTop = conversation.current.scrollHeight;
    updatePinned();
  }, [chat.messages, chat.permissions]);
  useEffect(() => { setPinned(null); }, [chat.selectedId]);
  const pinnedMessage = pinned ? chat.messages.find(message => message.id === pinned) : undefined;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSend || !chat.selectedId || !draft.trim() || submission.current) return;
    const id = crypto.randomUUID();
    submission.current = { id, session: chat.selectedId, text: draft }; setPending(true);
    bridge.postMessage({ version: 1, type: 'send', sessionId: chat.selectedId, text: draft, requestId: id, agent: selection.agent, model: selection.model });
  }
  /** Escape closes a menu from the menu or its button and returns focus to the button. */
  const closeOnEscape = (close: () => void, button: { current: HTMLButtonElement | null }) => (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); button.current?.focus(); }
  };
  // What the run is doing now, from the latest reply after your last message.
  const tail = chat.messages.at(-1)?.role === 'assistant' ? chat.messages.at(-1) : undefined;
  const runningTool = tail?.tools.find(tool => tool.status === 'running');
  const pendingTool = tail?.tools.find(tool => tool.status === 'pending');
  // File steps name the file (not the start of its path) so the narrow line stays informative.
  const stepLabel = (tool: { tool: string; title: string }) => tool.title ? (fileTools.has(tool.tool) ? tool.title.slice(tool.title.lastIndexOf('/') + 1) : tool.title) : '';
  const phase = chat.operation === 'compacting' ? 'Compacting the conversation' : runningTool ? `Running ${runningTool.tool}${stepLabel(runningTool) ? ` · ${stepLabel(runningTool)}` : ''}`
    : pendingTool ? `Model is writing the ${pendingTool.tool} step`
    : tail?.status === 'streaming' && tail.text ? 'Writing the reply' : tail?.status === 'streaming' && tail.reasoning ? 'Thinking' : 'Waiting for the model';
  // The run started when your latest message reached the server (server time, so it survives switching).
  const lastQuestion = [...chat.messages].reverse().find(m => m.role === 'user' && m.kind === 'message');
  const since = chat.busy && lastQuestion?.time.created ? lastQuestion.time.created : null;
  const elapsed = since === null ? 0 : Math.max(0, now - since);
  // Runs of empty assistant replies (no text, reasoning, tools or other parts) are shown
  // as one line with a count instead of blank space; a long run while busy is a warning.
  type Row = { kind: 'message'; message: ChatState['messages'][number] } | { kind: 'empty'; id: string; count: number; active: boolean; atStart: boolean };
  const isEmpty = (m: ChatState['messages'][number]) => m.kind === 'message' && m.role === 'assistant' && !m.text && !m.reasoning && !m.tools.length && !m.otherParts && !m.attachments.length && (m.status === 'complete' || m.status === 'streaming');
  const rows: Row[] = [];
  for (let index = 0; index < chat.messages.length;) {
    const message = chat.messages[index]!;
    if (!isEmpty(message)) { rows.push({ kind: 'message', message }); index++; continue; }
    let end = index; while (end < chat.messages.length && isEmpty(chat.messages[end]!)) end++;
    const count = chat.messages.slice(index, end).filter(m => m.status === 'complete').length;
    const trailing = end === chat.messages.length;
    // One empty step (e.g. a reply that has not produced anything yet) is not shown at all.
    if (count >= 2) rows.push({ kind: 'empty', id: `empty-${message.id}`, count, active: trailing && chat.busy, atStart: index === 0 });
    index = end;
  }
  // Reply stats: at the end of each finished exchange, total time and generated tokens.
  const stats = new Map<string, string>();
  for (let index = 0, question: ChatState['messages'][number] | undefined, output = 0; index < chat.messages.length; index++) {
    const message = chat.messages[index]!;
    if (message.role === 'user') { question = message; output = 0; continue; }
    output += message.tokens?.output ?? 0;
    const next = chat.messages[index + 1];
    if (message.kind === 'message' && message.status === 'complete' && message.time.completed && question && (!next || next.role === 'user') && !(chat.busy && !next)) {
      stats.set(message.id, `${formatElapsed(message.time.completed - question.time.created)}${output ? ` · ${output.toLocaleString()} tokens` : ''}`);
    }
  }
  // Context meter: how full the model's context window was at the latest step.
  const latest = [...chat.messages].reverse().find(m => m.role === 'assistant' && m.tokens);
  const contextUsed = latest?.tokens ? (latest.kind === 'summary' ? latest.tokens.output : latest.tokens.context) : 0;
  const meterModel = selection.model ?? chat.used.model;
  const contextLimit = meterModel ? chat.models.find(m => m.providerID === meterModel.providerID && m.modelID === meterModel.modelID)?.context ?? null : null;
  const contextShare = contextLimit && contextUsed ? Math.min(100, Math.round(contextUsed / contextLimit * 100)) : null;
  const compact = (value: number) => value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(value);
  // Edit approval for the selected session: its own rule, else the server configuration (OpenCode default: allow).
  const currentSession = chat.sessions.find(s => s.id === chat.selectedId);
  const policy = chat.editPolicy;
  const lockedOn = policy === 'ask' || policy === 'deny' || policy === 'mixed';
  const editMode: 'ask' | 'allow' | 'deny' = currentSession?.edit ?? (policy === 'deny' ? 'deny' : policy === 'ask' || policy === 'mixed' ? 'ask' : 'allow');
  const editTitle = editMode === 'deny' ? 'Your OpenCode configuration blocks file edits.'
    : lockedOn && editMode !== 'allow' ? 'OpenCode asks before every file edit. Your OpenCode configuration requires this, so it cannot be turned off here.'
    : editMode === 'ask' ? 'OpenCode asks before every file edit; you can review the change in a diff first. Click to let edits apply automatically.'
    : 'File edits apply without asking. Click to review each edit before it is applied.';
  const looping = rows.at(-1)?.kind === 'empty' && (rows.at(-1) as { active: boolean }).active;
  const openChange = online && chat.selectedId ? (toolId: string, view: 'file' | 'diff') => bridge.postMessage({ version: 1, type: 'openChange', sessionId: chat.selectedId!, toolId, view }) : undefined;

  return <main className="shell" aria-label="OpenCode chat">
    <header className="header">
      <div className="title-row">
        {renaming ? <input className="session-rename" aria-label="Session name" placeholder="Session name" autoFocus maxLength={limits.sessionTitle} value={renaming.text}
          onChange={event => setRenaming({ ...renaming, text: event.target.value })} onBlur={() => finishRename(true)}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); refocus.current = true; finishRename(true); }
            else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); refocus.current = true; finishRename(false); }
          }} />
        : <select id="session" className="session-select" aria-label="Session" aria-keyshortcuts="F2" title={title ? `${title} (F2 to rename)` : 'Choose a session'} value={chat.selectedId ?? ''} disabled={!online || chat.operation !== 'none'}
          onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); startRename(); } }} onChange={event => {
          follow.current = true; bridge.postMessage({ version: 1, type: 'selectSession', sessionId: event.target.value });
        }}><option value="" disabled>{chat.sessions.length ? 'Choose a session' : online ? 'No sessions yet' : 'OpenCode'}</option>{chat.sessions.map(session => <option key={session.id} value={session.id}>{session.title}</option>)}</select>}
        {chat.selectedId && <button type="button" className="icon" aria-label="Rename session" title="Rename session (F2)" disabled={!canRename || !!renaming} onClick={startRename}>✎</button>}
        <button type="button" className="icon" aria-label="New session" title="New session" disabled={!online || chat.operation !== 'none'} onClick={() => action('newSession')}>+</button>
        <button type="button" className="icon" aria-label="Connection options" title="Connection options" aria-expanded={menu} aria-controls="connection-menu" ref={menuButton} onKeyDown={menu ? closeOnEscape(() => setMenu(false), menuButton) : undefined} onClick={() => setMenu(open => !open)}>⋯</button>
      </div>
      <div className="status-row">
        <p className={`status status-${state.phase}`} role="status"><span className="status-dot" aria-hidden="true" />{labels[state.phase]}</p>
        {!active && <button type="button" className="primary small" onClick={() => action('connect')}>Connect</button>}
      </div>
      {menu && <div id="connection-menu" className="menu" role="group" aria-label="Connection options" onKeyDown={closeOnEscape(() => setMenu(false), menuButton)}>
        {active && <button type="button" title="Stop receiving updates; use Stop to cancel a running response" onClick={() => menuAction('disconnect')}>Disconnect</button>}
        <button type="button" disabled={!online || chat.loading} onClick={() => menuAction('refresh')}>Refresh</button>
        <button type="button" onClick={() => menuAction('configure')}>Server URL</button>
        <button type="button" onClick={() => menuAction('credentials')}>Set credentials</button>
        <button type="button" onClick={() => menuAction('clearCredentials')}>Clear credentials</button>
        <button type="button" onClick={() => menuAction('diagnostics')}>Diagnostics</button>
      </div>}
      {outdated && <p className="banner banner-warning" role="alert"><strong>Sidecode was updated.</strong> Reload the window to finish updating: press Ctrl+Shift+P and run <strong>Developer: Reload Window</strong>. Work running on your OpenCode server continues meanwhile.</p>}
      {state.error && <p className="banner banner-error" role="alert">{errorMessages[state.error]}
        {(state.error === 'unavailable' || state.error === 'incompatible' || state.error === 'invalidUrl') && <> <button type="button" className="link" onClick={() => action('configure')}>Change server URL</button></>}
        {state.error === 'authRequired' && <> <button type="button" className="link" onClick={() => action('credentials')}>Set credentials</button></>}</p>}
      {state.phase === 'retrying' && <p className="banner banner-warning">Updates are paused. Your draft and attached context are kept, and history reloads when the connection returns.</p>}
      {chat.error && <p className="banner banner-error" role="alert">{chatErrors[chat.error]} <button type="button" className="link" disabled={!online} onClick={() => action('refresh')}>Retry loading</button></p>}
    </header>
    <div className="conversation-area">
    {pinnedMessage && <button type="button" className="pinned-question" title="Scroll to this question" onClick={() => {
      const target = conversation.current?.querySelector<HTMLElement>(`.message.user[data-id="${CSS.escape(pinnedMessage.id)}"]`);
      if (target && conversation.current) { follow.current = false; conversation.current.scrollTop = Math.max(0, target.offsetTop - 8); updatePinned(); }
    }}><span className="visually-hidden">Your question: </span><span className="pinned-bubble"><span className="pinned-text">{pinnedMessage.text}</span></span></button>}
    <section ref={conversation} className="conversation" aria-label="Conversation" aria-busy={chat.loading} onScroll={() => {
      const element = conversation.current; if (element) follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
      updatePinned();
    }}>
      {chat.hasMore && <button type="button" className="link older" disabled={!online || chat.loading} onClick={() => { follow.current = false; action('older'); }}>Load earlier messages</button>}
      {!chat.messages.length && <div className="empty-state">
        <h2>{!online ? 'Connect to OpenCode' : chat.selectedId ? 'What should OpenCode work on?' : 'Your project conversations'}</h2>
        <p>{!online ? 'Sidecode uses your existing OpenCode server. Choose Connect to load this project\'s sessions.' : chat.selectedId ? 'Attach files or a selection with +. OpenCode asks here before using tools that need your permission.' : 'Choose a session above or start a new one with +.'}</p>
      </div>}
      <ol className="messages" aria-label="Messages">{rows.map(row => row.kind === 'empty'
        ? <li key={row.id} className={`empty-run${row.active ? ' banner banner-warning' : ''}`} role={row.active ? 'status' : undefined} data-count={row.count}>
          {row.active
            ? <><p><strong>The model keeps returning empty responses</strong> ({row.count.toLocaleString()}{row.atStart && chat.hasMore ? '+' : ''} in a row). OpenCode asks it again after each one, so this can continue indefinitely.</p>
              <p className="hint">This usually means the model is not handling tool calls correctly. Check the model and its settings in your provider (for example LM Studio), then press Stop.</p></>
            : <p className="message-note">{row.count.toLocaleString()}{row.atStart && chat.hasMore ? '+' : ''} empty responses from the model.</p>}
        </li>
        : row.message.kind === 'compaction'
        ? <li key={row.message.id} className="compaction-divider" data-id={row.message.id}><span>Conversation compacted</span></li>
        : row.message.kind === 'summary'
        ? <li key={row.message.id} className="message assistant summary" data-status={row.message.status} data-id={row.message.id}>
          <details><summary>{row.message.status === 'streaming' ? 'Summarizing earlier conversation…' : 'Summary of earlier conversation'}</summary><Markdown text={row.message.text} /></details>
        </li>
        : (message => <li key={message.id} className={`message ${message.role}`} data-status={message.status} data-id={message.id}>
        <span className="visually-hidden">{message.role === 'user' ? 'You' : 'OpenCode'}{message.status === 'complete' || message.status === 'sent' ? '' : `, ${message.status}`}</span>
        {message.role === 'assistant' && <Thinking text={message.reasoning} streaming={message.status === 'streaming'} answered={!!message.text} />}
        <Markdown text={message.text} />
        <AttachmentList attachments={message.attachments} />
        <StepGroup tools={message.tools} online={online} waiting={chat.waiting && message.id === lastAssistant} created={message.time.created || undefined} now={now} />
        <FileChanges tools={message.tools} open={openChange} />
        {message.status === 'streaming' && !!(message.text || message.reasoning) && !(chat.waiting && message.id === lastAssistant) && !message.tools.some(tool => tool.status === 'pending' || tool.status === 'running') && <span className="caret" aria-hidden="true" />}
        {message.status === 'stopped' && <p className="message-note">Stopped.</p>}
        {message.status === 'failed' && <p className="message-note error">OpenCode could not complete this response. Check the server and provider, then send a follow-up.</p>}
        {message.otherParts && <p className="message-note">This message includes other activity that is not shown here yet.</p>}
        {stats.has(message.id) && <p className="reply-stats">{stats.get(message.id)}</p>}
      </li>)(row.message))}</ol>
      {contextShare !== null && contextShare >= 80 && !chat.busy && chat.operation === 'none' && <div className="banner banner-warning context-warning" role="status">
        <p><strong>This conversation is using {contextShare}% of the model's context</strong> ({compact(contextUsed)} of {compact(contextLimit!)} tokens). Near the limit, local models often fail, loop or forget earlier messages.</p>
        <p><button type="button" className="primary small" disabled={!online} onClick={() => chat.selectedId && bridge.postMessage({ version: 1, type: 'compact', sessionId: chat.selectedId })}>Compact conversation</button> <span className="hint">or start a new session with +.</span></p>
      </div>}
      {chat.waiting && <p role="alert" className="visually-hidden">OpenCode is waiting for your permission.</p>}
      <p role="status" className="visually-hidden" data-testid="announcement">{announcement}</p>
      {chat.selectedId && chat.permissions.map(request => <PermissionCard key={request.id} request={request} disabled={!online || chat.operation !== 'none'}
        answer={reply => bridge.postMessage({ version: 1, type: 'permission', sessionId: chat.selectedId!, requestId: request.id, reply })}
        review={online ? () => bridge.postMessage({ version: 1, type: 'reviewPermission', sessionId: chat.selectedId!, requestId: request.id }) : undefined} />)}
      {chat.waiting && !chat.permissions.length && <p role="alert" className="banner banner-warning">OpenCode is waiting for input that this view cannot show yet. Answer it in the CLI, or Stop.</p>}
      {chat.busy && chat.retry && <RetryNotice retry={chat.retry} now={now} />}
      {chat.busy && !chat.waiting && !chat.retry && !looping && <div className="working">
        <p role="status"><Mark state={online ? 'running' : 'unknown'} label={null} /><span className="phase">{online ? phase : 'Status unknown while disconnected'}</span>{since !== null && <span className="elapsed">{formatElapsed(elapsed)}</span>}</p>
        {online && phase === 'Waiting for the model' && elapsed > 30000 && <p className="hint">No response from the model yet. Local models can take a while to load; check your provider (for example LM Studio) if this continues.</p>}
        {online && pendingTool && tail && now - (pendingTool.started ?? tail.time.created) > 30000 && <p className="hint">The model is still writing this step. Large edits can take minutes with local models, and OpenCode shows the change only once it is complete. Stop is safe if it seems stuck.</p>}
      </div>}
    </section>
    </div>
    <form className="composer" onSubmit={submit}>
      <label htmlFor="prompt" className="visually-hidden">Message OpenCode</label>
      <div className="box">
        <PendingContext items={chat.context} disabled={!controlsEnabled} remove={id => chat.selectedId && bridge.postMessage({ version: 1, type: 'removeContext', sessionId: chat.selectedId, contextId: id })} />
        <textarea id="prompt" rows={2} maxLength={32000} value={draft} disabled={!online || !chat.selectedId}
          placeholder={!online ? (active ? 'Waiting for the connection…' : 'Connect to send messages') : chat.selectedId ? 'Message OpenCode' : 'Start or choose a session'} aria-describedby="composer-help" onChange={event => {
            if (chat.selectedId) setDrafts(previous => ({ ...previous, [chat.selectedId!]: event.target.value }));
          }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing) submit(event); }} />
        {contextMenu && <div id="context-menu" className="context-menu" role="group" aria-label="Add context" onKeyDown={closeOnEscape(() => setContextMenu(false), contextButton)}>
          {contextSources.map(source => <button key={source} type="button" disabled={!controlsEnabled}
            onClick={() => { setContextMenu(false); contextButton.current?.focus(); if (chat.selectedId) bridge.postMessage({ version: 1, type: 'addContext', sessionId: chat.selectedId, source }); }}>{contextLabels[source]}</button>)}
        </div>}
        <div className="toolbar">
          <button type="button" className="icon round" aria-label="Add context" title="Add context" aria-expanded={contextMenu} aria-controls="context-menu" ref={contextButton} onKeyDown={contextMenu ? closeOnEscape(() => setContextMenu(false), contextButton) : undefined} disabled={!controlsEnabled} onClick={() => setContextMenu(open => !open)}>+</button>
          {chat.selectedId && <button type="button" className={`mode-toggle mode-${editMode}`} aria-pressed={editMode !== 'allow'} title={editTitle}
            aria-label={editMode === 'deny' ? 'File edits blocked' : 'Ask before file edits'} disabled={!controlsEnabled || editMode === 'deny' || (lockedOn && editMode === 'ask')}
            onClick={() => bridge.postMessage({ version: 1, type: 'editApproval', sessionId: chat.selectedId!, ask: editMode === 'allow' })}>
            {editMode === 'deny' ? 'Edits: blocked' : editMode === 'ask' ? 'Edits: ask' : 'Edits: auto'}</button>}
          <select id="agent" className="quiet" aria-label="Agent" title="Agent" value={selection.agent ?? ''} disabled={!controlsEnabled} onChange={event => choose({ agent: event.target.value || null })}>
            <option value="">Default agent</option>
            {chat.agents.map(item => <option key={item.name} value={item.name} title={item.description || undefined}>{item.name}</option>)}
          </select>
          <select id="model" className="quiet" aria-label="Model" title="Model" value={modelIndex >= 0 ? String(modelIndex) : ''} disabled={!controlsEnabled} onChange={event => {
            const model = event.target.value ? chat.models[Number(event.target.value)] : undefined;
            choose({ model: model ? { providerID: model.providerID, modelID: model.modelID } : null });
          }}>
            <option value="">Default model</option>
            {providers.map(group => <optgroup key={group.name} label={group.name}>{group.models.map(([model, index]) => <option key={index} value={index}>{model.name}</option>)}</optgroup>)}
          </select>
          {(contextShare !== null || contextUsed > 0) && <span className={`context-meter${contextShare !== null && contextShare >= 95 ? ' full' : contextShare !== null && contextShare >= 80 ? ' high' : ''}`}
            role="img" aria-label={contextShare !== null ? `Context ${contextShare}% full: ${contextUsed.toLocaleString()} of ${contextLimit!.toLocaleString()} tokens` : `Context: ${contextUsed.toLocaleString()} tokens`}
            title={contextShare !== null ? `Context: ${contextUsed.toLocaleString()} of ${contextLimit!.toLocaleString()} tokens` : `Context: ${contextUsed.toLocaleString()} tokens (model limit unknown)`}>{contextShare !== null ? `${contextShare}%` : compact(contextUsed)}</span>}
          {running || chat.operation === 'compacting'
            ? <button type="button" className="icon round send stop" aria-label="Stop" title="Stop the running response" disabled={!online || (chat.operation !== 'none' && chat.operation !== 'compacting')} onClick={() => bridge.postMessage({ version: 1, type: 'stop', sessionId: chat.selectedId! })}>■</button>
            : <button type="submit" className={`icon round send${chat.operation === 'sending' ? ' sending' : ''}`} aria-label="Send" title="Send (Enter)" disabled={!canSend || !draft.trim()}>↑</button>}
        </div>
      </div>
      <p id="composer-help" className="visually-hidden">Enter sends. Shift plus Enter adds a new line.</p>
    </form>
  </main>;
}
