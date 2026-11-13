import { identifier, isChatState, isModelRef, optionName, permissionReplies, type ChatState, type ModelRef, type PermissionReply } from './chat';
import { errorMessages, phases, type ConnectionState } from './connection';
export const actions = ['ready', 'connect', 'disconnect', 'configure', 'credentials', 'clearCredentials', 'diagnostics'] as const;
export type ConnectionAction = typeof actions[number];
export type ChatCommand = { version: 1; type: 'refresh' | 'newSession' | 'older' } | { version: 1; type: 'selectSession' | 'stop' | 'compact'; sessionId: string } | { version: 1; type: 'send'; sessionId: string; text: string; requestId: string; agent: string | null; model: ModelRef | null }
  | { version: 1; type: 'permission'; sessionId: string; requestId: string; reply: PermissionReply }
  /** The host resolves context from the editor/workspace; the webview never supplies paths or content. */
  | { version: 1; type: 'addContext'; sessionId: string; source: typeof contextSources[number] }
  | { version: 1; type: 'removeContext'; sessionId: string; contextId: string }
  /** Opens IDE-native views for a change the host already holds; the webview names it only by ID. */
  | { version: 1; type: 'reviewPermission'; sessionId: string; requestId: string }
  /** Ask before file edits in this session (and, as the remembered default, in new sessions). */
  | { version: 1; type: 'editApproval'; sessionId: string; ask: boolean }
  | { version: 1; type: 'openChange'; sessionId: string; toolId: string; view: 'file' | 'diff' };
export const contextSources = ['activeFile', 'selection', 'workspace'] as const;
export type WebviewMessage = { version: 1; type: ConnectionAction } | ChatCommand;
export type HostMessage = { version: 1; type: 'connection'; state: ConnectionState } | { version: 1; type: 'chat'; state: ChatState };

function hasExactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}
export function isWebviewMessage(value: unknown): value is WebviewMessage {
  if (hasExactKeys(value, ['version', 'type'])) return value.version === 1 && [...actions, 'refresh', 'newSession', 'older'].some(action => action === value.type);
  if (hasExactKeys(value, ['version', 'type', 'sessionId'])) return value.version === 1 && ['selectSession', 'stop', 'compact'].includes(String(value.type)) && identifier(value.sessionId);
  if (hasExactKeys(value, ['version', 'type', 'sessionId', 'source'])) return value.version === 1 && value.type === 'addContext' && identifier(value.sessionId) && contextSources.some(s => s === value.source);
  if (hasExactKeys(value, ['version', 'type', 'sessionId', 'ask'])) return value.version === 1 && value.type === 'editApproval' && identifier(value.sessionId) && typeof value.ask === 'boolean';
  if (hasExactKeys(value, ['version', 'type', 'sessionId', 'requestId'])) return value.version === 1 && value.type === 'reviewPermission' && identifier(value.sessionId) && identifier(value.requestId);
  if (hasExactKeys(value, ['version', 'type', 'sessionId', 'toolId', 'view'])) return value.version === 1 && value.type === 'openChange' && identifier(value.sessionId) && identifier(value.toolId) && (value.view === 'file' || value.view === 'diff');
  if (hasExactKeys(value, ['version', 'type', 'sessionId', 'contextId'])) return value.version === 1 && value.type === 'removeContext' && identifier(value.sessionId) && identifier(value.contextId);
  if (hasExactKeys(value, ['version', 'type', 'sessionId', 'requestId', 'reply'])) return value.version === 1 && value.type === 'permission' && identifier(value.sessionId) && identifier(value.requestId) && permissionReplies.some(reply => reply === value.reply);
  return hasExactKeys(value, ['version', 'type', 'sessionId', 'text', 'requestId', 'agent', 'model']) && value.version === 1 && value.type === 'send' && identifier(value.sessionId) && identifier(value.requestId) && typeof value.text === 'string' && value.text.trim().length > 0 && value.text.length <= 32000
    && (value.agent === null || optionName(value.agent)) && (value.model === null || isModelRef(value.model));
}
export function isHostMessage(value: unknown): value is HostMessage {
  if (!hasExactKeys(value, ['version', 'type', 'state']) || value.version !== 1) return false;
  if (value.type === 'chat') return isChatState(value.state);
  if (value.type !== 'connection') return false;
  const state = value.state;
  return hasExactKeys(state, ['phase', 'attempt', 'error']) && phases.some((phase) => phase === state.phase)
    && typeof state.attempt === 'number' && Number.isInteger(state.attempt) && state.attempt >= 0 && state.attempt <= 3
    && (state.error === null || (typeof state.error === 'string' && Object.hasOwn(errorMessages, state.error)));
}
