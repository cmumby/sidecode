import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { Chat } from '../src/adapter/chat';
import { Connection } from '../src/adapter/connection';
import { createConversations } from '../src/adapter/conversations';
import { createTransport } from '../src/adapter/transport';
import { modelFixture } from './fixtures/model';
import { isolatedServer, opencodeBinary } from './fixtures/server';
const model = await modelFixture();
const server = await isolatedServer(model.config);
const options = { baseUrl: server.baseUrl, directory: server.project, credentials: server.credentials };
const chat = new Chat(50);
const connection = new Connection();
connection.subscribe(state => chat.connection(state.phase === 'connected'));
connection.onEvent(event => chat.event(event));
const lengths = new Set<number>();
chat.subscribe(() => { const last = chat.state.messages.at(-1); if (last?.role === 'assistant' && last.status === 'streaming' && last.text.length) lengths.add(last.text.length); });
async function waitFor(predicate: () => boolean, label: string) {
  for (let count = 0; count < 400; count++) { if (predicate()) return; await pause(50); }
  throw new Error(`Timed out: ${label}; connection=${connection.state.phase}; chat=${chat.state.error}; busy=${chat.state.busy}; messages=${chat.state.messages.length}`);
}
async function cli(args: string[]) {
  // OpenCode 2's CLI works in its current folder and attaches with `--server`.
  const process = spawn(opencodeBinary(), ['run', '--server', server.baseUrl, '--format', 'json', ...args], { cwd: server.project, env: server.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; process.stdout.on('data', d => { output += d; }); process.stderr.on('data', d => { output += d; });
  const timer = setTimeout(() => process.kill('SIGTERM'), 20000);
  try { const [code] = await once(process, 'exit'); assert.equal(code, 0, output.slice(-2000)); } finally { clearTimeout(timer); }
}
try {
  await server.start();
  const otherDir = join(server.root, 'other'); await mkdir(otherDir);
  const other = await createConversations({ ...options, directory: otherDir }).create(AbortSignal.timeout(10000));
  const api = createConversations(options);
  assert.equal((await api.list(AbortSignal.timeout(10000))).some(s => s.id === other.id), false, 'directory isolation');
  chat.attach(api); void connection.connect(createTransport(options));
  await waitFor(() => connection.state.phase === 'connected', 'connected');
  await chat.create();
  const first = chat.state.selectedId!; assert.ok(first);
  await waitFor(() => !chat.state.loading && chat.state.operation === 'none', 'ready');
  await chat.send(first, 'Say hello without tools.', 'req_first');
  await waitFor(() => chat.state.messages.some(m => m.role === 'assistant' && m.status === 'complete') && !chat.state.busy && !chat.state.loading, 'first response');
  assert.ok(lengths.size >= 3, `partial text visible while streaming (${lengths.size} distinct partial lengths)`);
  assert.equal(chat.state.messages.length, 2);
  assert.match(chat.state.messages[1]!.text, /Fixture reply/);
  assert.equal(chat.state.submitted, 'req_first');
  console.log(`PASS: directory scope, create/select, prompt, live partial text (${lengths.size} partial lengths)`);

  await cli(['--title', 'CLI fixture', 'Say hello without tools.']);
  await chat.refresh();
  const fromCli = chat.state.sessions.find(s => s.title === 'CLI fixture'); assert.ok(fromCli, 'CLI-created session appears in same directory');
  await chat.select(fromCli.id);
  assert.equal(chat.state.messages.length, 2, 'CLI history is resumable');
  await cli(['--session', first, 'Continue with another hello, no tools.']);
  await chat.select(first);
  assert.equal(chat.state.messages.length, 4, 'CLI continued the IDE-created session');
  console.log('PASS: CLI-created session resume and CLI continuation of IDE-created session');

  await waitFor(() => !chat.state.loading, 'ready for reconnect test');
  await chat.send(first, 'Say hello again, no tools.', 'req_reconnect');
  await waitFor(() => chat.state.messages.length >= 6 && chat.state.messages.at(-1)?.status === 'streaming', 'streaming before disconnect');
  connection.disconnect();
  await pause(1600);
  void connection.connect(createTransport(options));
  await waitFor(() => connection.state.phase === 'connected' && chat.state.messages.length === 6 && chat.state.messages.at(-1)?.status === 'complete' && !chat.state.loading, 'reconnect snapshot');
  assert.equal(new Set(chat.state.messages.map(m => m.id)).size, 6, 'no duplicate messages after resync');
  console.log('PASS: reconnect resynchronizes completed history without duplicated messages');

  await chat.send(first, 'Say hello slowly without tools.', 'req_stop');
  await waitFor(() => chat.state.messages.length >= 8 && chat.state.messages.at(-1)?.status === 'streaming', 'streaming before stop');
  await chat.stop(first);
  await waitFor(() => !chat.state.busy && !chat.state.loading, 'stop completed');
  assert.equal(chat.state.messages.at(-1)?.status, 'stopped');
  await chat.select(fromCli.id); assert.equal(chat.state.messages.length, 2);
  await chat.select(first); assert.equal(chat.state.messages.length, 8);
  console.log('PASS: stop/abort and session switching; only real OpenCode agent/session APIs used');
} finally { connection.dispose(); chat.dispose(); await server.stop(); await model.stop(); }
