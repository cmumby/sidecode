import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { Chat, type PendingContext } from '../src/adapter/chat';
import { projectAttachment, lastSelection, projectAgents, projectMessages, projectModels, projectPermissions, sessionSummary, type ConversationApi } from '../src/adapter/conversations';
import { emptyChat, isChatState, type ChatMessage } from '../src/shared/chat';
import { isHostMessage, isWebviewMessage } from '../src/shared/protocol';
const text = (id: string, content: string): ChatMessage => ({ id, role: 'assistant', text: content, status: 'complete', otherParts: false, tools: [], attachments: [], reasoning: '', time: { created: 1794537780961, completed: 1794537781509 }, tokens: null, kind: 'message' });
function api(patch: Partial<ConversationApi> = {}): ConversationApi {
  return { list: async () => [{ id: 'ses_a', title: 'A', edit: null }, { id: 'ses_b', title: 'B', edit: null }], create: async () => ({ id: 'ses_new', title: 'New', edit: null }), setEditRule: async (id, rule) => ({ id, title: 'A', edit: rule }), snapshot: async id => ({ permissions: [], messages: [text(`msg_${id}`, id)], busy: false, waiting: false, hasMore: false }), compact: async () => {}, options: async () => ({ agents: [{ name: 'build', description: '' }, { name: 'plan', description: 'Plan' }], models: [{ providerID: 'local', modelID: 'm/1.5', name: 'M', provider: 'Local', context: 32000 }], editPolicy: null }), send: async () => {}, stop: async () => {}, reply: async () => {}, ...patch };
}
async function setup(source: ConversationApi) { const chat = new Chat(1); chat.attach(source); chat.connection(true); await chat.refresh(); return chat; }

test('projection deduplicates IDs and omits server paths, tool payloads and errors', () => {
  const info = { id: 'msg_a', sessionID: 'ses_a', role: 'assistant', time: { completed: 1 }, path: '/private', error: { name: 'MessageAbortedError', data: { message: 'token' } } };
  const part = { id: 'prt_a', sessionID: 'ses_a', messageID: 'msg_a', type: 'text', text: '**Hello**' };
  const result = projectMessages([{ info, parts: [part, part, { ...part, id: 'prt_tool', type: 'tool', tool: 'bash', secret: 'token', state: { status: 'running', input: {}, title: 'ls', metadata: { secret: 'token' }, time: { start: 1 } } }] }, { info, parts: [part] }], 'ses_a');
  assert.equal(result.length, 1); assert.equal(result[0]?.text, '**Hello**'); assert.equal(result[0]?.status, 'stopped');
  assert.doesNotMatch(JSON.stringify(result), /private|\btoken\b/);
  assert.throws(() => projectMessages([{ info, parts: [{ ...part, sessionID: 'ses_other' }] }], 'ses_a'));
  assert.throws(() => sessionSummary({ id: 'ses_a', title: 'A', directory: '/other' }, '/project'));
});
test('session switching rejects stale history and unknown session IDs', async () => {
  let release!: (value: Awaited<ReturnType<ConversationApi['snapshot']>>) => void;
  let delayed = false;
  const chat = await setup(api({ snapshot: async id => delayed && id === 'ses_a' ? new Promise(resolve => { release = resolve; }) : ({ permissions: [], messages: [text(`msg_${id}`, id)], busy: false, waiting: false, hasMore: false }) }));
  try {
    delayed = true;
    const old = chat.refresh(); await pause(0);
    await chat.select('ses_b'); release({ permissions: [], messages: [text('msg_stale', 'wrong session')], busy: false, waiting: false, hasMore: false }); await old;
    assert.equal(chat.state.selectedId, 'ses_b'); assert.equal(chat.state.messages[0]?.text, 'ses_b');
    await chat.select('ses_unknown'); assert.equal(chat.state.selectedId, 'ses_b');
  } finally { chat.dispose(); }
});
test('event bursts and reconnect replace snapshots instead of accumulating duplicates', async () => {
  let snapshots = 0;
  const chat = await setup(api({ snapshot: async () => { snapshots++; return { permissions: [], messages: [text('msg_a', 'latest')], busy: false, waiting: false, hasMore: false }; } }));
  try {
    for (let n = 0; n < 100; n++) chat.event({ type: 'message.updated', properties: { sessionID: 'ses_a' } });
    await pause(20);
    assert.equal(snapshots, 2);
    for (let n = 0; n < 100; n++) chat.event({ type: 'message.part.delta', properties: { sessionID: 'ses_a', messageID: 'msg_x', partID: 'prt_x', field: 'text', delta: 'ignored' } });
    await pause(20);
    assert.equal(snapshots, 2, 'deltas never trigger history refreshes'); assert.equal(chat.state.messages.length, 1);
    chat.connection(false); chat.connection(true); await chat.refresh();
    assert.equal(chat.state.messages.length, 1); assert.equal(chat.state.messages[0]?.text, 'latest');
  } finally { chat.dispose(); }
});
test('a failed mutation is not retried automatically and raw errors stay private', async () => {
  let sends = 0;
  const chat = await setup(api({ send: async () => { sends++; throw new Error('secret prompt /private/token'); } }));
  try {
    await chat.send('ses_wrong', 'test', 'request'); assert.equal(sends, 0);
    await chat.send('ses_a', 'test', 'request');
    assert.equal(sends, 1); assert.equal(chat.state.error, 'sendUncertain');
    await chat.refresh(); assert.equal(sends, 1);
    assert.doesNotMatch(JSON.stringify(chat.state), /secret|private|\btoken\b/);
  } finally { chat.dispose(); }
});
test('busy sessions cannot submit another prompt; Stop targets the selected session', async () => {
  let sends = 0; let stopped: string | undefined;
  const chat = await setup(api({ snapshot: async () => ({ permissions: [], messages: [], busy: true, waiting: true, hasMore: false }), send: async () => { sends++; }, stop: async id => { stopped = id; } }));
  try {
    await chat.send('ses_a', 'test', 'request'); assert.equal(sends, 0);
    await chat.stop('ses_other'); assert.equal(stopped, undefined);
    await chat.stop('ses_a'); assert.equal(stopped, 'ses_a');
  } finally { chat.dispose(); }
});
test('disconnect clears project data and late mutation results cannot restore it', async () => {
  let finish!: () => void;
  const chat = await setup(api({ send: () => new Promise<void>(resolve => { finish = resolve; }) }));
  const sending = chat.send('ses_a', 'test', 'request'); chat.clear(); finish(); await sending;
  assert.deepEqual(chat.state, emptyChat()); chat.dispose();
});
test('protocol validates chat states and rejects arbitrary IDs, commands and oversized prompts', () => {
  assert.equal(isChatState(emptyChat()), true);
  assert.equal(isHostMessage({ version: 1, type: 'chat', state: emptyChat() }), true);
  const send = { version: 1, type: 'send', sessionId: 'ses_a', requestId: 'req_a', text: 'hello', agent: null, model: null };
  assert.equal(isWebviewMessage(send), true);
  assert.equal(isWebviewMessage({ ...send, agent: 'plan', model: { providerID: 'openrouter', modelID: 'vendor/model:free' } }), true);
  for (const value of [
    { ...send, sessionId: '../other' },
    { ...send, text: 'x'.repeat(32001) },
    { ...send, text: '  ' },
    { version: 1, type: 'send', sessionId: 'ses_a', requestId: 'req_a', text: 'hello' },
    { ...send, agent: '' }, { ...send, agent: 'a\nb' }, { ...send, agent: 'x'.repeat(201) },
    { ...send, model: { providerID: 'p' } }, { ...send, model: { providerID: 'p', modelID: 'm', options: {} } }, { ...send, model: 'p/m' },
    { version: 1, type: 'selectSession', sessionId: 'ses_a', credentials: 'bad' },
    { version: 1, type: 'approve', sessionId: 'ses_a' },
  ]) assert.equal(isWebviewMessage(value), false);
  assert.equal(isChatState({ ...emptyChat(), token: 'bad' }), false);
  assert.equal(isChatState({ ...emptyChat(), messages: [{ ...text('msg_a', 'hi'), path: '/private' }] }), false);
});

test('live deltas overlay unfinished text exactly and are dropped when unsafe or finished', async () => {
  const streaming = (body: string, status: ChatMessage['status'] = 'streaming') => ({ permissions: [], messages: [{ id: 'msg_a', role: 'assistant' as const, text: body, status, otherParts: false, tools: [], attachments: [], reasoning: '', time: { created: 1, completed: null }, tokens: null, kind: 'message' as const, parts: [{ id: 'prt_a', text: body }] }], busy: status === 'streaming', waiting: false, hasMore: false });
  let snap = streaming('');
  const chat = new Chat(1, 1); chat.attach(api({ snapshot: async () => snap })); chat.connection(true); await chat.refresh();
  const delta = (delta: string, extra: Record<string, unknown> = {}) => chat.event({ type: 'message.part.delta', properties: { sessionID: 'ses_a', messageID: 'msg_a', partID: 'prt_a', field: 'text', delta, ...extra } });
  try {
    delta('lost'); await pause(5);
    assert.equal(chat.state.messages[0]?.text, '', 'deltas before the part start are ignored');
    chat.event({ type: 'message.part.updated', properties: { sessionID: 'ses_a', part: { id: 'prt_a', messageID: 'msg_a', sessionID: 'ses_a', type: 'text', text: 'He' } } });
    delta('llo'); delta(' world'); delta('x', { sessionID: 'ses_b' }); delta('x', { field: 'reasoning' }); delta('x', { partID: 'prt_other' });
    await pause(10);
    assert.equal(chat.state.messages[0]?.text, 'Hello world');
    assert.equal(isChatState(chat.state), true, 'host-only part IDs never reach the bridge');
    await chat.refresh();
    assert.equal(chat.state.messages[0]?.text, 'Hello world', 'stale empty snapshot does not erase live text');
    chat.connection(false); chat.connection(true); await chat.refresh();
    assert.equal(chat.state.messages[0]?.text, '', 'overlay dropped on disconnect; snapshot wins');
    delta('!'); await pause(5);
    assert.equal(chat.state.messages[0]?.text, '', 'no resumption from a partial stream');
    chat.event({ type: 'message.part.updated', properties: { sessionID: 'ses_a', part: { id: 'prt_a', messageID: 'msg_a', sessionID: 'ses_a', type: 'text', text: 'Hello' } } });
    snap = streaming('Hello world.', 'complete'); await chat.refresh();
    assert.equal(chat.state.messages[0]?.text, 'Hello world.'); assert.equal(chat.state.messages[0]?.status, 'complete');
    delta(' extra'); await pause(5);
    assert.equal(chat.state.messages[0]?.text, 'Hello world.', 'finished messages ignore the overlay');
  } finally { chat.dispose(); }
});

test('tool parts project only name, status, title and clipped output; never metadata or raw objects', () => {
  const info = { id: 'msg_t', sessionID: 'ses_a', role: 'assistant', time: { completed: 1 } };
  const base = { sessionID: 'ses_a', messageID: 'msg_t', type: 'tool', callID: 'call_1', tool: 'bash', metadata: { secret: 'token' } };
  const [message] = projectMessages([{ info, parts: [
    { ...base, id: 'prt_1', state: { status: 'completed', input: { command: 'ls' }, title: 'ls', output: 'x'.repeat(5000), metadata: { secret: 'token' }, time: { start: 1, end: 2 } } },
    { ...base, id: 'prt_2', state: { status: 'running', input: { command: 'echo hi' }, time: { start: 1 } } },
    { ...base, id: 'prt_3', state: { status: 'error', input: {}, error: 'rejected', time: { start: 1, end: 2 } } },
  ] }], 'ses_a');
  assert.deepEqual(message?.tools.map(t => [t.tool, t.status, t.title]), [['bash', 'completed', 'ls'], ['bash', 'running', 'echo hi'], ['bash', 'error', '']]);
  assert.equal(message?.tools[0]?.detail.length, 4000); assert.equal(message?.tools[2]?.detail, 'rejected');
  assert.equal(message?.otherParts, false);
  assert.doesNotMatch(JSON.stringify(message), /\btoken\b|callID|metadata/);
  assert.throws(() => projectMessages([{ info, parts: [{ ...base, id: 'prt_4', state: { status: 'exploded' } }] }], 'ses_a'));
});
test('permission projection keeps only this session and the displayed fields', () => {
  const request = { id: 'per_a', sessionID: 'ses_a', permission: 'bash', patterns: ['rm -rf build'], always: ['rm *'], metadata: { secret: 'token' }, tool: { messageID: 'msg_a', callID: 'call_a' } };
  const result = projectPermissions([request, { ...request, id: 'per_b', sessionID: 'ses_b' }], 'ses_a');
  assert.deepEqual(result, [{ id: 'per_a', permission: 'bash', patterns: ['rm -rf build'], always: ['rm *'], change: null }]);
  assert.throws(() => projectPermissions([{ ...request, id: '../x' }], 'ses_a'));
  assert.throws(() => projectPermissions([{ ...request, patterns: [1] }], 'ses_a'));
});
test('permission replies are explicit, limited to shown requests, never retried, and errors clear once answered', async () => {
  const replies: string[] = []; let fail = false;
  let pending = [{ id: 'per_a', permission: 'bash', patterns: ['ls'], always: ['ls *'], change: null }];
  const chat = await setup(api({
    snapshot: async () => ({ messages: [], permissions: pending, busy: true, waiting: pending.length > 0, hasMore: false }),
    reply: async (id, reply) => { replies.push(`${id}:${reply}`); if (fail) throw new Error('secret /private'); },
  }));
  try {
    assert.equal(chat.state.permissions.length, 1); assert.equal(chat.state.waiting, true);
    for (let n = 0; n < 50; n++) chat.event({ type: 'permission.asked', properties: { sessionID: 'ses_a' } });
    await pause(10); assert.deepEqual(replies, [], 'events never answer permissions');
    await chat.reply('ses_b', 'per_a', 'once'); await chat.reply('ses_a', 'per_unknown', 'once');
    assert.deepEqual(replies, [], 'wrong session or unknown request ignored');
    fail = true; await chat.reply('ses_a', 'per_a', 'always');
    assert.deepEqual(replies, ['per_a:always']); assert.equal(chat.state.error, 'replyUncertain');
    assert.doesNotMatch(JSON.stringify(chat.state), /secret|private/);
    await chat.refresh(); assert.equal(chat.state.error, 'replyUncertain', 'kept while still pending');
    assert.deepEqual(replies, ['per_a:always'], 'not retried automatically');
    pending = []; await chat.refresh();
    assert.equal(chat.state.error, null, 'cleared once the request is gone'); assert.equal(chat.state.waiting, false);
    pending = [{ id: 'per_b', permission: 'edit', patterns: [], always: [], change: null }]; fail = false; await chat.refresh();
    await chat.reply('ses_a', 'per_b', 'reject');
    assert.deepEqual(replies, ['per_a:always', 'per_b:reject']); assert.deepEqual(chat.state.permissions, []);
  } finally { chat.dispose(); }
});
test('protocol accepts only well-formed permission replies', () => {
  assert.equal(isWebviewMessage({ version: 1, type: 'permission', sessionId: 'ses_a', requestId: 'per_a', reply: 'once' }), true);
  for (const value of [
    { version: 1, type: 'permission', sessionId: 'ses_a', requestId: 'per_a', reply: 'yes' },
    { version: 1, type: 'permission', sessionId: 'ses_a', requestId: 'per_a', reply: 'once', message: 'x' },
    { version: 1, type: 'permission', sessionId: 'ses_a', requestId: '../a', reply: 'once' },
    { version: 1, type: 'permission', sessionId: 'ses_a', reply: 'always' },
  ]) assert.equal(isWebviewMessage(value), false);
  const state = { ...emptyChat(), permissions: [{ id: 'per_a', permission: 'bash', patterns: ['ls'], always: [], change: null }] };
  assert.equal(isChatState(state), true);
  assert.equal(isChatState({ ...state, permissions: [{ ...state.permissions[0], metadata: {} }] }), false);
  assert.equal(isChatState({ ...emptyChat(), messages: [{ ...text('msg_a', 'x'), tools: [{ id: 'prt_a', tool: 'bash', status: 'running', title: '', detail: '', change: null, input: {} }] }] }), false);
});

test('agent and model lists keep only selectable, bounded entries', () => {
  const agents = projectAgents([
    { name: 'build', mode: 'primary', native: true, description: 'Default', permission: [{ secret: 'x' }] },
    { name: 'title', mode: 'primary', hidden: true }, { name: 'explore', mode: 'subagent' },
    { name: 'custom', mode: 'all', hidden: null }, { name: 'bad\nname', mode: 'primary' }, { mode: 'primary' },
  ]);
  assert.deepEqual(agents, [{ name: 'build', description: 'Default' }, { name: 'custom', description: '' }]);
  const models = projectModels({ default: { local: 'b' }, providers: [
    { id: 'local', name: 'Local', options: { apiKey: 'secret' }, models: { a: { id: 'a', name: 'A', status: 'active', cost: {} }, old: { id: 'old', name: 'Old', status: 'deprecated' }, b: { name: 'B' } } },
    { id: 'bare', models: { 'vendor/m:free': { id: 'vendor/m:free' } } }, { name: 'missing id', models: { z: {} } },
  ] });
  assert.deepEqual(models, [
    { providerID: 'local', modelID: 'a', name: 'A', provider: 'Local', context: null }, { providerID: 'local', modelID: 'b', name: 'B', provider: 'Local', context: null },
    { providerID: 'bare', modelID: 'vendor/m:free', name: 'vendor/m:free', provider: 'bare', context: null },
  ]);
  assert.doesNotMatch(JSON.stringify(models), /secret/);
  assert.throws(() => projectAgents({})); assert.throws(() => projectModels([]));
  const many = projectModels({ providers: [{ id: 'p', models: Object.fromEntries(Array.from({ length: 600 }, (_, n) => [`m${n}`, {}])) }] });
  assert.equal(many.length, 500);
  assert.equal(isChatState({ ...emptyChat(), agents, models }), true);
  assert.equal(isChatState({ ...emptyChat(), models: [{ ...models[0], apiKey: 'x' }] }), false);
});
test('the last user message supplies the initial selection', () => {
  const user = (agent: unknown, model: unknown) => ({ info: { role: 'user', agent, model }, parts: [] });
  assert.deepEqual(lastSelection([user('plan', { providerID: 'p', modelID: 'm' }), { info: { role: 'assistant', agent: 'build' }, parts: [] }]), { agent: 'plan', model: { providerID: 'p', modelID: 'm' } });
  assert.deepEqual(lastSelection([user('plan', null), user(42, { providerID: 'p', modelID: 'm', extra: 1 })]), { agent: null, model: { providerID: 'p', modelID: 'm' } });
  assert.deepEqual(lastSelection(undefined), { agent: null, model: null });
});
test('only listed agents and models are sent; options load on connect', async () => {
  const sent: unknown[] = [];
  const chat = await setup(api({ send: async (_id, _message, _text, selection) => { sent.push(selection); } }));
  try {
    await pause(5);
    assert.deepEqual(chat.state.agents.map(a => a.name), ['build', 'plan']); assert.equal(chat.state.models.length, 1);
    await chat.send('ses_a', 'hi', 'req_1', { agent: 'nope', model: null });
    assert.equal(chat.state.error, 'optionUnavailable'); assert.equal(sent.length, 0);
    await chat.send('ses_a', 'hi', 'req_2', { agent: null, model: { providerID: 'local', modelID: 'other' } });
    assert.equal(sent.length, 0);
    await chat.send('ses_a', 'hi', 'req_3', { agent: 'plan', model: { providerID: 'local', modelID: 'm/1.5' } });
    assert.deepEqual(sent, [{ agent: 'plan', model: { providerID: 'local', modelID: 'm/1.5' } }]); assert.equal(chat.state.error, null);
  } finally { chat.dispose(); }
});
test('a failed options load keeps the previous lists', async () => {
  let fail = false;
  const chat = await setup(api({ options: async () => { if (fail) throw new Error('/private'); return { agents: [{ name: 'build', description: '' }], models: [], editPolicy: null }; } }));
  try {
    await pause(5); fail = true; await chat.loadOptions();
    assert.deepEqual(chat.state.agents, [{ name: 'build', description: '' }]); assert.equal(chat.state.error, null);
  } finally { chat.dispose(); }
});
test('session.error for the selected session shows a fixed message; Stop and other sessions do not', async () => {
  let messages: ChatMessage[] = [];
  const chat = await setup(api({ snapshot: async () => ({ permissions: [], messages, busy: false, waiting: false, hasMore: false }) }));
  try {
    chat.event({ type: 'session.error', properties: { sessionID: 'ses_b', error: { name: 'UnknownError' } } });
    chat.event({ type: 'session.error', properties: { sessionID: 'ses_a', error: { name: 'MessageAbortedError' } } });
    assert.equal(chat.state.error, null);
    chat.event({ type: 'session.error', properties: { sessionID: 'ses_a', error: { name: 'UnknownError', data: { message: 'Agent not found at /private/path' } } } });
    assert.equal(chat.state.error, 'sessionError'); assert.doesNotMatch(JSON.stringify(chat.state), /private/);
    await chat.refresh(); assert.equal(chat.state.error, 'sessionError', 'kept while no reply explains it');
    messages = [{ ...text('msg_a', ''), status: 'failed' }];
    await chat.refresh(); assert.equal(chat.state.error, null, 'a failed reply already shows the failure');
  } finally { chat.dispose(); }
});
test('the snapshot selection is exposed and reset on session change', async () => {
  const chat = await setup(api({ snapshot: async id => ({ permissions: [], messages: [], busy: false, waiting: false, hasMore: false, used: id === 'ses_a' ? { agent: 'plan', model: null } : { agent: null, model: null } }) }));
  try {
    assert.deepEqual(chat.state.used, { agent: 'plan', model: null });
    await chat.select('ses_b'); assert.deepEqual(chat.state.used, { agent: null, model: null });
  } finally { chat.dispose(); }
});

const ids = (chat: Chat) => chat.state.context.map(item => item.id);
const ctx = (id: string, url = `file:///p/${id}.ts`): PendingContext => ({ item: { id, kind: 'file', label: `${id}.ts`, note: '' }, part: { type: 'file', mime: 'text/plain', filename: `${id}.ts`, url } });
test('file parts become attachment labels without URLs or contents', () => {
  const info = { id: 'msg_u', sessionID: 'ses_a', role: 'user', time: {} };
  const base = { sessionID: 'ses_a', messageID: 'msg_u', type: 'file' };
  const [message] = projectMessages([{ info, parts: [
    { ...base, id: 'prt_1', mime: 'text/plain', filename: 'src/a.ts', url: 'file:///home/me/private/src/a.ts' },
    { ...base, id: 'prt_2', mime: 'application/x-directory', filename: 'src', url: 'file:///home/me/private/src' },
    { ...base, id: 'prt_3', mime: 'text/plain', filename: 'a.ts:5-7', url: 'data:text/plain;base64,c2VjcmV0' },
    { ...base, id: 'prt_4', mime: 'text/plain', url: 'file:///x' },
    { id: 'prt_5', sessionID: 'ses_a', messageID: 'msg_u', type: 'text', text: '<content>secret</content>', synthetic: true },
  ] }], 'ses_a');
  assert.deepEqual(message?.attachments, [{ kind: 'file', label: 'src/a.ts' }, { kind: 'folder', label: 'src' }, { kind: 'selection', label: 'a.ts:5-7' }, { kind: 'file', label: 'attachment' }]);
  assert.equal(message?.otherParts, false); assert.equal(message?.text, '');
  assert.doesNotMatch(JSON.stringify(message), /private|base64|secret/);
  assert.equal(projectAttachment({ filename: 'a\u0000b' + 'x'.repeat(400), url: '' }).label.length, 300);
});
test('protocol accepts only well-formed context commands and items', () => {
  assert.equal(isWebviewMessage({ version: 1, type: 'addContext', sessionId: 'ses_a', source: 'selection' }), true);
  assert.equal(isWebviewMessage({ version: 1, type: 'removeContext', sessionId: 'ses_a', contextId: 'ctx_1' }), true);
  for (const value of [
    { version: 1, type: 'addContext', sessionId: 'ses_a', source: '/etc/passwd' },
    { version: 1, type: 'addContext', sessionId: 'ses_a', source: 'activeFile', path: '/etc/passwd' },
    { version: 1, type: 'removeContext', sessionId: 'ses_a', contextId: '../x' },
  ]) assert.equal(isWebviewMessage(value), false);
  const item = { id: 'ctx_1', kind: 'file', label: 'src/a.ts', note: '' };
  assert.equal(isChatState({ ...emptyChat(), context: [item] }), true);
  assert.equal(isChatState({ ...emptyChat(), context: [{ ...item, url: 'file:///x' }] }), false);
  assert.equal(isChatState({ ...emptyChat(), context: [{ ...item, kind: 'url' }] }), false);
});
test('context is per session, deduplicated, capped and sent once with the next prompt', async () => {
  const sent: unknown[][] = [];
  let fail = false;
  const chat = await setup(api({ send: async (_id, _m, _t, _s, _signal, context = []) => { if (fail) throw new Error('x'); sent.push(context); } }));
  try {
    assert.equal(chat.addContext('ses_b', [ctx('a')]), 0, 'only the selected session');
    assert.equal(chat.addContext('ses_a', [ctx('a'), ctx('a2', 'file:///p/a.ts'), ctx('b')]), 2, 'same URL attached once');
    assert.deepEqual(chat.state.context.map(i => i.id), ['a', 'b']);
    assert.doesNotMatch(JSON.stringify(chat.state), /file:\/\//, 'URLs stay in the host');
    chat.removeContext('ses_a', 'b'); assert.deepEqual(chat.state.context.map(i => i.id), ['a']);
    assert.equal(chat.addContext('ses_a', Array.from({ length: 30 }, (_, n) => ctx(`c${n}`))), 19);
    chat.removeContext('ses_a', 'a'); for (let n = 1; n < 19; n++) chat.removeContext('ses_a', `c${n}`);
    await chat.select('ses_b'); assert.deepEqual(chat.state.context, []);
    await chat.select('ses_a'); assert.deepEqual(ids(chat), ['c0'], 'kept per session');
    fail = true; await chat.send('ses_a', 'hi', 'req_1');
    assert.equal(chat.state.error, 'sendUncertain'); assert.equal(chat.state.context.length, 1, 'kept after an uncertain send');
    fail = false; await chat.send('ses_a', 'hi', 'req_2');
    assert.deepEqual(sent, [[{ type: 'file', mime: 'text/plain', filename: 'c0.ts', url: 'file:///p/c0.ts' }]]);
    assert.deepEqual(chat.state.context, [], 'cleared after a confirmed send');
    chat.addContext('ses_a', [ctx('d')]); chat.clear(); assert.deepEqual(chat.state.context, []);
  } finally { chat.dispose(); }
});

test('running tools are titled by their main argument before OpenCode supplies a title', async () => {
  const { projectTool } = await import('../src/adapter/conversations');
  const running = (input: unknown) => projectTool({ id: 'prt_a', tool: 'edit', state: { status: 'running', input, time: { start: 1 } } }).title;
  assert.equal(running({ filePath: 'src/a.ts', oldString: 'secret old', newString: 'x' }), 'src/a.ts');
  assert.equal(running({ command: 'npm test', description: 'Run tests' }), 'npm test');
  assert.equal(running({ other: 1 }), '{"other":1}');
});

test('reasoning is projected and streamed live; running tools show their newest output', () => {
  const info = { id: 'msg_r', sessionID: 'ses_a', role: 'assistant', time: {} };
  const base = { sessionID: 'ses_a', messageID: 'msg_r' };
  const [message] = projectMessages([{ info, parts: [
    { ...base, id: 'prt_r', type: 'reasoning', text: 'Considering the question.', time: { start: 1 } },
    { ...base, id: 'prt_b', type: 'tool', tool: 'bash', state: { status: 'running', input: { command: 'npm test' }, metadata: { output: 'x'.repeat(5000) + '\nlast line' }, time: { start: 1 } } },
  ] }], 'ses_a');
  assert.equal(message?.reasoning, 'Considering the question.'); assert.equal(message?.otherParts, false);
  const detail = message!.tools[0]!.detail;
  assert.equal(detail.length, 4000); assert.ok(detail.startsWith('…') && detail.endsWith('last line'), 'newest output kept');
});
test('live reasoning deltas overlay an unfinished reasoning part', async () => {
  const streaming = { permissions: [], messages: [{ id: 'msg_a', role: 'assistant' as const, text: '', reasoning: '', status: 'streaming' as const, otherParts: false, tools: [], attachments: [], time: { created: 1, completed: null }, tokens: null, kind: 'message' as const, parts: [], reasoningParts: [{ id: 'prt_r', text: '' }] }], busy: true, waiting: false, hasMore: false };
  const chat = await setup(api({ snapshot: async () => streaming }));
  try {
    chat.event({ type: 'message.part.updated', properties: { sessionID: 'ses_a', part: { id: 'prt_r', messageID: 'msg_a', sessionID: 'ses_a', type: 'reasoning', text: '' } } });
    for (const delta of ['Thinking ', 'hard.']) chat.event({ type: 'message.part.delta', properties: { sessionID: 'ses_a', messageID: 'msg_a', partID: 'prt_r', field: 'text', delta } });
    await pause(80);
    assert.equal(chat.state.messages[0]?.reasoning, 'Thinking hard.'); assert.equal(chat.state.messages[0]?.text, '');
    assert.doesNotMatch(JSON.stringify(chat.state), /reasoningParts|prt_r/);
  } finally { chat.dispose(); }
});
test('retry status is validated as plain data', () => {
  assert.equal(isChatState({ ...emptyChat(), retry: { attempt: 3, message: 'model not loaded', next: 1794532858842 } }), true);
  assert.equal(isChatState({ ...emptyChat(), retry: { attempt: 3, message: 'x'.repeat(501), next: 1 } }), false);
  assert.equal(isChatState({ ...emptyChat(), retry: { attempt: 3, message: '', next: 1, raw: {} } }), false);
});

test('a queued tool with empty input has no placeholder title', async () => {
  const { projectTool } = await import('../src/adapter/conversations');
  assert.equal(projectTool({ id: 'prt_a', tool: 'edit', state: { status: 'pending', input: {}, raw: '' } }).title, '');
});

test('message timing, token use and model context size are projected as plain numbers', () => {
  const info = { id: 'msg_a', sessionID: 'ses_a', role: 'assistant', time: { created: 1000, completed: 61000 }, tokens: { total: 9, input: 3000, output: 450, reasoning: 50, cache: { read: 25000, write: 500 } }, cost: 0.5 };
  const [message] = projectMessages([{ info, parts: [] }], 'ses_a');
  assert.deepEqual(message?.time, { created: 1000, completed: 61000 });
  assert.deepEqual(message?.tokens, { context: 29000, output: 450 });
  const [user] = projectMessages([{ info: { id: 'msg_u', sessionID: 'ses_a', role: 'user', time: { created: 5 } }, parts: [] }], 'ses_a');
  assert.deepEqual([user?.time, user?.tokens], [{ created: 5, completed: null }, null]);
  const [bad] = projectMessages([{ info: { ...info, tokens: { input: -5, output: 'x' }, time: { created: 'soon' } }, parts: [] }], 'ses_a');
  assert.deepEqual([bad?.time.created, bad?.tokens], [0, null], 'invalid numbers are ignored');
  assert.deepEqual(projectModels({ providers: [{ id: 'lm', models: { q: { name: 'Q', limit: { context: 32768, output: 4096 } }, r: { limit: { context: -1 } } } }] }).map(m => m.context), [32768, null]);
});

test('compaction markers and summaries are recognised; compact is explicit and waits long', async () => {
  const base = { sessionID: 'ses_a' };
  const messages = projectMessages([
    { info: { id: 'msg_c', ...base, role: 'user', time: { created: 1 } }, parts: [{ id: 'prt_c', ...base, messageID: 'msg_c', type: 'compaction', auto: false }] },
    { info: { id: 'msg_s', ...base, role: 'assistant', summary: true, mode: 'compaction', time: { created: 2, completed: 3 } }, parts: [{ id: 'prt_s', ...base, messageID: 'msg_s', type: 'text', text: 'Summary of the work so far.' }] },
  ], 'ses_a');
  assert.deepEqual(messages.map(m => [m.kind, m.otherParts]), [['compaction', false], ['summary', false]]);
  assert.equal(isWebviewMessage({ version: 1, type: 'compact', sessionId: 'ses_a' }), true);
  let calls = 0; let model: unknown = 'unset';
  const chat = await setup(api({ compact: async (_id, m) => { calls++; model = m; }, snapshot: async () => ({ permissions: [], messages: [], busy: false, waiting: false, hasMore: false, used: { agent: 'build', model: { providerID: 'local', modelID: 'm/1.5' } } }) }));
  try {
    await pause(5);
    await chat.compact('ses_b'); assert.equal(calls, 0, 'only the selected session');
    await chat.compact('ses_a'); assert.equal(calls, 1); assert.deepEqual(model, { providerID: 'local', modelID: 'm/1.5' }, 'uses the session model when listed');
    assert.equal(chat.state.operation, 'none');
  } finally { chat.dispose(); }
});

test('real epoch-millisecond timestamps pass validation', () => {
  const message = { id: 'msg_a', role: 'assistant', text: 'x', reasoning: '', status: 'complete', otherParts: false, tools: [], attachments: [], time: { created: Date.now(), completed: Date.now() + 1000 }, tokens: { context: 20, output: 10 }, kind: 'message' };
  assert.equal(isChatState({ ...emptyChat(), messages: [message] }), true);
  assert.equal(isChatState({ ...emptyChat(), messages: [{ ...message, time: { created: 1.5, completed: null } }] }), false);
});

test('edit approval: rules are read from sessions and config; a config that asks is never relaxed', async () => {
  const { sessionEditRule, configEditPolicy } = await import('../src/adapter/conversations');
  assert.equal(sessionEditRule([{ permission: 'edit', pattern: '*', action: 'ask' }, { permission: 'bash', pattern: '*', action: 'ask' }, { permission: 'edit', pattern: '*', action: 'allow' }]), 'allow', 'newest edit rule wins');
  assert.equal(sessionEditRule([{ permission: 'edit', pattern: 'src/*', action: 'ask' }]), null, 'pattern-specific rules are not the toggle');
  assert.equal(sessionEditRule(undefined), null);
  assert.deepEqual(['ask', { edit: 'deny' }, { edit: { '*.md': 'allow' } }, { '*': 'ask' }, { bash: 'ask' }, undefined].map(configEditPolicy), ['ask', 'deny', 'mixed', 'ask', null, null]);
  for (const [policy, allowed] of [[null, true], ['allow', true], ['ask', false], ['mixed', false]] as const) {
    const calls: string[] = [];
    const chat = await setup(api({ setEditRule: async (id, rule) => { calls.push(rule); return { id, title: 'A', edit: rule }; }, options: async () => ({ agents: [], models: [], editPolicy: policy }) }));
    try {
      await pause(5);
      await chat.setEditApproval('ses_a', true);
      assert.deepEqual(calls, policy === 'ask' || policy === 'mixed' ? [] : ['ask'], `${policy}: turn on`);
      if (calls.length) assert.equal(chat.state.sessions.find(s => s.id === 'ses_a')?.edit, 'ask');
      await chat.setEditApproval('ses_a', true);
      assert.equal(calls.length <= 1, true, 'no request when already asking');
      await chat.setEditApproval('ses_a', false);
      assert.equal(calls.includes('allow'), allowed, `${policy}: turning off ${allowed ? 'allowed' : 'refused'}`);
      await chat.setEditApproval('ses_b', true); assert.equal(calls.filter(c => c === 'ask').length <= 1, true, 'only the selected session');
    } finally { chat.dispose(); }
  }
  assert.equal(isWebviewMessage({ version: 1, type: 'editApproval', sessionId: 'ses_a', ask: true }), true);
  assert.equal(isWebviewMessage({ version: 1, type: 'editApproval', sessionId: 'ses_a', ask: 'yes' }), false);
});
test('new sessions use the remembered edit-approval default', async () => {
  const created: boolean[] = [];
  const chat = await setup(api({ create: async (_signal, ask = false) => { created.push(ask); return { id: 'ses_new', title: 'New', edit: ask ? 'ask' : null }; } }));
  try {
    await chat.create(); chat.askNewSessions = true; await chat.create();
    assert.deepEqual(created, [false, true]);
  } finally { chat.dispose(); }
});

test('tool steps carry the server start time; a step still being written has none', async () => {
  const { projectTool } = await import('../src/adapter/conversations');
  assert.equal(projectTool({ id: 'prt_a', tool: 'bash', state: { status: 'running', input: { command: 'x' }, time: { start: 1794537780961 } } }).started, 1794537780961);
  assert.equal(projectTool({ id: 'prt_b', tool: 'edit', state: { status: 'pending', input: {}, raw: '' } }).started, null);
  assert.equal(projectTool({ id: 'prt_c', tool: 'bash', state: { status: 'running', input: {}, time: { start: 'soon' } } }).started, null);
});

test('file steps are titled by their project-relative path', () => {
  const info = { id: 'msg_f', sessionID: 'ses_a', role: 'assistant', time: { created: 1 } };
  const tool = (id: string, name: string, state: Record<string, unknown>) => ({ id, sessionID: 'ses_a', messageID: 'msg_f', type: 'tool', tool: name, state });
  const [message] = projectMessages([{ info, parts: [
    tool('prt_1', 'read', { status: 'completed', input: { filePath: '/home/me/Projects/workspace/server/routes/api.js' }, title: 'home/me/Projects/workspace/server/routes/api.js', output: '', metadata: {}, time: { start: 1, end: 2 } }),
    tool('prt_2', 'write', { status: 'running', input: { filePath: 'src/new.ts', content: 'x' }, time: { start: 1 } }),
    tool('prt_3', 'edit', { status: 'completed', input: { filePath: '/etc/hosts' }, title: 'etc/hosts', output: '', metadata: {}, time: { start: 1, end: 2 } }),
    tool('prt_4', 'bash', { status: 'completed', input: { command: 'ls' }, title: 'ls', output: '', metadata: {}, time: { start: 1, end: 2 } }),
  ] }], 'ses_a', '/home/me/Projects/workspace');
  assert.deepEqual(message?.tools.map(t => t.title), ['server/routes/api.js', 'src/new.ts', 'hosts', 'ls']);
});
