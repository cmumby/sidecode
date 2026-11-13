import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { createApi, locationQuery, segment, type ConnectionOptions } from './api';
import { patchStats } from './patch';
import { ConnectionError } from './errors';
import { identifier, limits, optionName, record, type AgentOption, type Attachment, type ChatMessage, type EditPolicy, type EditRule, type FileChange, type ModelOption, type PermissionPrompt, type PermissionReply, type RetryStatus, type Selection, type SessionSummary, type ToolCall } from '../shared/chat';
/**
 * Host-only source of a file change: the server-side path and patch. Never crosses the
 * bridge; the controller re-checks the path against the project before opening anything.
 */
export interface ChangeSource { path: string; patch: string | null; created: boolean }
/** Host-only: text part keys let live deltas overlay unfinished parts; tool change sources. Stripped before the bridge. */
export interface ProjectedMessage extends ChatMessage { parts?: { id: string; text: string }[]; reasoningParts?: { id: string; text: string }[]; changes?: Record<string, ChangeSource> }
export interface ConversationSnapshot { messages: ProjectedMessage[]; permissions: PermissionPrompt[]; reviews?: Record<string, ChangeSource>; busy: boolean; waiting: boolean; hasMore: boolean; used?: Selection; retry?: RetryStatus | null }
/** Host-only prompt part built by the extension from an explicit user action. Never crosses the bridge. */
export interface ContextPart { type: 'file'; mime: string; filename: string; url: string }
export interface ServerOptions { agents: AgentOption[]; models: ModelOption[]; editPolicy: EditPolicy }
export interface ConversationApi {
  list(signal: AbortSignal): Promise<SessionSummary[]>;
  /** `ask`: create the session with an `edit` / `*` → `ask` rule (the remembered default). */
  create(signal: AbortSignal, ask?: boolean): Promise<SessionSummary>;
  /** Replaces the session's `edit` / `*` rule, keeping its other rules (2.x replaces the whole list). */
  setEditRule(id: string, rule: 'ask' | 'allow', signal: AbortSignal): Promise<SessionSummary>;
  /** Sets the session's title (PATCH; 2.3.0 keeps it: the automatic title never overwrites it). */
  rename(id: string, title: string, signal: AbortSignal): Promise<SessionSummary>;
  snapshot(id: string, limit: number, signal: AbortSignal): Promise<ConversationSnapshot>;
  options(signal: AbortSignal): Promise<ServerOptions>;
  /** Queues OpenCode's compaction; it then runs like a reply (the session is busy until it ends). */
  compact(id: string, signal: AbortSignal): Promise<void>;
  send(id: string, messageID: string, text: string, selection: Selection, signal: AbortSignal, context?: ContextPart[]): Promise<void>;
  stop(id: string, signal: AbortSignal): Promise<void>;
  reply(sessionID: string, requestID: string, reply: PermissionReply, signal: AbortSignal): Promise<void>;
  /** New output of a running command's shell from `cursor` on (2.x keeps it out of the step until it ends). */
  shellOutput(shellID: string, cursor: number, signal: AbortSignal): Promise<{ text: string; cursor: number }>;
}
function invalid(): never { throw new ConnectionError('incompatible'); }
function clip(value: string, max: number): string { return value.length > max ? value.slice(0, max - 1) + '…' : value; }
const printableOnly = (value: string) => [...value].filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('');
const when = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e15 ? Math.floor(n) : null;
const count = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 1e12) : 0;

/** Tools that act on one file (2.x argument `path`): their title is the project-relative path. */
const fileTools = new Set(['read', 'edit', 'write']);
/** Familiar argument shown as a step title, in order of preference. */
const titleKeys = ['path', 'command', 'pattern', 'url', 'query', 'description'];
/** Project-relative label (string comparison only; the controller does the real-path check). */
export function changeLabel(path: string, directory: string): string {
  const absolute = resolve(directory || '/', path);
  const inside = directory ? relative(directory, absolute) : '';
  const label = inside && !inside.startsWith('..') && !isAbsolute(inside) ? inside.split(sep).join('/') : basename(absolute);
  return clip(printableOnly(label) || 'file', limits.contextLabel);
}
function inputTitle(tool: string, input: Record<string, unknown>, directory: string): string {
  const key = titleKeys.find(name => typeof input[name] === 'string' && input[name]);
  if (key) return key === 'path' && fileTools.has(tool) ? changeLabel(input[key] as string, directory) : clip(input[key] as string, limits.toolTitle);
  if (!Object.keys(input).length) return '';
  try { return clip(JSON.stringify(input), limits.toolTitle); } catch { return ''; }
}
/** The first complete string value of a known argument in partial JSON (`{"path":"src/a.ts","content":"…`). */
export function partialTitle(tool: string, raw: string, directory: string): string {
  for (const key of titleKeys) {
    const match = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.){1,2000})"`).exec(raw.slice(0, 20000));
    if (!match) continue;
    let value: unknown;
    try { value = JSON.parse(`"${match[1]}"`); } catch { continue; }
    if (typeof value === 'string' && value) return inputTitle(tool, { [key]: value }, directory);
  }
  return '';
}
const toolStates: Record<string, ToolCall['status']> = { streaming: 'pending', running: 'running', completed: 'completed', error: 'error' };
const maxPatch = 2000000;
function display(source: ChangeSource, directory: string): FileChange {
  const stats = source.patch ? patchStats(source.patch) : undefined;
  return { label: changeLabel(source.path, directory), additions: stats?.additions ?? 0, deletions: stats?.deletions ?? 0, diff: !!stats };
}
/** First changed file recorded in tool or permission metadata (`files: [{ file, patch, status }]`, paths relative to the project). */
function metadataChange(metadata: unknown, directory: string): { change: FileChange; source: ChangeSource } | null {
  if (!record(metadata) || !Array.isArray(metadata.files)) return null;
  const file = metadata.files[0];
  if (!record(file) || typeof file.file !== 'string' || !file.file || typeof file.patch !== 'string' || file.patch.length > maxPatch) return null;
  const source = { path: resolve(directory || '/', file.file), patch: file.patch, created: file.status === 'added' };
  return { change: display(source, directory), source };
}
/**
 * A tool call of an assistant message: name, status, a short title and output/error
 * text only; never metadata, attachments or raw input objects.
 */
export function projectTool(part: Record<string, unknown>, directory = ''): { tool: ToolCall; source: ChangeSource | null } {
  const state = part.state;
  if (!identifier(part.id) || typeof part.name !== 'string' || !part.name || !record(state) || typeof state.status !== 'string' || !toolStates[state.status]) return invalid();
  const status = toolStates[state.status]!;
  const name = clip(part.name, limits.toolName);
  const title = typeof state.input === 'string' ? partialTitle(part.name, state.input, directory) : record(state.input) ? inputTitle(part.name, state.input, directory) : '';
  let detail = '';
  if (status === 'completed' || status === 'error') {
    const content = Array.isArray(state.content) ? state.content.filter(item => record(item) && item.type === 'text' && typeof item.text === 'string').map(item => (item as { text: string }).text).join('\n') : '';
    detail = status === 'error' && record(state.error) && typeof state.error.message === 'string' ? state.error.message : content;
  }
  const time = record(part.time) ? part.time : {};
  const found = status === 'completed' ? metadataChange(state.metadata, directory) : null;
  // `write` records no patch: offer "open" for the written file.
  const written = !found && status === 'completed' && part.name === 'write' && record(state.input) && typeof state.input.path === 'string' && state.input.path
    ? { path: resolve(directory || '/', state.input.path), patch: null, created: false } : null;
  const change = found?.change ?? (written ? display(written, directory) : null);
  return { tool: { id: part.id, tool: name, status, title, detail: clip(detail, limits.toolDetail), change, started: status === 'pending' ? null : when(time.ran) }, source: found?.source ?? written };
}
export function projectPermissions(value: unknown, sessionID: string, directory = '', reviews: Record<string, ChangeSource> = {}): PermissionPrompt[] {
  if (!Array.isArray(value)) return invalid();
  const strings = (items: unknown) => {
    if (items === undefined) return [];
    if (!Array.isArray(items) || !items.every(item => typeof item === 'string')) return invalid();
    return (items as string[]).slice(0, limits.patterns).map(item => clip(item, limits.pattern));
  };
  return value.filter(item => record(item) && item.sessionID === sessionID).slice(0, limits.permissions).map(item => {
    if (!identifier(item.id) || typeof item.action !== 'string' || !item.action) return invalid();
    const proposed = item.action === 'edit' ? metadataChange(item.metadata, directory) : null;
    if (proposed?.change.diff) reviews[item.id] = proposed.source;
    return { id: item.id, permission: clip(item.action, limits.toolName), patterns: strings(item.resources), always: strings(item.save), change: proposed?.change.diff ? proposed.change : null };
  });
}
/** Selectable agents only: `primary`/`all` and not hidden (subagents and internal agents are excluded). The ID is what is sent. */
export function projectAgents(value: unknown): AgentOption[] {
  if (!record(value) || !Array.isArray(value.data)) return invalid();
  return value.data.filter(item => record(item) && optionName(item.id) && (item.mode === 'primary' || item.mode === 'all') && item.hidden !== true).slice(0, limits.agents)
    .map(item => ({ name: item.id as string, description: typeof item.description === 'string' ? clip(item.description, limits.description) : '' }));
}
/** Enabled chat models; deprecated ones are left out. Provider settings (keys, URLs) are never read. */
export function projectModels(value: unknown): ModelOption[] {
  if (!record(value) || !Array.isArray(value.data)) return invalid();
  const models: ModelOption[] = [];
  for (const model of value.data) {
    if (!record(model) || !optionName(model.id) || !optionName(model.providerID) || model.enabled === false || model.status === 'deprecated' || (model.type !== undefined && model.type !== 'chat')) continue;
    const context = record(model.limit) && typeof model.limit.context === 'number' && Number.isInteger(model.limit.context) && model.limit.context > 0 && model.limit.context <= 1e12 ? model.limit.context : null;
    if (models.length < limits.models) models.push({ providerID: model.providerID, modelID: model.id, name: optionName(model.name) ? model.name : model.id, provider: model.providerID, context });
  }
  return models;
}
/**
 * Agent and model of a session or a reply (`agent`, `model { id, providerID }`). 2.x keeps
 * an explicit choice on the session; a session that never switched has none, so the
 * latest reply's (`fallback`) says what OpenCode used.
 */
export function sessionSelection(session: unknown, fallback?: unknown): Selection {
  const pick = (value: unknown): Selection => {
    if (!record(value)) return { agent: null, model: null };
    const model = value.model;
    return { agent: optionName(value.agent) ? value.agent : null, model: record(model) && optionName(model.providerID) && optionName(model.id) ? { providerID: model.providerID, modelID: model.id } : null };
  };
  const own = pick(session); const used = pick(fallback);
  return { agent: own.agent ?? used.agent, model: own.model ?? used.model };
}
/** Attachment chip of a prompt file: its name and kind only, never the URI or the (base64) contents. */
export function projectAttachment(file: Record<string, unknown>): Attachment {
  const kind = file.mime === 'application/x-directory' ? 'folder' : record(file.source) && file.source.type === 'inline' ? 'selection' : 'file';
  const label = typeof file.name === 'string' && file.name.trim() ? file.name : 'attachment';
  return { kind, label: clip(printableOnly(label) || 'attachment', limits.contextLabel) };
}
const anyFile = (rule: Record<string, unknown>) => rule.resource === '*';
/** Newest session rule for edits to any file; rules for specific patterns are ignored here. */
export function sessionEditRule(permissions: unknown): EditRule | null {
  if (!Array.isArray(permissions)) return null;
  const rule = [...permissions].reverse().find(item => record(item) && item.action === 'edit' && anyFile(item));
  return record(rule) && ['ask', 'allow', 'deny'].includes(String(rule.effect)) ? rule.effect as EditRule : null;
}
/**
 * The configuration's rule for edits (`permissions` of the config documents, later rules
 * win): a single effect, `mixed` when edits have per-path rules, or null (OpenCode default: allow).
 */
export function configEditPolicy(entries: unknown): EditPolicy {
  if (!Array.isArray(entries)) return null;
  const rules = entries.flatMap(entry => record(entry) && entry.type === 'document' && record(entry.info) && Array.isArray(entry.info.permissions) ? entry.info.permissions : []).filter(record);
  if (rules.some(rule => rule.action === 'edit' && !anyFile(rule))) return 'mixed';
  const rule = [...rules].reverse().find(rule => (rule.action === 'edit' || rule.action === '*') && anyFile(rule));
  return rule && ['ask', 'allow', 'deny'].includes(String(rule.effect)) ? rule.effect as EditRule : null;
}
export function sessionSummary(value: unknown, directory: string): SessionSummary {
  if (!record(value) || !identifier(value.id) || (value.title !== undefined && typeof value.title !== 'string') || !record(value.location) || value.location.directory !== directory) return invalid();
  return { id: value.id, title: typeof value.title === 'string' ? value.title.slice(0, 1000) : '', edit: sessionEditRule(value.permissions) };
}
const tokensOf = (t: unknown) => {
  if (!record(t)) return null;
  // Context ≈ everything the model saw plus what it produced (input, cached, output, reasoning).
  const context = Math.min(1e12, count(t.input) + count(t.output) + count(t.reasoning) + (record(t.cache) ? count(t.cache.read) + count(t.cache.write) : 0));
  return context + count(t.output) > 0 ? { context, output: count(t.output) } : null;
};
/** Live-text key shared with the event stream: message, kind and ordinal among parts of that kind. */
export const partKey = (messageID: string, kind: 'text' | 'reasoning', ordinal: number) => `${messageID}:${kind}:${ordinal}`;
/**
 * 2.x history items (oldest first): `user`, `assistant` (with `content`), `compaction`
 * and `idle` (how a run ended); switches and other bookkeeping items are not shown.
 * `active`: whether the session is still running (an unfinished reply is streaming, not stopped).
 */
export function projectMessages(value: unknown, directory = '', active = false): ProjectedMessage[] {
  if (!Array.isArray(value) || value.length > 1000) return invalid();
  const messages: ProjectedMessage[] = [];
  const base = (item: Record<string, unknown>) => ({ created: record(item.time) ? when(item.time.created) ?? 0 : 0 });
  // An unfinished reply ends with the next `idle` item's outcome.
  const outcomes = new Map<number, string>();
  let pending: number[] = [];
  value.forEach((item, index) => {
    if (!record(item)) return;
    if (item.type === 'assistant') pending.push(index);
    if (item.type === 'idle') { for (const at of pending) outcomes.set(at, String(item.outcome)); pending = []; }
  });
  let replied = false;
  value.forEach((item, index) => {
    if (!record(item) || !identifier(item.id) || typeof item.type !== 'string') return invalid();
    if (item.type === 'assistant' || item.type === 'compaction') replied = true;
    const id = item.id;
    const empty = { reasoning: '', otherParts: false, tools: [], attachments: [], tokens: null, kind: 'message' as const };
    if (item.type === 'user') {
      if (typeof item.text !== 'string' || item.text.length > 1000000) return invalid();
      const files = Array.isArray(item.files) ? item.files.filter(record).slice(0, limits.attachments).map(projectAttachment) : [];
      messages.push({ ...empty, id, role: 'user', text: item.text, attachments: files, time: { ...base(item), completed: null }, status: 'sent' });
    } else if (item.type === 'assistant') {
      if (!Array.isArray(item.content) || !record(item.time)) return invalid();
      const texts: { id: string; text: string }[] = []; const reasoning: { id: string; text: string }[] = []; const tools: ToolCall[] = []; const changes: Record<string, ChangeSource> = {}; let otherParts = false;
      for (const part of item.content) {
        if (!record(part) || typeof part.type !== 'string') return invalid();
        if (part.type === 'text' || part.type === 'reasoning') {
          if (typeof part.text !== 'string' || part.text.length > 1000000) return invalid();
          const list = part.type === 'text' ? texts : reasoning;
          list.push({ id: partKey(id, part.type, list.length), text: part.text });
        } else if (part.type === 'tool') {
          if (tools.length >= limits.tools) continue;
          const { tool, source } = projectTool(part, directory);
          if (source) changes[tool.id] = source;
          tools.push(tool);
        } else otherParts = true;
      }
      const text = texts.map(part => part.text).join('\n\n');
      if (text.length > 1000000) return invalid();
      const error = record(item.error) ? item.error : null;
      const outcome = outcomes.get(index);
      const completed = when(item.time.completed);
      const status: ChatMessage['status'] = error?.type === 'aborted' || (!completed && outcome === 'interrupted') ? 'stopped'
        : error || item.finish === 'error' || (!completed && outcome === 'failed') ? 'failed'
        : completed ? 'complete' : outcome || !active ? 'stopped' : 'streaming';
      messages.push({ id, role: 'assistant', text, reasoning: reasoning.map(part => part.text).join('\n\n').slice(0, limits.reasoning), reasoningParts: reasoning, parts: texts, otherParts, tools, attachments: [], changes, kind: 'message', time: { ...base(item), completed }, tokens: tokensOf(item.tokens), status });
    } else if (item.type === 'compaction') {
      // A divider, then the summary that replaces earlier context (folded in the view).
      messages.push({ ...empty, id, role: 'user', text: '', kind: 'compaction', time: { ...base(item), completed: null }, status: 'sent' });
      const summary = typeof item.summary === 'string' ? item.summary.slice(0, 1000000) : '';
      const status = item.status === 'completed' ? 'complete' : item.status === 'failed' ? 'failed' : active ? 'streaming' : 'stopped';
      messages.push({ ...empty, id: `${id}-summary`.slice(0, 128), role: 'assistant', text: summary, kind: status === 'failed' ? 'message' : 'summary', time: { ...base(item), completed: status === 'complete' ? base(item).created : null }, tokens: tokensOf(item.tokens), status });
    } else if (item.type === 'idle') {
      // A run that failed before any reply (an unavailable model, or an unknown agent, where
      // 2.3.0 does not even record the prompt) leaves only this: show it as a failed reply.
      if (item.outcome === 'failed' && !replied) messages.push({ ...empty, id, role: 'assistant', text: '', time: { ...base(item), completed: null }, status: 'failed' });
      replied = false;
    }
  });
  return messages;
}
export function createConversations(options: ConnectionOptions, fetcher: typeof fetch = fetch): ConversationApi {
  const api = createApi(options, fetcher);
  const directory = options.directory;
  const session = (id: string) => `/api/session/${segment(id)}`;
  async function get(id: string, signal: AbortSignal) {
    const value = await api.get(session(id), { signal });
    return record(value) && record(value.data) ? value.data : invalid();
  }
  return {
    async list(signal) {
      const value = await api.get('/api/session', { query: { directory, limit: 100 }, signal });
      if (!record(value) || !Array.isArray(value.data) || value.data.length > 100) return invalid();
      // Top-level, unarchived sessions of exactly this folder (subagent runs have a parent).
      return value.data.filter(item => record(item) && record(item.location) && item.location.directory === directory && item.parentID === undefined && !(record(item.time) && item.time.archived))
        .map(item => sessionSummary(item, directory));
    },
    async create(signal, ask = false) {
      const value = await api.post('/api/session', { body: { location: { directory }, ...(ask ? { permissions: [{ action: 'edit', resource: '*', effect: 'ask' }] } : {}) }, signal });
      return sessionSummary(record(value) ? value.data : undefined, directory);
    },
    async setEditRule(id, rule, signal) {
      const current = await get(id, signal);
      const others = Array.isArray(current.permissions) ? current.permissions.filter(item => record(item) && !(item.action === 'edit' && anyFile(item))) : [];
      await api.patch(session(id), { body: { permissions: [...others, { action: 'edit', resource: '*', effect: rule }] }, signal });
      return sessionSummary(await get(id, signal), directory);
    },
    async rename(id, title, signal) {
      await api.patch(session(id), { body: { title }, signal });
      return sessionSummary(await get(id, signal), directory);
    },
    async snapshot(id, limit, signal) {
      const [info, history, active, permissions, inbox] = await Promise.all([
        get(id, signal),
        api.get(`${session(id)}/message`, { query: { limit, order: 'desc' }, signal }),
        api.get('/api/session/active', { signal }),
        api.get(`${session(id)}/permission`, { signal }),
        api.get(`${session(id)}/inbox`, { signal }),
      ]);
      if (!record(history) || !Array.isArray(history.data) || !record(active) || !record(active.data) || !record(permissions) || !Array.isArray(permissions.data) || !record(inbox) || !Array.isArray(inbox.data)) return invalid();
      // A sent prompt waits in the inbox until its run starts: the session is busy then. A prompt
      // left from a run that already failed (2.3.0 keeps it for the next run) does not count.
      const ended = Math.max(0, ...history.data.filter(item => record(item) && item.type === 'idle' && record(item.time)).map(item => when((item as { time: { created?: unknown } }).time.created) ?? 0));
      const starting = inbox.data.some(item => record(item) && record(item.time) && (when(item.time.created) ?? 0) > ended);
      const running = record(active.data[id]) || starting;
      const messages = projectMessages([...history.data].reverse(), directory, running);
      // Show requests only while the session runs, so no Allow button is offered for an orphaned request.
      const reviews: Record<string, ChangeSource> = {};
      const pending = running ? projectPermissions(permissions.data, id, directory, reviews) : [];
      // OpenCode keeps retrying a failing provider with growing delays; the reply records why.
      const latest = [...history.data].find(item => record(item) && item.type === 'assistant');
      const retryInfo = running && record(latest) && !(record(latest.time) && latest.time.completed) && record(latest.retry) ? latest.retry : null;
      const retry = retryInfo && Number.isInteger(retryInfo.attempt) && typeof retryInfo.at === 'number'
        ? { attempt: Math.min(1000, Math.max(0, retryInfo.attempt as number)), message: record(retryInfo.error) && typeof retryInfo.error.message === 'string' ? clip(retryInfo.error.message, limits.retryMessage) : '', next: retryInfo.at } : null;
      const cursor = record(history.cursor) ? history.cursor.next : null;
      return { messages, permissions: pending, busy: running, waiting: pending.length > 0, hasMore: !!cursor && history.data.length >= limit && limit < 1000, used: sessionSelection(info, latest), reviews, retry };
    },
    async options(signal) {
      const query = locationQuery(directory);
      const [agents, models, config] = await Promise.all([api.get('/api/agent', { query, signal }), api.get('/api/model', { query, signal }), api.get('/api/config', { query, signal })]);
      return { agents: projectAgents(agents), models: projectModels(models), editPolicy: configEditPolicy(config) };
    },
    async compact(id, signal) {
      const value = await api.post(`${session(id)}/compact`, { body: {}, signal });
      if (!record(value)) return invalid();
    },
    async send(id, messageID, text, selection, signal, context = []) {
      // 2.x keeps agent and model on the session: switch only when the choice differs.
      // `null` keeps the session's own; values were checked against the latest lists.
      if (selection.agent || selection.model) {
        const current = sessionSelection(await get(id, signal));
        if (selection.agent && selection.agent !== current.agent) await api.post(`${session(id)}/agent`, { body: { agent: selection.agent }, signal });
        if (selection.model && (selection.model.providerID !== current.model?.providerID || selection.model.modelID !== current.model?.modelID)) await api.post(`${session(id)}/model`, { body: { model: { id: selection.model.modelID, providerID: selection.model.providerID } }, signal });
      }
      // Context parts were built and path-checked by the host from explicit user actions.
      const files = context.map(part => ({ uri: part.url, name: part.filename, ...(part.url.startsWith('data:') ? { source: { type: 'inline' } } : {}) }));
      const value = await api.post(`${session(id)}/prompt`, { body: { id: messageID, text, ...(files.length ? { files } : {}) }, signal });
      if (!record(value)) return invalid();
    },
    async stop(id, signal) {
      const value = await api.post(`${session(id)}/interrupt`, { body: undefined, signal });
      if (!record(value) || typeof value.interrupted !== 'boolean') return invalid();
    },
    async reply(sessionID, requestID, reply, signal) {
      await api.post(`${session(sessionID)}/permission/${segment(requestID)}/reply`, { body: { decision: reply }, signal });
    },
    async shellOutput(shellID, cursor, signal) {
      const value = await api.get(`/api/shell/${segment(shellID)}/output`, { query: { ...locationQuery(directory), cursor, limit: 65536 }, signal });
      const data = record(value) ? value.data : undefined;
      if (!record(data) || typeof data.output !== 'string' || typeof data.cursor !== 'number' || !Number.isInteger(data.cursor) || data.cursor < cursor) return invalid();
      // Only the newest end is ever shown; keep a little more so the view knows it was cut.
      return { text: data.output.slice(-(limits.toolDetail + 1)), cursor: data.cursor };
    },
  };
}
