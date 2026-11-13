import test from 'node:test';
import assert from 'node:assert/strict';
import { notice } from '../src/extension/notify';
import { emptyChat, type ChatMessage, type ChatState } from '../src/shared/chat';

const reply = (status: ChatMessage['status']): ChatMessage => ({ id: 'msg_a', role: 'assistant', text: 'x', reasoning: '', status, otherParts: false, tools: [], attachments: [], time: { created: 1, completed: 2 }, tokens: null, kind: 'message' });
const state = (patch: Partial<ChatState>): ChatState => ({ ...emptyChat(), sessions: [{ id: 'ses_a', title: 'Fix the build', edit: null }], selectedId: 'ses_a', ...patch });

test('notifies only for finished, failed or approval-waiting runs the user cannot see', () => {
  const busy = state({ busy: true });
  assert.deepEqual(notice(busy, state({ messages: [reply('complete')] }), false), { kind: 'finished', title: 'Fix the build' });
  assert.deepEqual(notice(busy, state({ messages: [reply('failed')] }), false), { kind: 'failed', title: 'Fix the build' });
  assert.deepEqual(notice(busy, state({ busy: true, waiting: true }), false), { kind: 'approval', title: 'Fix the build' });
  assert.equal(notice(busy, state({ messages: [reply('complete')] }), true), null, 'visible and focused: no notification');
  assert.equal(notice(busy, state({ messages: [reply('stopped')] }), false), null, 'Stop is your own action');
  assert.equal(notice(busy, state({ selectedId: 'ses_b', messages: [reply('complete')] }), false), null, 'session switch');
  // Real update order from Chat.refresh: loading → snapshot (busy cleared, loading still true) → loading false.
  const refreshing = state({ busy: true, loading: true });
  const snapshot = state({ busy: false, loading: true, messages: [reply('complete')] });
  assert.deepEqual(notice(refreshing, snapshot, false)?.kind, 'finished', 'fires on the snapshot that ends the run');
  assert.equal(notice(snapshot, { ...snapshot, loading: false }, false), null, 'and only once');
  assert.equal(notice(state({}), state({ messages: [reply('complete')] }), false), null, 'was not running');
  assert.equal(notice(busy, emptyChat(), false), null, 'disconnect clears state');
});
