import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { Chat } from '../src/adapter/chat';
import { Connection } from '../src/adapter/connection';
import { createConversations } from '../src/adapter/conversations';
import { createTransport } from '../src/adapter/transport';
import { modelFixture } from './fixtures/model';
import { isolatedServer } from './fixtures/server';

/**
 * Tool display and explicit permission replies against isolated OpenCode 1.19.4 with
 * `permission.bash = "ask"`. The model fixture requests one harmless `echo` in a
 * temporary project. Nothing here touches the user's server or configuration.
 */
const model = await modelFixture(50);
const server = await isolatedServer({ ...model.config, permission: { bash: 'ask' } });
const options = { baseUrl: server.baseUrl, directory: server.project, credentials: server.credentials };
const chat = new Chat(50);
const connection = new Connection();
connection.subscribe(state => chat.connection(state.phase === 'connected'));
connection.onEvent(event => chat.event(event));
async function waitFor(predicate: () => boolean, label: string) {
  for (let count = 0; count < 300; count++) { if (predicate()) return; await pause(50); }
  throw new Error(`Timed out: ${label}; error=${chat.state.error}; busy=${chat.state.busy}; permissions=${chat.state.permissions.length}; tools=${JSON.stringify(tools().map(t => t.status))}`);
}
const tools = () => chat.state.messages.flatMap(m => m.tools);
const idle = () => !chat.state.busy && !chat.state.loading && chat.state.operation === 'none';
async function prompt(label: string) {
  await chat.create(); await waitFor(() => idle() && !!chat.state.selectedId, `${label}: session ready`);
  await chat.send(chat.state.selectedId!, 'RUN_TOOL please', `req_${label}`);
}
try {
  await server.start();
  chat.attach(createConversations(options)); void connection.connect(createTransport(options));
  await waitFor(() => connection.state.phase === 'connected', 'connected');

  await prompt('once');
  await waitFor(() => chat.state.permissions.length === 1, 'permission shown');
  const request = chat.state.permissions[0]!;
  assert.equal(request.permission, 'bash'); assert.deepEqual(request.patterns, ['echo sidecode-tool-ok']); assert.deepEqual(request.always, ['echo *']);
  assert.equal(chat.state.waiting, true);
  await waitFor(() => tools().some(t => t.tool === 'bash' && t.status === 'running'), 'tool shown as running while waiting');
  await pause(1500);
  assert.equal(chat.state.permissions.length, 1, 'never answered automatically');
  await chat.reply(chat.state.selectedId!, request.id, 'once');
  await waitFor(() => idle() && tools().some(t => t.status === 'completed'), 'tool completed');
  assert.equal(tools()[0]?.detail.trim(), 'sidecode-tool-ok'); assert.equal(tools()[0]?.title, 'echo sidecode-tool-ok');
  assert.match(chat.state.messages.at(-1)!.text, /Tool finished/);
  assert.equal(chat.state.permissions.length, 0); assert.equal(chat.state.error, null);
  const api = createConversations(options);
  await assert.rejects(api.reply(request.id, 'once', AbortSignal.timeout(5000)), 'a second answer is refused by the server');
  console.log('PASS: tool call shown, permission shown and held, Allow once runs it, duplicate answer refused');

  await prompt('reject');
  await waitFor(() => chat.state.permissions.length === 1, 'second permission');
  await chat.reply(chat.state.selectedId!, chat.state.permissions[0]!.id, 'reject');
  await waitFor(() => idle() && tools().some(t => t.status === 'error'), 'tool rejected');
  assert.match(tools()[0]!.detail, /rejected permission/);
  console.log('PASS: Deny records a failed tool call with the rejection');

  await prompt('stop');
  await waitFor(() => chat.state.permissions.length === 1, 'third permission');
  await chat.stop(chat.state.selectedId!);
  await waitFor(() => idle() && chat.state.permissions.length === 0, 'stopped while waiting');
  assert.notEqual(tools()[0]?.status, 'completed', 'stopped tool did not run');
  console.log('PASS: Stop while a permission is pending cancels it without running the tool');

  await prompt('always');
  await waitFor(() => chat.state.permissions.length === 1, 'fourth permission');
  await chat.reply(chat.state.selectedId!, chat.state.permissions[0]!.id, 'always');
  await waitFor(() => idle() && tools().some(t => t.status === 'completed'), 'always-allowed tool completed');
  await prompt('after-always');
  await waitFor(() => idle() && tools().some(t => t.status === 'completed'), 'later session auto-allowed');
  assert.equal(chat.state.permissions.length, 0);
  console.log('PASS: Always allow covers later sessions on the same server (scope matches UI text)');
} finally { connection.dispose(); chat.dispose(); await server.stop(); await model.stop(); }
