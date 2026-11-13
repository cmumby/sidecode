import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { createApiClient, type ConnectionOptions } from './transport';
import { patchStats } from './patch';
import { ConnectionError } from './errors';
import { identifier, isModelRef, limits, optionName, record, toolStatuses, type AgentOption, type Attachment, type ChatMessage, type EditPolicy, type EditRule, type FileChange, type ModelRef, type ModelOption, type PermissionPrompt, type PermissionReply, type RetryStatus, type Selection, type SessionSummary, type ToolCall } from '../shared/chat';
/**
 * Host-only source of a file change: the server-side path and patch. Never crosses the
 * bridge; the controller re-checks the path against the project before opening anything.
 */
export interface ChangeSource { path: string; patch: string | null; created: boolean }
/** Host-only: text part IDs let live deltas overlay unfinished parts; tool change sources. Stripped before the bridge. */
export interface ProjectedMessage extends ChatMessage { parts?: { id: string; text: string }[]; reasoningParts?: { id: string; text: string }[]; changes?: Record<string, ChangeSource> }
export interface ConversationSnapshot { messages: ProjectedMessage[]; permissions: PermissionPrompt[]; reviews?: Record<string, ChangeSource>; busy: boolean; waiting: boolean; hasMore: boolean; used?: Selection; retry?: RetryStatus | null }
/** Host-only prompt part built by the extension from an explicit user action. Never crosses the bridge. */
export interface ContextPart { type: 'file'; mime: string; filename: string; url: string }
export interface ServerOptions { agents: AgentOption[]; models: ModelOption[]; editPolicy: EditPolicy }
export interface ConversationApi {
  list(signal: AbortSignal): Promise<SessionSummary[]>;
  /** `ask`: create the session with an `edit: ask` rule (the remembered default). */
  create(signal: AbortSignal, ask?: boolean): Promise<SessionSummary>;
  /** Adds an `edit` / `*` rule to the session (1.19.4 appends rules; the newest wins). */
  setEditRule(id: string, rule: 'ask' | 'allow', signal: AbortSignal): Promise<SessionSummary>;
  snapshot(id: string, limit: number, signal: AbortSignal): Promise<ConversationSnapshot>;
  options(signal: AbortSignal): Promise<ServerOptions>;
  /** OpenCode's own compaction (`session.summarize`); resolves once the summary exists. */
  compact(id: string, model: ModelRef | null, signal: AbortSignal): Promise<void>;
  send(id: string, messageID: string, text: string, selection: Selection, signal: AbortSignal, context?: ContextPart[]): Promise<void>;
  stop(id: string, signal: AbortSignal): Promise<void>;
  reply(requestID: string, reply: PermissionReply, signal: AbortSignal): Promise<void>;
}
function invalid(): never { throw new ConnectionError('incompatible'); }
function clip(value: string, max: number): string { return value.length > max ? value.slice(0, max - 1) + '…' : value; }
/** Only name, status, a short title and output/error text; never metadata, attachments or raw input objects. */
export function projectTool(part: Record<string, unknown>): ToolCall {
  const state = part.state;
  if (typeof part.tool !== 'string' || !part.tool || !record(state) || !toolStatuses.some(s => s === state.status)) return invalid();
  const status = state.status as ToolCall['status'];
  let title = typeof state.title === 'string' ? state.title : '';
  if (!title && record(state.input)) {
    // Before OpenCode supplies a title, prefer the familiar argument over raw input JSON.
    const input = state.input;
    const known = ['filePath', 'command', 'pattern', 'path', 'url'].map(key => input[key]).find((value): value is string => typeof value === 'string' && !!value);
    if (known) title = known;
    else if (Object.keys(input).length) { try { title = JSON.stringify(input); } catch { title = ''; } }
  }
  // Running tools may stream output in `metadata.output` (bash in 1.19.4); keep its newest end.
  const live = status === 'running' && record(state.metadata) && typeof state.metadata.output === 'string' ? state.metadata.output : '';
  const detail = status === 'completed' ? state.output : status === 'error' ? state.error : live;
  if (typeof detail !== 'string') return invalid();
  const shown = status === 'running' && detail.length > limits.toolDetail ? '…' + detail.slice(-(limits.toolDetail - 1)) : clip(detail, limits.toolDetail);
  const start = record(state.time) ? state.time.start : undefined;
  const started = typeof start === 'number' && Number.isFinite(start) && start >= 0 && start <= 1e15 ? Math.floor(start) : null;
  return { id: part.id as string, tool: clip(part.tool, limits.toolName), status, title: clip(title, limits.toolTitle), detail: shown, change: null, started };
}
const maxPatch = 2000000;
/** Project-relative label (string comparison only; the controller does the real-path check). */
export function changeLabel(path: string, directory: string): string {
  const absolute = resolve(directory || '/', path);
  const inside = directory ? relative(directory, absolute) : '';
  const label = inside && !inside.startsWith('..') && !isAbsolute(inside) ? inside.split(sep).join('/') : basename(absolute);
  return clip([...label].filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('') || 'file', limits.contextLabel);
}
function display(source: ChangeSource, directory: string, lines?: number): FileChange {
  const stats = source.patch ? patchStats(source.patch) : undefined;
  return { label: changeLabel(source.path, directory), additions: stats?.additions ?? lines ?? 0, deletions: stats?.deletions ?? 0, diff: !!stats || source.created };
}
/**
 * File change of a completed edit/write tool (1.19.4 metadata): `edit` carries
 * `filediff { file, patch }`; `write` carries `filepath` and `exists` (a new file can be
 * shown against empty; an overwrite has no patch, so only "open" is offered).
 */
export function toolChange(part: Record<string, unknown>, directory: string): { change: FileChange; source: ChangeSource } | null {
  const state = part.state;
  if (!record(state) || state.status !== 'completed' || !record(state.metadata)) return null;
  const metadata = state.metadata;
  if (record(metadata.filediff) && typeof metadata.filediff.file === 'string' && metadata.filediff.file && typeof metadata.filediff.patch === 'string' && metadata.filediff.patch.length <= maxPatch) {
    const source = { path: metadata.filediff.file, patch: metadata.filediff.patch, created: false };
    return { change: display(source, directory), source };
  }
  if (part.tool === 'write' && typeof metadata.filepath === 'string' && metadata.filepath) {
    const created = metadata.exists === false;
    const content = record(state.input) && typeof state.input.content === 'string' ? state.input.content : '';
    const source = { path: metadata.filepath, patch: null, created };
    return { change: display(source, directory, created && content ? content.split('\n').length - (content.endsWith('\n') ? 1 : 0) : 0), source };
  }
  return null;
}
/** Proposed edit attached to an `edit` permission request (`metadata.filepath` + unified `metadata.diff`). */
export function permissionChange(item: Record<string, unknown>, directory: string): { change: FileChange; source: ChangeSource } | null {
  const metadata = item.metadata;
  if (item.permission !== 'edit' || !record(metadata) || typeof metadata.filepath !== 'string' || !metadata.filepath || typeof metadata.diff !== 'string' || metadata.diff.length > maxPatch) return null;
  const source = { path: metadata.filepath, patch: metadata.diff, created: false };
  const change = display(source, directory);
  return change.diff ? { change, source } : null;
}
export function projectPermissions(value: unknown, sessionID: string, directory = '', reviews: Record<string, ChangeSource> = {}): PermissionPrompt[] {
  if (!Array.isArray(value)) return invalid();
  const strings = (items: unknown) => {
    if (!Array.isArray(items) || !items.every(item => typeof item === 'string')) return invalid();
    return (items as string[]).slice(0, limits.patterns).map(item => clip(item, limits.pattern));
  };
  return value.filter(item => record(item) && item.sessionID === sessionID).slice(0, limits.permissions).map(item => {
    if (!identifier(item.id) || typeof item.permission !== 'string' || !item.permission) return invalid();
    const proposed = permissionChange(item, directory);
    if (proposed) reviews[item.id] = proposed.source;
    return { id: item.id, permission: clip(item.permission, limits.toolName), patterns: strings(item.patterns), always: strings(item.always), change: proposed?.change ?? null };
  });
}
/** Selectable agents only: `primary`/`all` and not hidden (subagents and internal agents are excluded). */
export function projectAgents(value: unknown): AgentOption[] {
  if (!Array.isArray(value)) return invalid();
  return value.filter(item => record(item) && optionName(item.name) && (item.mode === 'primary' || item.mode === 'all') && item.hidden !== true).slice(0, limits.agents)
    .map(item => ({ name: item.name as string, description: typeof item.description === 'string' ? clip(item.description, limits.description) : '' }));
}
/** Models of the providers the server has configured; deprecated models are left out. */
export function projectModels(value: unknown): ModelOption[] {
  if (!record(value) || !Array.isArray(value.providers)) return invalid();
  const models: ModelOption[] = [];
  for (const provider of value.providers) {
    if (!record(provider) || !optionName(provider.id) || !record(provider.models)) continue;
    const label = optionName(provider.name) ? provider.name : provider.id;
    for (const [key, model] of Object.entries(provider.models)) {
      if (!record(model) || model.status === 'deprecated') continue;
      const id = typeof model.id === 'string' ? model.id : key;
      const context = record(model.limit) && typeof model.limit.context === 'number' && Number.isInteger(model.limit.context) && model.limit.context > 0 && model.limit.context <= 1e12 ? model.limit.context : null;
      if (optionName(id) && models.length < limits.models) models.push({ providerID: provider.id, modelID: id, name: optionName(model.name) ? model.name : id, provider: label, context });
    }
  }
  return models;
}
/** Agent/model recorded on the latest user message; unknown shapes become `null`. */
export function lastSelection(value: unknown): Selection {
  const latest = Array.isArray(value) ? [...value].reverse().find(item => record(item) && record(item.info) && item.info.role === 'user') : undefined;
  const info = record(latest) && record(latest.info) ? latest.info : {};
  return { agent: optionName(info.agent) ? info.agent : null, model: record(info.model) && isModelRef({ providerID: info.model.providerID, modelID: info.model.modelID }) ? { providerID: info.model.providerID as string, modelID: info.model.modelID as string } : null };
}
/** Attachment chip for a file part: its `filename` label and kind only, never the URL or contents. */
export function projectAttachment(part: Record<string, unknown>): Attachment {
  const url = typeof part.url === 'string' ? part.url : '';
  const kind = part.mime === 'application/x-directory' ? 'folder' : url.startsWith('data:') ? 'selection' : 'file';
  const label = typeof part.filename === 'string' && part.filename.trim() ? part.filename : 'attachment';
  return { kind, label: clip([...label].filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('') || 'attachment', limits.contextLabel) };
}
/** Newest session rule for edits to any file; rules for specific patterns are ignored here. */
export function sessionEditRule(permission: unknown): EditRule | null {
  if (!Array.isArray(permission)) return null;
  const rule = [...permission].reverse().find(item => record(item) && item.permission === 'edit' && item.pattern === '*');
  return rule && ['ask', 'allow', 'deny'].includes(String(rule.action)) ? rule.action as EditRule : null;
}
/** The configuration's `permission` (a single action, or per tool; `edit` may be per pattern). */
export function configEditPolicy(permission: unknown): EditPolicy {
  const action = (value: unknown) => ['ask', 'allow', 'deny'].includes(String(value)) ? value as EditRule : null;
  if (typeof permission === 'string') return action(permission);
  if (!record(permission)) return null;
  if (typeof permission.edit === 'string') return action(permission.edit);
  if (record(permission.edit)) return 'mixed';
  if (typeof permission['*'] === 'string') return action(permission['*']);
  return null;
}
export function sessionSummary(value: unknown, directory: string): SessionSummary {
  if (!record(value) || !identifier(value.id) || typeof value.title !== 'string' || value.directory !== directory) return invalid();
  return { id: value.id, title: value.title.slice(0, 1000), edit: sessionEditRule(value.permission) };
}
export function projectMessages(value: unknown, sessionID: string, directory = ''): ProjectedMessage[] {
  if (!Array.isArray(value) || value.length > 1000) return invalid();
  const messages = new Map<string, ProjectedMessage>();
  for (const item of value) {
    if (!record(item) || !record(item.info) || !Array.isArray(item.parts)) return invalid();
    const info = item.info;
    if (!identifier(info.id) || info.sessionID !== sessionID || !['user', 'assistant'].includes(String(info.role)) || !record(info.time)) return invalid();
    const parts = new Map<string, string>(); const reasoning = new Map<string, string>(); const tools = new Map<string, ToolCall>(); const attachments: Attachment[] = []; const changes: Record<string, ChangeSource> = {}; let otherParts = false; let compaction = false;
    for (const part of item.parts) {
      if (!record(part) || !identifier(part.id) || part.messageID !== info.id || part.sessionID !== sessionID || typeof part.type !== 'string') return invalid();
      if (part.type === 'text') {
        if (typeof part.text !== 'string' || part.text.length > 1000000) return invalid();
        if (!part.ignored && !part.synthetic) parts.set(part.id, part.text);
      } else if (part.type === 'reasoning') {
        if (typeof part.text !== 'string' || part.text.length > 1000000) return invalid();
        reasoning.set(part.id, part.text);
      } else if (part.type === 'tool') {
        if (tools.size < limits.tools) {
          const found = toolChange(part, directory);
          if (found) changes[part.id] = found.source;
          const tool = projectTool(part);
          // File steps: OpenCode's title is the full path without its leading slash, which is
          // cut off before the file name in a narrow view. Use the project-relative path.
          const state = part.state;
          const filePath = record(state) && record(state.input) && typeof state.input.filePath === 'string' && state.input.filePath ? state.input.filePath : null;
          tools.set(part.id, { ...tool, title: filePath ? changeLabel(filePath, directory) : tool.title, change: found?.change ?? null });
        }
      }
      else if (part.type === 'compaction') compaction = true;
      else if (part.type === 'file') { if (attachments.length < limits.attachments) attachments.push(projectAttachment(part)); }
      else if (!['step-start', 'step-finish'].includes(part.type)) otherParts = true;
    }
    const text = [...parts.values()].join('\n\n');
    if (text.length > 1000000) return invalid();
    const error = record(info.error) ? info.error.name : undefined;
    const when = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e15 ? Math.floor(n) : null;
    const time = { created: when(info.time.created) ?? 0, completed: when(info.time.completed) };
    // Context ≈ everything the model saw plus what it produced (input, cached, output, reasoning).
    const t = info.tokens;
    const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 1e12) : 0;
    const tokens = info.role === 'assistant' && record(t) ? { context: Math.min(1e12, n(t.input) + n(t.output) + n(t.reasoning) + (record(t.cache) ? n(t.cache.read) + n(t.cache.write) : 0)), output: n(t.output) } : null;
    const role = info.role as ChatMessage['role'];
    messages.set(info.id, { id: info.id, role, text, kind: compaction ? 'compaction' : role === 'assistant' && info.summary === true ? 'summary' : 'message', time, tokens: tokens && tokens.context + tokens.output > 0 ? tokens : null, reasoning: [...reasoning.values()].join('\n\n').slice(0, limits.reasoning), reasoningParts: [...reasoning].map(([id, text]) => ({ id, text })), otherParts, tools: [...tools.values()], attachments, changes, parts: [...parts].map(([id, text]) => ({ id, text })), status: role === 'user' ? 'sent' : error === 'MessageAbortedError' ? 'stopped' : info.error ? 'failed' : info.time.completed ? 'complete' : 'streaming' });
  }
  return [...messages.values()];
}
export function createConversations(options: ConnectionOptions): ConversationApi {
  const client = createApiClient(options);
  const directory = options.directory;
  return {
    async list(signal) {
      const { data } = await client.session.list({ directory, limit: 100 }, { signal });
      if (!Array.isArray(data) || data.length > 100) return invalid();
      // Directory selects the instance. Never use `path` as a synonym for directory.
      return data.filter(session => session.directory === directory).map(session => sessionSummary(session, directory));
    },
    async create(signal, ask = false) { return sessionSummary((await client.session.create({ directory, ...(ask ? { permission: [{ permission: 'edit', pattern: '*', action: 'ask' as const }] } : {}) }, { signal })).data, directory); },
    async setEditRule(sessionID, rule, signal) {
      return sessionSummary((await client.session.update({ directory, sessionID, permission: [{ permission: 'edit', pattern: '*', action: rule }] }, { signal })).data, directory);
    },
    async snapshot(sessionID, limit, signal) {
      const [history, statuses, permissions] = await Promise.all([
        client.session.messages({ directory, sessionID, limit }, { signal }),
        client.session.status({ directory }, { signal }),
        client.permission.list({ directory }, { signal }),
      ]);
      if (!record(statuses.data) || !Array.isArray(permissions.data)) return invalid();
      const status = statuses.data[sessionID];
      if (status !== undefined && (!record(status) || !['idle', 'busy', 'retry'].includes(String(status.type)))) return invalid();
      const messages = projectMessages(history.data, sessionID, directory);
      // 1.19.4 keeps a request listed after its session is aborted; the tool is already
      // cancelled. Show requests only while the session is active, so no Allow button
      // (especially Always) is ever offered for an orphaned request.
      const active = status !== undefined && status.type !== 'idle';
      const reviews: Record<string, ChangeSource> = {};
      const pending = active ? projectPermissions(permissions.data, sessionID, directory, reviews) : [];
      // `retry`: OpenCode keeps retrying a failing provider with growing delays; show why.
      const retry = status?.type === 'retry' && Number.isInteger(status.attempt) && typeof status.next === 'number'
        ? { attempt: Math.min(1000, Math.max(0, status.attempt as number)), message: typeof status.message === 'string' ? clip(status.message, limits.retryMessage) : '', next: status.next } : null;
      return { messages, permissions: pending, busy: active, waiting: pending.length > 0, hasMore: messages.length >= limit && limit < 1000, used: lastSelection(history.data), reviews, retry };
    },
    async options(signal) {
      const [agents, providers, config] = await Promise.all([client.app.agents({ directory }, { signal }), client.config.providers({ directory }, { signal }), client.config.get({ directory }, { signal })]);
      return { agents: projectAgents(agents.data), models: projectModels(providers.data), editPolicy: record(config.data) ? configEditPolicy(config.data.permission) : null };
    },
    async compact(sessionID, model, signal) {
      const { data } = await client.session.summarize({ directory, sessionID, ...(model ? { providerID: model.providerID, modelID: model.modelID } : {}) }, { signal });
      if (data !== true) return invalid();
    },
    async send(sessionID, messageID, text, selection, signal, context = []) {
      // `null` omits the field so the server decides; values were checked against the latest lists.
      // Context parts were built and path-checked by the host from explicit user actions.
      await client.session.promptAsync({ directory, sessionID, messageID, parts: [{ type: 'text', text }, ...context.map(part => ({ type: part.type, mime: part.mime, filename: part.filename, url: part.url }))],
        ...(selection.agent ? { agent: selection.agent } : {}), ...(selection.model ? { model: { providerID: selection.model.providerID, modelID: selection.model.modelID } } : {}) }, { signal });
    },
    async stop(sessionID, signal) {
      const { data } = await client.session.abort({ directory, sessionID }, { signal });
      if (data !== true) return invalid();
    },
    async reply(requestID, reply, signal) {
      const { data } = await client.permission.reply({ directory, requestID, reply }, { signal });
      if (data !== true) return invalid();
    },
  };
}
