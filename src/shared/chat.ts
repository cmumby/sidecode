export const editRules = ['ask', 'allow', 'deny'] as const;
export type EditRule = typeof editRules[number];
/** `edit`: the session's own rule for file edits (newest `edit` / `*` rule), or null if it has none. */
export interface SessionSummary { id: string; title: string; edit: EditRule | null }
/** The server configuration's rule for edits: a single action, `mixed` (per-pattern rules), or null (OpenCode default: allow). */
export type EditPolicy = EditRule | 'mixed' | null;
export const toolStatuses = ['pending', 'running', 'completed', 'error'] as const;
/** Display-only projection of an OpenCode tool part. Text is untrusted; render as plain text. */
/** Display summary of a file change. `diff` says whether a before/after view can be built. Paths stay in the host. */
export interface FileChange { label: string; additions: number; deletions: number; diff: boolean }
/** `started`: server time (epoch ms) the step began running; null while the model is still writing it. */
export interface ToolCall { id: string; tool: string; status: typeof toolStatuses[number]; title: string; detail: string; change: FileChange | null; started: number | null }
export const contextKinds = ['file', 'folder', 'selection'] as const;
export type ContextKind = typeof contextKinds[number];
/** Display label of an attachment recorded on a message (workspace-relative name, never a full path or content). */
export interface Attachment { kind: ContextKind; label: string }
/** Pending context for the next prompt; the host keeps the actual part, the webview only the label. */
export interface ContextItem extends Attachment { id: string; note: string }
export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; status: 'sent' | 'streaming' | 'complete' | 'failed' | 'stopped'; otherParts: boolean; tools: ToolCall[]; attachments: Attachment[]; reasoning: string;
  /** Server times (epoch ms). `completed` is null while unfinished and for your messages. */
  time: { created: number; completed: number | null };
  /** Assistant token use: `context` ≈ tokens the conversation occupied for this step; `output` = generated. */
  tokens: { context: number; output: number } | null;
  /** `compaction`: the marker OpenCode adds when the conversation is compacted; `summary`: the summary that replaces earlier context. */
  kind: 'message' | 'compaction' | 'summary' }
/** A pending OpenCode permission request for the selected session. Answered only by explicit user action. */
export interface PermissionPrompt { id: string; permission: string; patterns: string[]; always: string[]; change: FileChange | null }
/** Server-listed choices. Names come from the server and are rendered as plain text. */
export interface ModelRef { providerID: string; modelID: string }
export interface AgentOption { name: string; description: string }
/** `context`: the model's context window in tokens, when the server reports it. */
export interface ModelOption extends ModelRef { name: string; provider: string; context: number | null }
/** `null` omits the field so OpenCode decides. */
export interface Selection { agent: string | null; model: ModelRef | null }
export interface RetryStatus { attempt: number; message: string; next: number }
export const permissionReplies = ['once', 'always', 'reject'] as const;
export type PermissionReply = typeof permissionReplies[number];
export const chatErrors = {
  readFailed: 'Could not refresh the conversation. Retry loading when the connection is available.',
  sendUncertain: 'Delivery is uncertain. Refresh history before sending again; resending may duplicate the prompt.',
  createUncertain: 'Session creation could not be confirmed. Refresh the session list before creating another.',
  stopFailed: 'Could not confirm Stop. Refresh the conversation and try again.',
  replyUncertain: 'Could not confirm your permission answer. The request is still pending; answer it again or Stop.',
  optionUnavailable: 'The selected agent or model is no longer offered by the server. Choose another and send again.',
  sessionError: 'OpenCode reported an error for this session and may not have run the prompt. Check the agent, model and provider (details are in the OpenCode server log), then send again.',
  updateFailed: 'Could not confirm the change to edit approval. Refresh to see the current setting.',
  compactFailed: 'Could not confirm that the conversation was compacted. Refresh to see whether a summary was added before trying again.',
  sessionMissing: 'This session is no longer available in the selected project.',
  renameFailed: 'Could not confirm the new session name. Refresh to see the current name.',
} as const;
export const chatOperations = ['none', 'creating', 'sending', 'stopping', 'replying', 'compacting', 'updating', 'renaming'] as const;
export interface ChatState {
  sessions: SessionSummary[];
  selectedId: string | null;
  messages: ChatMessage[];
  permissions: PermissionPrompt[];
  /** Context attached to the selected session's next prompt. */
  context: ContextItem[];
  agents: AgentOption[];
  models: ModelOption[];
  /** Edit approval from the server configuration (see EditPolicy). */
  editPolicy: EditPolicy;
  /** OpenCode is retrying after a provider error (`message` is the provider's text: untrusted, plain text only). */
  retry: RetryStatus | null;
  /** Agent/model of the selected session's latest prompt, used as the initial selection. */
  used: Selection;
  busy: boolean;
  waiting: boolean;
  loading: boolean;
  operation: typeof chatOperations[number];
  error: keyof typeof chatErrors | null;
  submitted: string | null;
  hasMore: boolean;
}
export const limits = { sessionTitle: 200, toolName: 100, toolTitle: 500, toolDetail: 4000, tools: 200, agents: 50, models: 500, attachments: 50, context: 20, contextLabel: 300, contextNote: 200, selection: 100000, optionName: 200, description: 300, reasoning: 20000, retryMessage: 500, permissions: 20, patterns: 20, pattern: 500 } as const;
export function emptyChat(): ChatState { return { sessions: [], selectedId: null, messages: [], permissions: [], context: [], agents: [], models: [], retry: null, editPolicy: null, used: { agent: null, model: null }, busy: false, waiting: false, loading: false, operation: 'none', error: null, submitted: null, hasMore: false }; }
export function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function identifier(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value); }
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const exact = (value: Record<string, unknown>, count: number) => Object.keys(value).length === count;
/** Printable server names (agent, provider and model IDs may contain dots, slashes or colons). */
export function printable(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127); }
export function optionName(value: unknown): value is string { return printable(value, limits.optionName); }
export function isModelRef(value: unknown): value is ModelRef { return record(value) && exact(value, 2) && optionName(value.providerID) && optionName(value.modelID); }
export function isSelection(value: unknown): value is Selection {
  return record(value) && exact(value, 2) && (value.agent === null || optionName(value.agent)) && (value.model === null || isModelRef(value.model));
}
const isAttachment = (value: unknown, keys = 2): value is Attachment => record(value) && exact(value, keys) && contextKinds.some(k => k === value.kind) && printable(value.label, limits.contextLabel);
export function isContextItem(value: unknown): value is ContextItem { return record(value) && isAttachment(value, 4) && identifier(value.id) && text(value.note, limits.contextNote); }
const isAgentOption = (value: unknown) => record(value) && exact(value, 2) && optionName(value.name) && text(value.description, limits.description);
const count = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 1e12;
const isModelOption = (value: unknown) => record(value) && exact(value, 5) && optionName(value.providerID) && optionName(value.modelID) && optionName(value.name) && optionName(value.provider) && (value.context === null || count(value.context));
/** Epoch milliseconds (≈1.8e12 today), so a larger bound than token counts. */
const epoch = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 1e15;
const isMessageTime = (value: unknown) => record(value) && exact(value, 2) && epoch(value.created) && (value.completed === null || epoch(value.completed));
const isTokens = (value: unknown) => record(value) && exact(value, 2) && count(value.context) && count(value.output);
export function isFileChange(value: unknown): value is FileChange {
  const amount = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 1000000;
  return record(value) && exact(value, 4) && printable(value.label, limits.contextLabel) && amount(value.additions) && amount(value.deletions) && typeof value.diff === 'boolean';
}
export function isToolCall(value: unknown): value is ToolCall {
  return record(value) && exact(value, 7) && (value.started === null || (typeof value.started === 'number' && Number.isInteger(value.started) && value.started >= 0 && value.started <= 1e15)) && (value.change === null || isFileChange(value.change)) && identifier(value.id) && text(value.tool, limits.toolName) && value.tool.length > 0
    && toolStatuses.some(s => s === value.status) && text(value.title, limits.toolTitle) && text(value.detail, limits.toolDetail);
}
export function isPermissionPrompt(value: unknown): value is PermissionPrompt {
  const list = (items: unknown) => Array.isArray(items) && items.length <= limits.patterns && items.every(item => text(item, limits.pattern));
  return record(value) && exact(value, 5) && (value.change === null || isFileChange(value.change)) && identifier(value.id) && text(value.permission, limits.toolName) && value.permission.length > 0 && list(value.patterns) && list(value.always);
}
export function isChatState(value: unknown): value is ChatState {
  if (!record(value) || !exact(value, 17)) return false;
  return Array.isArray(value.sessions) && value.sessions.length <= 100 && value.sessions.every(s => record(s) && exact(s, 3) && identifier(s.id) && text(s.title, 1000) && (s.edit === null || editRules.some(r => r === s.edit)))
    && (value.selectedId === null || identifier(value.selectedId))
    && Array.isArray(value.messages) && value.messages.length <= 1000 && value.messages.every(m => record(m) && exact(m, 11) && ['message', 'compaction', 'summary'].includes(String(m.kind)) && text(m.reasoning, limits.reasoning) && isMessageTime(m.time) && (m.tokens === null || isTokens(m.tokens)) && identifier(m.id) && ['user', 'assistant'].includes(String(m.role)) && text(m.text, 1000000) && ['sent', 'streaming', 'complete', 'failed', 'stopped'].includes(String(m.status)) && typeof m.otherParts === 'boolean'
      && Array.isArray(m.tools) && m.tools.length <= limits.tools && m.tools.every(isToolCall) && Array.isArray(m.attachments) && m.attachments.length <= limits.attachments && m.attachments.every(a => isAttachment(a)))
    && Array.isArray(value.permissions) && value.permissions.length <= limits.permissions && value.permissions.every(isPermissionPrompt)
    && Array.isArray(value.context) && value.context.length <= limits.context && value.context.every(isContextItem)
    && Array.isArray(value.agents) && value.agents.length <= limits.agents && value.agents.every(isAgentOption)
    && Array.isArray(value.models) && value.models.length <= limits.models && value.models.every(isModelOption)
    && isSelection(value.used)
    && (value.editPolicy === null || value.editPolicy === 'mixed' || editRules.some(r => r === value.editPolicy))
    && (value.retry === null || (record(value.retry) && exact(value.retry, 3) && Number.isInteger(value.retry.attempt) && (value.retry.attempt as number) >= 0 && (value.retry.attempt as number) <= 1000
      && text(value.retry.message, limits.retryMessage) && typeof value.retry.next === 'number' && Number.isFinite(value.retry.next)))
    && typeof value.busy === 'boolean' && typeof value.waiting === 'boolean' && typeof value.loading === 'boolean' && typeof value.hasMore === 'boolean'
    && chatOperations.some(o => o === value.operation)
    && (value.error === null || (typeof value.error === 'string' && Object.hasOwn(chatErrors, value.error)))
    && (value.submitted === null || identifier(value.submitted));
}
/** A session name typed by the user: trimmed, one line, 1–200 characters (OpenCode itself accepts any length, and an empty title clears the name). */
export function sessionTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = [...value].map(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c).join('').replace(/ {2,}/g, ' ').trim();
  return title && title.length <= limits.sessionTitle ? title : null;
}
