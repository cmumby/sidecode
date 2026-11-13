import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { Chat, type PendingContext } from '../src/adapter/chat';
import { configEditPolicy, partialTitle, projectAgents, projectAttachment, projectMessages, projectModels, projectPermissions, projectTool, sessionEditRule, sessionSelection, sessionSummary, type ConversationApi } from '../src/adapter/conversations';
import { emptyChat, isChatState, type ChatMessage } from '../src/shared/chat';
import { isHostMessage, isWebviewMessage } from '../src/shared/protocol';
const text = (id: string, content: string): ChatMessage => ({ id, role: 'assistant', text: content, status: 'complete', otherParts: false, tools: [], attachments: [], reasoning: '', time: { created: 1794537780961, completed: 1794537781509 }, tokens: null, kind: 'message' });
function api(patch: Partial<ConversationApi> = {}): ConversationApi {
  return { list: async () => [{ id: 'ses_a', title: 'A', edit: null }, { id: 'ses_b', title: 'B', edit: null }], create: async () => ({ id: 'ses_new', title: 'New', edit: null }), setEditRule: async (id, rule) => ({ id, title: 'A', edit: rule }), snapshot: async id => ({ permissions: [], messages: [text(`msg_${id}`, id)], busy: false, waiting: false, hasMore: false }), compact: async () => {}, options: async () => ({ agents: [{ name: 'build', description: '' }, { name: 'plan', description: 'Plan' }], models: [{ providerID: 'local', modelID: 'm/1.5', name: 'M', provider: 'Local', context: 32000 }], editPolicy: null }), send: async () => {}, stop: async () => {}, reply: async () => {}, shellOutput: async (_id, cursor) => ({ text: '', cursor }), ...patch };
}
async function setup(source: ConversationApi) { const chat = new Chat(1); chat.attach(source); chat.connection(true); await chat.refresh(); return chat; }
/** OpenCode 2.3.0 history items (see scripts/discover-v2.ts). */
const assistant = (id: string, content: unknown[], extra: Record<string, unknown> = {}) => ({ id, type: 'assistant', agent: 'build', model: { id: 'm', providerID: 'p' }, time: { created: 1, completed: 2 }, content, ...extra });
const user = (id: string, body: string, extra: Record<string, unknown> = {}) => ({ id, type: 'user', time: { created: 1 }, text: body, ...extra });
const tool = (id: string, name: string, state: Record<string, unknown>, time: Record<string, unknown> = { created: 1 }) => ({ type: 'tool', id, name, state, time });

test('projection omits server paths, tool payloads and raw errors; invalid items are rejected', () => {
  const result = projectMessages([
    user('msg_u', 'hello', { metadata: { secret: 'token' } }),
    assistant('msg_a', [{ type: 'text', text: '**Hello**' }, tool('call_1', 'shell', { status: 'running', input: { command: 'ls' }, metadata: { secret: 'token' } })], { time: { created: 1 }, error: { type: 'aborted', message: 'at /private/token' } }),
  ], '/project');
  assert.deepEqual(result.map(m => [m.role, m.status]), [['user', 'sent'], ['assistant', 'stopped']]);
  assert.equal(result[1]?.text, '**Hello**');
  assert.doesNotMatch(JSON.stringify(result), /private|\btoken\b/);
  assert.throws(() => projectMessages([{ ...user('msg_u', 'x'), id: '../x' }]));
  assert.throws(() => projectMessages([assistant('msg_a', 'not content' as never)]));
  assert.throws(() => sessionSummary({ id: 'ses_a', title: 'A', location: { directory: '/other' } }, '/project'));
  assert.deepEqual(sessionSummary({ id: 'ses_a', location: { directory: '/project' } }, '/project'), { id: 'ses_a', title: '', edit: null }, 'an untitled session');
});
test('how a run ended decides an unfinished reply: streaming, stopped or failed', () => {
  const open = assistant('msg_a', [{ type: 'text', text: 'partial' }], { time: { created: 1 } });
  assert.equal(projectMessages([user('msg_u', 'q'), open], '', true).at(-1)?.status, 'streaming');
  assert.equal(projectMessages([user('msg_u', 'q'), open], '', false).at(-1)?.status, 'stopped', 'not running any more');
  assert.equal(projectMessages([user('msg_u', 'q'), open, { id: 'msg_i', type: 'idle', time: { created: 3 }, outcome: 'interrupted' }]).at(-1)?.status, 'stopped');
  assert.equal(projectMessages([user('msg_u', 'q'), open, { id: 'msg_i', type: 'idle', time: { created: 3 }, outcome: 'failed' }]).at(-1)?.status, 'failed');
  assert.equal(projectMessages([user('msg_u', 'q'), assistant('msg_a', [], { error: { type: 'provider.internal', message: 'x' } })]).at(-1)?.status, 'failed');
  // A run that failed before any reply (unknown agent: 2.3.0 records no prompt) still shows a failed reply.
  const failed = projectMessages([user('msg_u', 'q'), assistant('msg_a', [{ type: 'text', text: 'ok' }]), { id: 'msg_i', type: 'idle', time: { created: 3 }, outcome: 'succeeded' }, { id: 'msg_s', type: 'agent-switched', time: { created: 4 }, agent: 'gone' }, { id: 'msg_f', type: 'idle', time: { created: 5 }, outcome: 'failed', error: { type: 'unknown', message: 'Agent not found: /private' } }]);
  assert.deepEqual(failed.map(m => [m.id, m.status]), [['msg_u', 'sent'], ['msg_a', 'complete'], ['msg_f', 'failed']]);
  assert.doesNotMatch(JSON.stringify(failed), /private|gone/);
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
    for (let n = 0; n < 100; n++) chat.event({ type: 'session.step.ended', properties: { sessionID: 'ses_a', assistantMessageID: 'msg_a' } });
    await pause(20);
    assert.equal(snapshots, 2);
    for (let n = 0; n < 100; n++) chat.event({ type: 'session.text.delta', properties: { sessionID: 'ses_a', assistantMessageID: 'msg_x', ordinal: 0, delta: 'ignored' } });
    for (let n = 0; n < 20; n++) chat.event({ type: 'server.heartbeat', properties: {} });
    await pause(20);
    assert.equal(snapshots, 2, 'deltas and heartbeats never trigger history refreshes'); assert.equal(chat.state.messages.length, 1);
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
  const streaming = (body: string, status: ChatMessage['status'] = 'streaming') => ({ permissions: [], messages: [{ id: 'msg_a', role: 'assistant' as const, text: body, status, otherParts: false, tools: [], attachments: [], reasoning: '', time: { created: 1, completed: null }, tokens: null, kind: 'message' as const, parts: body ? [{ id: 'msg_a:text:0', text: body }] : [] }], busy: status === 'streaming', waiting: false, hasMore: false });
  let snap = streaming('');
  const chat = new Chat(1, 1); chat.attach(api({ snapshot: async () => snap })); chat.connection(true); await chat.refresh();
  const event = (type: string, extra: Record<string, unknown> = {}) => chat.event({ type, properties: { sessionID: 'ses_a', assistantMessageID: 'msg_a', ordinal: 0, ...extra } });
  const delta = (value: string, extra: Record<string, unknown> = {}) => event('session.text.delta', { delta: value, ...extra });
  try {
    delta('lost'); await pause(5);
    assert.equal(chat.state.messages[0]?.text, '', 'deltas before the part start are ignored');
    event('session.text.started');
    delta('He'); delta('llo'); delta(' world'); delta('x', { sessionID: 'ses_b' }); delta('x', { ordinal: 1 }); delta('x', { assistantMessageID: 'msg_other' });
    await pause(10);
    assert.equal(chat.state.messages[0]?.text, 'Hello world');
    assert.equal(isChatState(chat.state), true, 'host-only part keys never reach the bridge');
    await chat.refresh();
    assert.equal(chat.state.messages[0]?.text, 'Hello world', 'stale empty snapshot does not erase live text');
    chat.connection(false); chat.connection(true); await chat.refresh();
    assert.equal(chat.state.messages[0]?.text, '', 'overlay dropped on disconnect; snapshot wins');
    delta('!'); await pause(5);
    assert.equal(chat.state.messages[0]?.text, '', 'no resumption from a partial stream');
    event('session.text.started'); event('session.text.ended', { text: 'Hello' }); await pause(5);
    assert.equal(chat.state.messages[0]?.text, 'Hello', 'the ended event carries the whole text');
    snap = streaming('Hello world.', 'complete'); await chat.refresh();
    assert.equal(chat.state.messages[0]?.text, 'Hello world.'); assert.equal(chat.state.messages[0]?.status, 'complete');
    delta(' extra'); await pause(5);
    assert.equal(chat.state.messages[0]?.text, 'Hello world.', 'finished messages ignore the overlay');
  } finally { chat.dispose(); }
});
test('live reasoning deltas overlay an unfinished reply', async () => {
  const streaming = { permissions: [], messages: [{ id: 'msg_a', role: 'assistant' as const, text: '', reasoning: '', status: 'streaming' as const, otherParts: false, tools: [], attachments: [], time: { created: 1, completed: null }, tokens: null, kind: 'message' as const, parts: [], reasoningParts: [] }], busy: true, waiting: false, hasMore: false };
  const chat = await setup(api({ snapshot: async () => streaming }));
  try {
    const props = { sessionID: 'ses_a', assistantMessageID: 'msg_a', ordinal: 0 };
    chat.event({ type: 'session.reasoning.started', properties: props });
    for (const delta of ['Thinking ', 'hard.']) chat.event({ type: 'session.reasoning.delta', properties: { ...props, delta } });
    await pause(80);
    assert.equal(chat.state.messages[0]?.reasoning, 'Thinking hard.'); assert.equal(chat.state.messages[0]?.text, '');
    assert.doesNotMatch(JSON.stringify(chat.state), /reasoningParts|msg_a:reasoning/);
  } finally { chat.dispose(); }
});

test('tool calls project only name, status, title and clipped output; never metadata or raw objects', () => {
  const [, message] = projectMessages([user('msg_u', 'q'), assistant('msg_t', [
    tool('call_1', 'shell', { status: 'completed', input: { command: 'ls' }, content: [{ type: 'text', text: 'x'.repeat(5000) }], metadata: { secret: 'token' } }, { created: 1, ran: 2, completed: 3 }),
    tool('call_2', 'shell', { status: 'running', input: { command: 'echo hi' }, metadata: { shellID: 'sh_secret' } }, { created: 1, ran: 2 }),
    tool('call_3', 'shell', { status: 'error', input: {}, error: { type: 'tool.execution', message: 'The user declined this tool call' } }),
    tool('call_4', 'write', { status: 'streaming', input: '{"pa' }),
  ])]);
  assert.deepEqual(message?.tools.map(t => [t.tool, t.status, t.title]), [['shell', 'completed', 'ls'], ['shell', 'running', 'echo hi'], ['shell', 'error', ''], ['write', 'pending', '']]);
  assert.equal(message?.tools[0]?.detail.length, 4000); assert.equal(message?.tools[2]?.detail, 'The user declined this tool call');
  assert.equal(message?.otherParts, false);
  assert.doesNotMatch(JSON.stringify(message), /\btoken\b|sh_secret|metadata/);
  assert.throws(() => projectMessages([assistant('msg_t', [tool('call_5', 'shell', { status: 'exploded' })])]));
});
test('tool titles come from the main argument, also from partial JSON', () => {
  const title = (name: string, input: unknown) => projectTool({ id: 'call_a', name, state: { status: 'running', input, metadata: {} } }, '/p').tool.title;
  assert.equal(title('edit', { path: 'src/a.ts', oldString: 'secret old', newString: 'x' }), 'src/a.ts');
  assert.equal(title('shell', { command: 'npm test', description: 'Run tests' }), 'npm test');
  assert.equal(title('custom', { other: 1 }), '{"other":1}');
  assert.equal(partialTitle('write', '{"path":"/p/notes.md","content":"line 1 of a lo', '/p'), 'notes.md');
  assert.equal(partialTitle('write', '{"path":"/p/no', '/p'), '', 'an unfinished value is not shown');
  assert.equal(partialTitle('shell', '{"command":"echo \\"hi\\"","desc', '/p'), 'echo "hi"');
});
test('tool steps carry the server start time; a step still being written has none', () => {
  const started = (status: string, time: Record<string, unknown>, input: unknown = {}) => projectTool({ id: 'call_a', name: 'shell', state: { status, input, metadata: {} }, time }).tool.started;
  assert.equal(started('running', { created: 1, ran: 1794537780961 }), 1794537780961);
  assert.equal(started('streaming', { created: 1 }, ''), null);
  assert.equal(started('running', { created: 1, ran: 'soon' }), null);
});
test('file steps are titled by their project-relative path; edits carry their change', () => {
  const directory = '/home/me/Projects/workspace';
  const patch = 'Index: src/a.ts\n===================================================================\n--- src/a.ts\n+++ src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1;\n+export const value = 2;\n';
  const [message] = projectMessages([assistant('msg_f', [
    tool('call_1', 'read', { status: 'completed', input: { path: `${directory}/server/routes/api.js` }, content: [{ type: 'text', text: '' }] }),
    tool('call_2', 'write', { status: 'running', input: { path: 'src/new.ts', content: 'x' }, metadata: {} }),
    tool('call_3', 'edit', { status: 'completed', input: { path: 'src/a.ts' }, content: [{ type: 'text', text: 'Edited' }], metadata: { files: [{ file: 'src/a.ts', patch, status: 'modified', additions: 1, deletions: 1 }] } }),
    tool('call_4', 'read', { status: 'completed', input: { path: '/etc/hosts' }, content: [{ type: 'text', text: '' }] }),
  ])], directory);
  assert.deepEqual(message?.tools.map(t => t.title), ['server/routes/api.js', 'src/new.ts', 'src/a.ts', 'hosts']);
  assert.deepEqual(message?.tools[2]?.change, { label: 'src/a.ts', additions: 1, deletions: 1, diff: true });
  assert.deepEqual(message?.changes?.call_3, { path: `${directory}/src/a.ts`, patch, created: false }, 'host-only source resolved against the project');
});

test('permission projection keeps only this session and the displayed fields', () => {
  const request = { id: 'per_a', sessionID: 'ses_a', action: 'shell', resources: ['rm -rf build'], save: ['rm *'], metadata: { secret: 'token' }, source: { type: 'tool', messageID: 'msg_a', id: 'call_a' } };
  const result = projectPermissions([request, { ...request, id: 'per_b', sessionID: 'ses_b' }], 'ses_a');
  assert.deepEqual(result, [{ id: 'per_a', permission: 'shell', patterns: ['rm -rf build'], always: ['rm *'], change: null }]);
  assert.deepEqual(projectPermissions([{ ...request, save: undefined }], 'ses_a')[0]?.always, [], 'nothing to save: no Always option');
  assert.throws(() => projectPermissions([{ ...request, id: '../x' }], 'ses_a'));
  assert.throws(() => projectPermissions([{ ...request, resources: [1] }], 'ses_a'));
});
test('permission replies are explicit, limited to shown requests, never retried, and errors clear once answered', async () => {
  const replies: string[] = []; let fail = false;
  let pending = [{ id: 'per_a', permission: 'shell', patterns: ['ls'], always: ['ls *'], change: null }];
  const chat = await setup(api({
    snapshot: async () => ({ messages: [], permissions: pending, busy: true, waiting: pending.length > 0, hasMore: false }),
    reply: async (session, id, reply) => { replies.push(`${session}:${id}:${reply}`); if (fail) throw new Error('secret /private'); },
  }));
  try {
    assert.equal(chat.state.permissions.length, 1); assert.equal(chat.state.waiting, true);
    for (let n = 0; n < 50; n++) chat.event({ type: 'permission.asked', properties: { sessionID: 'ses_a', id: 'per_a' } });
    await pause(10); assert.deepEqual(replies, [], 'events never answer permissions');
    await chat.reply('ses_b', 'per_a', 'once'); await chat.reply('ses_a', 'per_unknown', 'once');
    assert.deepEqual(replies, [], 'wrong session or unknown request ignored');
    fail = true; await chat.reply('ses_a', 'per_a', 'always');
    assert.deepEqual(replies, ['ses_a:per_a:always']); assert.equal(chat.state.error, 'replyUncertain');
    assert.doesNotMatch(JSON.stringify(chat.state), /secret|private/);
    await chat.refresh(); assert.equal(chat.state.error, 'replyUncertain', 'kept while still pending');
    assert.deepEqual(replies, ['ses_a:per_a:always'], 'not retried automatically');
    pending = []; await chat.refresh();
    assert.equal(chat.state.error, null, 'cleared once the request is gone'); assert.equal(chat.state.waiting, false);
    pending = [{ id: 'per_b', permission: 'edit', patterns: [], always: [], change: null }]; fail = false; await chat.refresh();
    await chat.reply('ses_a', 'per_b', 'reject');
    assert.deepEqual(replies, ['ses_a:per_a:always', 'ses_a:per_b:reject']); assert.deepEqual(chat.state.permissions, []);
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
  const state = { ...emptyChat(), permissions: [{ id: 'per_a', permission: 'shell', patterns: ['ls'], always: [], change: null }] };
  assert.equal(isChatState(state), true);
  assert.equal(isChatState({ ...state, permissions: [{ ...state.permissions[0], metadata: {} }] }), false);
  assert.equal(isChatState({ ...emptyChat(), messages: [{ ...text('msg_a', 'x'), tools: [{ id: 'call_a', tool: 'shell', status: 'running', title: '', detail: '', change: null, input: {} }] }] }), false);
});

test('agent and model lists keep only selectable, bounded entries without provider settings', () => {
  const agents = projectAgents({ location: {}, data: [
    { id: 'build', name: 'Build', mode: 'primary', hidden: false, description: 'Default', permissions: [{ secret: 'x' }], system: 'secret prompt' },
    { id: 'title', name: 'Title', mode: 'primary', hidden: true }, { id: 'explore', mode: 'subagent', hidden: false },
    { id: 'custom', mode: 'all' }, { id: 'bad\nname', mode: 'primary' }, { name: 'No id', mode: 'primary' },
  ] });
  assert.deepEqual(agents, [{ name: 'build', description: 'Default' }, { name: 'custom', description: '' }]);
  const model = (id: string, extra: Record<string, unknown> = {}) => ({ id, modelID: id, providerID: 'lmstudio', name: id.toUpperCase(), type: 'chat', settings: { apiKey: 'secret', baseURL: 'http://private' }, status: 'active', enabled: true, limit: { context: 65536, output: 8192 }, ...extra });
  const models = projectModels({ location: {}, data: [model('a'), model('old', { status: 'deprecated' }), model('off', { enabled: false }), model('embed', { type: 'embedding' }), model('qwen/q:free', { name: undefined, limit: { context: -1 } }), { providerID: 'p' }] });
  assert.deepEqual(models, [
    { providerID: 'lmstudio', modelID: 'a', name: 'A', provider: 'lmstudio', context: 65536 },
    { providerID: 'lmstudio', modelID: 'qwen/q:free', name: 'qwen/q:free', provider: 'lmstudio', context: null },
  ]);
  assert.doesNotMatch(JSON.stringify(models), /secret|private/);
  assert.throws(() => projectAgents([])); assert.throws(() => projectModels({}));
  assert.equal(projectModels({ data: Array.from({ length: 600 }, (_, n) => model(`m${n}`)) }).length, 500);
  assert.equal(isChatState({ ...emptyChat(), agents, models }), true);
  assert.equal(isChatState({ ...emptyChat(), models: [{ ...models[0], apiKey: 'x' }] }), false);
});
test('the session (or its latest reply) supplies the initial selection', () => {
  assert.deepEqual(sessionSelection({ agent: 'plan', model: { id: 'm', providerID: 'p', variant: 'default' } }), { agent: 'plan', model: { providerID: 'p', modelID: 'm' } });
  assert.deepEqual(sessionSelection({}, { agent: 'build', model: { id: 'r', providerID: 'p' } }), { agent: 'build', model: { providerID: 'p', modelID: 'r' } }, 'a session that never switched');
  assert.deepEqual(sessionSelection({ agent: 42, model: { providerID: 'p' } }), { agent: null, model: null });
  assert.deepEqual(sessionSelection(undefined), { agent: null, model: null });
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
test('a session left on an agent or model that is no longer listed needs an explicit choice', async () => {
  const sent: unknown[] = [];
  let used = { agent: 'removed' as string | null, model: null as { providerID: string; modelID: string } | null };
  const chat = await setup(api({ snapshot: async () => ({ permissions: [], messages: [], busy: false, waiting: false, hasMore: false, used }), send: async (_id, _m, _t, selection) => { sent.push(selection); } }));
  try {
    await pause(5); await chat.refresh();
    await chat.send('ses_a', 'hi', 'req_1');
    assert.equal(chat.state.error, 'optionUnavailable'); assert.equal(sent.length, 0, '"Default" would keep the removed agent');
    await chat.send('ses_a', 'hi', 'req_2', { agent: 'build', model: null });
    assert.deepEqual(sent, [{ agent: 'build', model: null }]);
    used = { agent: null, model: { providerID: 'gone', modelID: 'x' } }; await chat.refresh();
    await chat.send('ses_a', 'hi', 'req_3');
    assert.equal(chat.state.error, 'optionUnavailable'); assert.equal(sent.length, 1);
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
test('a failed run of the selected session shows a fixed message; other sessions do not', async () => {
  let messages: ChatMessage[] = [];
  const chat = await setup(api({ snapshot: async () => ({ permissions: [], messages, busy: false, waiting: false, hasMore: false }) }));
  try {
    chat.event({ type: 'session.execution.failed', properties: { sessionID: 'ses_b', error: { type: 'unknown', message: 'x' } } });
    chat.event({ type: 'session.execution.interrupted', properties: { sessionID: 'ses_a', reason: 'user' } });
    assert.equal(chat.state.error, null);
    chat.event({ type: 'session.execution.failed', properties: { sessionID: 'ses_a', error: { type: 'unknown', message: 'Agent not found at /private/path' } } });
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
test('prompt files become attachment labels without URIs or contents', () => {
  const [message] = projectMessages([user('msg_u', 'look', { files: [
    { data: 'c2VjcmV0', mime: 'text/plain', source: { type: 'uri', uri: 'file:///home/me/private/src/a.ts' }, name: 'src/a.ts' },
    { data: 'YS50cw==', mime: 'application/x-directory', source: { type: 'uri', uri: 'file:///home/me/private/src' }, name: 'src' },
    { data: 'c2VjcmV0', mime: 'text/plain', source: { type: 'inline' }, name: 'a.ts:5-7' },
    { data: 'eA==', mime: 'text/plain', source: { type: 'uri', uri: 'file:///x' } },
  ] })]);
  assert.deepEqual(message?.attachments, [{ kind: 'file', label: 'src/a.ts' }, { kind: 'folder', label: 'src' }, { kind: 'selection', label: 'a.ts:5-7' }, { kind: 'file', label: 'attachment' }]);
  assert.equal(message?.text, 'look');
  assert.doesNotMatch(JSON.stringify(message), /private|c2VjcmV0|data/);
  assert.equal(projectAttachment({ name: 'a\u0000b' + 'x'.repeat(400) }).label.length, 300);
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

test('reasoning is projected; a running command shows its newest shell output', async () => {
  const [message] = projectMessages([assistant('msg_r', [{ type: 'reasoning', text: 'Considering the question.' }, { type: 'text', text: 'Answer' }])]);
  assert.equal(message?.reasoning, 'Considering the question.'); assert.equal(message?.text, 'Answer'); assert.equal(message?.otherParts, false);
  const running = { permissions: [], messages: [{ id: 'msg_a', role: 'assistant' as const, text: '', reasoning: '', status: 'streaming' as const, otherParts: false, tools: [{ id: 'call_a', tool: 'shell', status: 'running' as const, title: 'npm test', detail: '', change: null, started: 1 }], attachments: [], time: { created: 1, completed: null }, tokens: null, kind: 'message' as const }], busy: true, waiting: false, hasMore: false };
  const reads: [string, number][] = [];
  const chunks = ['x'.repeat(5000), '\nlast line'];
  const chat = new Chat(1, 1);
  chat.attach(api({ snapshot: async () => running, shellOutput: async (id, cursor) => { reads.push([id, cursor]); const next = chunks.shift() ?? ''; return { text: next, cursor: cursor + next.length }; } }));
  chat.connection(true); await chat.refresh();
  try {
    chat.event({ type: 'session.tool.progress', properties: { sessionID: 'ses_a', assistantMessageID: 'msg_a', id: 'call_a', metadata: { shellID: 'sh_a' } } });
    for (let n = 0; n < 40 && !chat.state.messages[0]?.tools[0]?.detail.endsWith('last line'); n++) await pause(100);
    const detail = chat.state.messages[0]!.tools[0]!.detail;
    assert.equal(detail.length, 4000); assert.ok(detail.startsWith('…') && detail.endsWith('last line'), 'newest output kept');
    assert.deepEqual(reads.slice(0, 2), [['sh_a', 0], ['sh_a', 5000]], 'reads continue from the cursor');
    assert.doesNotMatch(JSON.stringify(chat.state), /sh_a/);
  } finally { chat.dispose(); }
});
test('retry status is validated as plain data', () => {
  assert.equal(isChatState({ ...emptyChat(), retry: { attempt: 3, message: 'model not loaded', next: 1794532858842 } }), true);
  assert.equal(isChatState({ ...emptyChat(), retry: { attempt: 3, message: 'x'.repeat(501), next: 1 } }), false);
  assert.equal(isChatState({ ...emptyChat(), retry: { attempt: 3, message: '', next: 1, raw: {} } }), false);
});

test('message timing, token use and model context size are projected as plain numbers', () => {
  const [message] = projectMessages([assistant('msg_a', [], { time: { created: 1000, firstToken: 2000, completed: 61000 }, tokens: { input: 3000, output: 450, reasoning: 50, cache: { read: 25000, write: 500 } }, cost: 0.5 })]);
  assert.deepEqual(message?.time, { created: 1000, completed: 61000 });
  assert.deepEqual(message?.tokens, { context: 29000, output: 450 });
  const [first] = projectMessages([user('msg_u', 'x', { time: { created: 5 } })]);
  assert.deepEqual([first?.time, first?.tokens], [{ created: 5, completed: null }, null]);
  const [bad] = projectMessages([assistant('msg_b', [], { tokens: { input: -5, output: 'x' }, time: { created: 'soon' } })]);
  assert.deepEqual([bad?.time.created, bad?.tokens], [0, null], 'invalid numbers are ignored');
});

test('compaction shows a divider and a summary; compact is explicit and only for the selected session', async () => {
  const messages = projectMessages([
    user('msg_u', 'q'), assistant('msg_a', [{ type: 'text', text: 'a' }]),
    { type: 'compaction', id: 'msg_c', time: { created: 3 }, status: 'completed', reason: 'manual', summary: 'Summary of the work so far.', tokens: { input: 20, output: 20, reasoning: 0, cache: { read: 0, write: 0 } } },
    { type: 'compaction', id: 'msg_d', time: { created: 4 }, status: 'failed', reason: 'auto', error: { type: 'compaction.failed', message: 'x' } },
  ]);
  assert.deepEqual(messages.slice(2).map(m => [m.kind, m.status, m.text]), [['compaction', 'sent', ''], ['summary', 'complete', 'Summary of the work so far.'], ['compaction', 'sent', ''], ['message', 'failed', '']]);
  assert.equal(isChatState({ ...emptyChat(), messages: messages.slice(2) }), true);
  assert.equal(isWebviewMessage({ version: 1, type: 'compact', sessionId: 'ses_a' }), true);
  let calls = 0;
  const chat = await setup(api({ compact: async () => { calls++; } }));
  try {
    await pause(5);
    await chat.compact('ses_b'); assert.equal(calls, 0, 'only the selected session');
    await chat.compact('ses_a'); assert.equal(calls, 1); assert.equal(chat.state.busy, true, 'the session runs the compaction');
    assert.equal(chat.state.operation, 'none');
  } finally { chat.dispose(); }
});

test('real epoch-millisecond timestamps pass validation', () => {
  const message = { id: 'msg_a', role: 'assistant', text: 'x', reasoning: '', status: 'complete', otherParts: false, tools: [], attachments: [], time: { created: Date.now(), completed: Date.now() + 1000 }, tokens: { context: 20, output: 10 }, kind: 'message' };
  assert.equal(isChatState({ ...emptyChat(), messages: [message] }), true);
  assert.equal(isChatState({ ...emptyChat(), messages: [{ ...message, time: { created: 1.5, completed: null } }] }), false);
});

test('edit approval: rules are read from sessions and config; a config that asks is never relaxed', async () => {
  assert.equal(sessionEditRule([{ action: 'edit', resource: '*', effect: 'ask' }, { action: 'shell', resource: '*', effect: 'ask' }, { action: 'edit', resource: '*', effect: 'allow' }]), 'allow', 'newest edit rule wins');
  assert.equal(sessionEditRule([{ action: 'edit', resource: 'src/*', effect: 'ask' }]), null, 'path-specific rules are not the toggle');
  assert.equal(sessionEditRule(undefined), null);
  const config = (permissions?: unknown) => [{ type: 'directory', path: '/c' }, { type: 'document', info: permissions === undefined ? {} : { permissions } }];
  assert.deepEqual([
    config([{ action: 'edit', resource: '*', effect: 'ask' }]), config([{ action: 'edit', resource: '*', effect: 'ask' }, { action: 'edit', resource: '*', effect: 'deny' }]),
    config([{ action: 'edit', resource: '*.md', effect: 'allow' }]), config([{ action: '*', resource: '*', effect: 'ask' }]), config([{ action: 'shell', resource: '*', effect: 'ask' }]), config(), undefined,
  ].map(configEditPolicy), ['ask', 'deny', 'mixed', 'ask', null, null, null]);
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
