import { randomBytes } from 'node:crypto';
import { emptyChat, identifier, limits, record, type ChatMessage, type ChatState, type ContextItem, type PermissionReply, type Selection } from '../shared/chat';
import type { ChangeSource, ContextPart, ConversationApi, ProjectedMessage } from './conversations';
/** Host-side pending attachment: the display item plus the part that will be sent. */
export interface PendingContext { item: ContextItem; part: ContextPart }
import { validEvent } from './transport';

/**
 * Snapshots are authoritative and replace messages by ID. OpenCode 1.19.4 persists a
 * text part only when it finishes, so live text comes from `message.part.delta`.
 * A delta overlay is kept only for parts whose full text was seen in
 * `message.part.updated` while connected (SSE is ordered, so the overlay is exact);
 * deltas for unknown parts are ignored and the overlay is dropped on disconnect,
 * session change or once the snapshot shows the message finished.
 */
export class Chat {
  state = emptyChat();
  private api: ConversationApi | undefined;
  private online = false;
  private generation = 0;
  private read: AbortController | undefined;
  private mutation: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  private limit = 100;
  private listeners = new Set<() => void>();
  private base: ProjectedMessage[] = [];
  private live = new Map<string, { messageID: string; text: string; kind: 'text' | 'reasoning' }>();
  private paint: ReturnType<typeof setTimeout> | undefined;
  private optionsRead: AbortController | undefined;
  /** Per-session context for the next prompt. Cleared on disconnect and after a confirmed send. */
  private pending = new Map<string, PendingContext[]>();
  /** Host-only proposed edits for the shown permission requests. */
  private reviews: Record<string, ChangeSource> = {};
  constructor(private interval = 200, private paintInterval = 50) {}
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private update(patch: Partial<ChatState> & { messages?: ProjectedMessage[] }): void {
    if (patch.messages) {
      this.base = patch.messages;
      const finished = new Set(this.base.filter(m => m.status !== 'streaming').map(m => m.id));
      for (const [id, part] of this.live) if (finished.has(part.messageID)) this.live.delete(id);
      patch = { ...patch, messages: this.render() };
    }
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  private dropLive(): void { this.live.clear(); clearTimeout(this.paint); this.paint = undefined; }
  private render(): ChatMessage[] {
    return this.base.map(source => {
      // Explicit allowlist: host-only fields (part IDs, change sources) never reach the bridge.
      const { id, role, text, reasoning, status, otherParts, tools, attachments, time, tokens, kind, parts, reasoningParts } = source;
      const message: ChatMessage = { id, role, text, reasoning, status, otherParts, tools, attachments, time, tokens, kind };
      if (message.status !== 'streaming') return message;
      const overlay = (known: { id: string; text: string }[] = [], kind: 'text' | 'reasoning') => {
        const texts = known.map(part => { const live = this.live.get(part.id); return live && live.text.length >= part.text.length ? live.text : part.text; });
        for (const [partId, live] of this.live) if (live.kind === kind && live.messageID === message.id && !known.some(part => part.id === partId)) texts.push(live.text);
        return texts.join('\n\n');
      };
      return { ...message, text: overlay(parts, 'text').slice(0, 1000000), reasoning: overlay(reasoningParts, 'reasoning').slice(0, limits.reasoning) };
    });
  }
  private schedulePaint(): void {
    if (this.paint) return;
    this.paint = setTimeout(() => { this.paint = undefined; this.update({ messages: this.base }); }, this.paintInterval);
  }
  attach(api: ConversationApi): void { this.clear(); this.api = api; }
  clear(): void {
    this.optionsRead?.abort(); this.optionsRead = undefined;
    this.generation++; this.read?.abort(); this.read = undefined; this.mutation?.abort(); this.mutation = undefined;
    clearTimeout(this.timer); this.timer = undefined; this.api = undefined; this.online = false; this.dirty = false; this.limit = 100;
    this.dropLive(); this.base = []; this.pending.clear(); this.reviews = {};
    this.update(emptyChat());
  }
  dispose(): void { this.clear(); this.listeners.clear(); }
  connection(online: boolean): void {
    if (this.online === online) return;
    this.online = online;
    if (online) { this.invalidate(); void this.loadOptions(); }
    else { this.dropLive(); this.generation++; this.read?.abort(); this.read = undefined; clearTimeout(this.timer); this.timer = undefined; this.update({ loading: false }); }
  }
  event(value: unknown): void {
    if (!validEvent(value)) return;
    const props = value.properties;
    if (value.type === 'message.part.delta') {
      // Live text only; never triggers a history refresh.
      const part = identifier(props.partID) ? this.live.get(props.partID) : undefined;
      if (part && props.sessionID === this.state.selectedId && props.messageID === part.messageID && props.field === 'text' && typeof props.delta === 'string' && part.text.length + props.delta.length <= 1000000) {
        part.text += props.delta; this.schedulePaint();
      }
      return;
    }
    // Unknown agents/models (and other prompt failures) are reported only as `session.error`.
    // Raw server text may contain paths or stack traces, so only a fixed message is shown.
    if (value.type === 'session.error' && props.sessionID === this.state.selectedId && !(record(props.error) && props.error.name === 'MessageAbortedError')) this.update({ error: 'sessionError' });
    if (value.type === 'message.part.updated' && props.sessionID === this.state.selectedId && record(props.part)) {
      const part = props.part;
      // Reasoning streams through the same part/delta events as reply text (1.19.4).
      if ((part.type === 'text' || part.type === 'reasoning') && identifier(part.id) && identifier(part.messageID) && part.sessionID === this.state.selectedId && typeof part.text === 'string' && part.text.length <= 1000000 && !part.ignored && !part.synthetic) {
        this.live.set(part.id, { messageID: part.messageID, text: part.text, kind: part.type }); this.schedulePaint();
      }
    }
    if (/^(session\.|message\.|permission\.|question\.)/.test(value.type)) {
      const id = value.properties.sessionID;
      if (id === this.state.selectedId || value.type.startsWith('session.')) this.invalidate();
    }
  }
  invalidate(): void {
    if (!this.online || !this.api) return;
    this.dirty = true;
    if (this.read || this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, this.interval);
  }
  async refresh(): Promise<void> {
    if (!this.online || !this.api) return;
    if (this.read) { this.dirty = true; return; }
    clearTimeout(this.timer); this.timer = undefined; this.dirty = false;
    const api = this.api; const generation = this.generation;
    const abort = new AbortController(); this.read = abort;
    const timeout = setTimeout(() => abort.abort(), 10000);
    const current = () => generation === this.generation && this.online && this.read === abort;
    this.update({ loading: true });
    try {
      const sessions = await api.list(abort.signal);
      if (!current()) return;
      let selectedId = this.state.selectedId;
      if (selectedId && !sessions.some(s => s.id === selectedId)) {
        if (current()) this.update({ sessions, selectedId: null, messages: [], permissions: [], context: [], retry: null, busy: false, waiting: false, error: 'sessionMissing', hasMore: false });
        return;
      }
      selectedId ??= sessions[0]?.id ?? null;
      const { used = { agent: null, model: null }, reviews = {}, retry = null, ...snapshot } = selectedId ? await api.snapshot(selectedId, this.limit, abort.signal) : { messages: [], permissions: [], busy: false, waiting: false, hasMore: false };
      if (current()) {
        const last = snapshot.messages.at(-1);
        const error = this.state.error;
        const kept = error === 'sendUncertain' || error === 'createUncertain' || error === 'optionUnavailable'
          || (error === 'replyUncertain' && snapshot.permissions.length > 0)
          // A failed/stopped reply already explains itself in the message list.
          || (error === 'sessionError' && !(last?.role === 'assistant' && (last.status === 'failed' || last.status === 'stopped'))) ? error : null;
        this.reviews = reviews;
        this.update({ sessions, selectedId, ...snapshot, used, retry, context: this.contextFor(selectedId), error: kept });
      }
    } catch { if (current()) this.update({ error: 'readFailed' }); }
    finally {
      clearTimeout(timeout);
      if (this.read === abort) { this.read = undefined; this.update({ loading: false }); if (this.dirty) this.invalidate(); }
    }
  }
  async select(id: string): Promise<void> {
    if (!this.state.sessions.some(session => session.id === id) || this.state.operation !== 'none') return;
    this.generation++; this.read?.abort(); this.read = undefined; this.limit = 100; this.dropLive();
    this.update({ selectedId: id, messages: [], permissions: [], context: this.contextFor(id), used: { agent: null, model: null }, retry: null, busy: false, waiting: false, error: null, submitted: null, hasMore: false });
    await this.refresh();
  }
  /** Change source of a tool in the selected session's current history (explicit open/diff only). */
  changeSource(sessionId: string, toolId: string): ChangeSource | undefined {
    if (sessionId !== this.state.selectedId) return undefined;
    for (const message of this.base) { const source = message.changes?.[toolId]; if (source) return source; }
    return undefined;
  }
  /** Proposed edit of a permission request currently shown for the selected session. */
  reviewSource(sessionId: string, requestId: string): ChangeSource | undefined {
    if (sessionId !== this.state.selectedId || !this.state.permissions.some(p => p.id === requestId)) return undefined;
    return this.reviews[requestId];
  }
  private contextFor(id: string | null): ContextItem[] { return id ? (this.pending.get(id) ?? []).map(entry => entry.item) : []; }
  /**
   * Adds host-built context for the selected session (explicit user action only).
   * The same URL is never attached twice; the count is capped. Returns how many were added.
   */
  addContext(sessionId: string, entries: PendingContext[]): number {
    if (sessionId !== this.state.selectedId || !this.api) return 0;
    const list = this.pending.get(sessionId) ?? [];
    let added = 0;
    for (const entry of entries) {
      if (list.length >= limits.context || list.some(existing => existing.part.url === entry.part.url)) continue;
      list.push(entry); added++;
    }
    this.pending.set(sessionId, list);
    this.update({ context: this.contextFor(sessionId) });
    return added;
  }
  removeContext(sessionId: string, contextId: string): void {
    const list = this.pending.get(sessionId);
    if (!list || this.state.operation === 'sending') return;
    this.pending.set(sessionId, list.filter(entry => entry.item.id !== contextId));
    if (sessionId === this.state.selectedId) this.update({ context: this.contextFor(sessionId) });
  }
  /** Agent/model lists. On failure the previous lists stay; only listed values can be sent. */
  async loadOptions(): Promise<void> {
    if (!this.online || !this.api || this.optionsRead) return;
    const api = this.api; const abort = new AbortController(); this.optionsRead = abort;
    const timeout = setTimeout(() => abort.abort(), 10000);
    try {
      const options = await api.options(abort.signal);
      if (this.api === api && this.optionsRead === abort) this.update(options);
    } catch { /* keep previous lists; selectors fall back to the server default */ }
    finally { clearTimeout(timeout); if (this.optionsRead === abort) this.optionsRead = undefined; }
  }
  async older(): Promise<void> { this.limit = Math.min(1000, this.limit + 100); await this.refresh(); }
  private async mutate(operation: ChatState['operation'], work: (api: ConversationApi, signal: AbortSignal) => Promise<void>, limit = 15000): Promise<void> {
    if (!this.online || !this.api || this.state.operation !== 'none') return;
    const abort = new AbortController(); this.mutation = abort;
    const api = this.api;
    const timeout = setTimeout(() => abort.abort(), limit);
    this.update({ operation, error: null });
    try { await work(api, abort.signal); }
    catch {
      if (this.api === api && this.mutation === abort) this.update({ error: operation === 'sending' ? 'sendUncertain' : operation === 'creating' ? 'createUncertain' : operation === 'replying' ? 'replyUncertain' : operation === 'compacting' ? (this.stoppedCompaction ? null : 'compactFailed') : operation === 'updating' ? 'updateFailed' : 'stopFailed' });
    } finally {
      clearTimeout(timeout);
      if (this.mutation === abort) { this.mutation = undefined; this.update({ operation: 'none' }); this.invalidate(); }
    }
  }
  async create(): Promise<void> {
    await this.mutate('creating', async (api, signal) => {
      const session = await api.create(signal, this.askNewSessions);
      if (this.api !== api || signal.aborted) return;
      this.generation++; this.read?.abort(); this.read = undefined; this.limit = 100; this.dropLive();
      this.update({ sessions: [session, ...this.state.sessions.filter(s => s.id !== session.id)].slice(0, 100), selectedId: session.id, messages: [], permissions: [], context: [], used: { agent: null, model: null }, retry: null, error: null, busy: false, waiting: false, submitted: null });
    });
  }
  async send(id: string, text: string, requestId: string, selection: Selection = { agent: null, model: null }): Promise<void> {
    if (requestId === this.state.submitted || id !== this.state.selectedId || this.state.busy || this.state.waiting || this.state.loading || !text.trim() || text.length > 32000) return;
    // OpenCode accepts unknown names and then fails asynchronously; send only currently listed values.
    const { agent, model } = selection;
    if ((agent !== null && !this.state.agents.some(a => a.name === agent))
      || (model !== null && !this.state.models.some(m => m.providerID === model.providerID && m.modelID === model.modelID))) {
      if (this.state.operation === 'none') this.update({ error: 'optionUnavailable' });
      return;
    }
    const messageID = `msg_${Date.now().toString(16)}${randomBytes(12).toString('hex')}`;
    const context = [...(this.pending.get(id) ?? [])];
    await this.mutate('sending', async (api, signal) => {
      await api.send(id, messageID, text, { agent, model }, signal, context.map(entry => entry.part));
      if (this.api === api && !signal.aborted) {
        // Delivered: drop exactly what was sent (an uncertain send keeps it for the user to decide).
        const remaining = (this.pending.get(id) ?? []).filter(entry => !context.includes(entry));
        if (remaining.length) this.pending.set(id, remaining); else this.pending.delete(id);
        this.update({ submitted: requestId, busy: true, context: this.contextFor(this.state.selectedId) });
      }
    });
  }
  /** Only on an explicit user command, only for a request currently shown for the selected session. Never retried. */
  async reply(sessionId: string, requestId: string, reply: PermissionReply): Promise<void> {
    if (sessionId !== this.state.selectedId || !this.state.permissions.some(p => p.id === requestId)) return;
    await this.mutate('replying', async (api, signal) => {
      await api.reply(requestId, reply, signal);
      if (this.api === api && !signal.aborted) this.update({ permissions: this.state.permissions.filter(p => p.id !== requestId), waiting: this.state.permissions.length > 1 });
    });
  }
  /** Remembered default (host storage): new sessions start with `edit: ask`. */
  askNewSessions = false;
  /**
   * Explicit only. Adds the session's edit rule. Never relaxes a configuration that
   * requires approval (`ask`, `deny` or per-pattern rules): a session `allow` would
   * override it in 1.19.4. No request when already in the requested state.
   */
  async setEditApproval(sessionId: string, ask: boolean): Promise<void> {
    const session = this.state.sessions.find(s => s.id === sessionId);
    if (!session || sessionId !== this.state.selectedId) return;
    const policy = this.state.editPolicy;
    if (!ask && (policy === 'ask' || policy === 'deny' || policy === 'mixed')) return;
    const current = session.edit ?? (policy === 'allow' || policy === null ? 'allow' : 'ask');
    if ((current === 'ask') === ask) return;
    await this.mutate('updating', async (api, signal) => {
      const updated = await api.setEditRule(sessionId, ask ? 'ask' : 'allow', signal);
      if (this.api === api && !signal.aborted) this.update({ sessions: this.state.sessions.map(s => s.id === updated.id ? updated : s) });
    });
  }
  /**
   * Explicit only. OpenCode summarizes with the model, which can take minutes for local
   * models, so the request waits up to 10 minutes; never retried.
   */
  async compact(id: string): Promise<void> {
    if (id !== this.state.selectedId || this.state.busy || this.state.waiting) return;
    const model = this.state.used.model && this.state.models.some(m => m.providerID === this.state.used.model!.providerID && m.modelID === this.state.used.model!.modelID) ? this.state.used.model : null;
    this.stoppedCompaction = false;
    await this.mutate('compacting', async (api, signal) => { await api.compact(id, model, signal); }, 600000);
  }
  private stoppedCompaction = false;
  async stop(id: string): Promise<void> {
    if (id !== this.state.selectedId) return;
    // Compaction holds the operation slot for a long time; Stop must still work.
    if (this.state.operation === 'compacting' && this.api && this.online) {
      this.stoppedCompaction = true;
      try { await this.api.stop(id, AbortSignal.timeout(15000)); } catch { this.update({ error: 'stopFailed' }); }
      this.invalidate();
      return;
    }
    await this.mutate('stopping', async (api, signal) => { await api.stop(id, signal); });
  }
}
