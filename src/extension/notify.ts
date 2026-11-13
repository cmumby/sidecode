import type { ChatState } from '../shared/chat';

export type Notice = { kind: 'finished' | 'failed' | 'approval'; title: string };

/**
 * When to notify: a run in the same session ended (finished/failed) or started waiting
 * for approval, and the user cannot see the view (hidden, or the window unfocused).
 * Session switches, disconnects and Stop never notify.
 */
export function notice(previous: ChatState, next: ChatState, attention: boolean): Notice | null {
  if (attention || !next.selectedId || previous.selectedId !== next.selectedId) return null;
  const title = next.sessions.find(s => s.id === next.selectedId)?.title.slice(0, 80) ?? '';
  if (!previous.waiting && next.waiting) return { kind: 'approval', title };
  // (`loading` is still true in the snapshot update that clears `busy`, so it is not a condition.)
  if (previous.busy && !next.busy) {
    const last = next.messages.at(-1);
    if (!last || last.role !== 'assistant' || last.status === 'stopped') return null;
    return { kind: last.status === 'failed' ? 'failed' : 'finished', title };
  }
  return null;
}
