import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { Chat, type PendingContext } from '../src/adapter/chat';
import { Connection } from '../src/adapter/connection';
import { createConversations } from '../src/adapter/conversations';
import { createTransport } from '../src/adapter/transport';
import { modelFixture } from './fixtures/model';
import { isolatedServer } from './fixtures/server';

/**
 * Explicit context against isolated OpenCode 1.19.4 with temporary project files: file,
 * folder and selection parts reach the model, history shows labels only, and context is
 * sent once. Parts are built the way the controller builds them (see src/extension).
 */
const model = await modelFixture(10);
const server = await isolatedServer(model.config);
const options = { baseUrl: server.baseUrl, directory: server.project, credentials: server.credentials };
const chat = new Chat(50);
const connection = new Connection();
connection.subscribe(state => chat.connection(state.phase === 'connected'));
connection.onEvent(event => chat.event(event));
async function waitFor(predicate: () => boolean, label: string) {
  for (let count = 0; count < 300; count++) { if (predicate()) return; await pause(50); }
  throw new Error(`Timed out: ${label}; error=${chat.state.error}; busy=${chat.state.busy}`);
}
const idle = () => !chat.state.busy && !chat.state.loading && chat.state.operation === 'none';
const lastUserContent = () => JSON.stringify((model.requests.at(-1) as { messages: { role: string; content: unknown }[] }).messages.filter(m => m.role === 'user').at(-1)?.content);
let n = 0;
const entry = (kind: 'file' | 'folder' | 'selection', label: string, url: string): PendingContext => ({ item: { id: `ctx_${++n}`, kind, label, note: '' },
  part: { type: 'file', mime: kind === 'folder' ? 'application/x-directory' : 'text/plain', filename: label, url } });
try {
  await mkdir(join(server.project, 'src'));
  await writeFile(join(server.project, 'src', 'a.ts'), 'export const MARK_FILE = 1;\n');
  await writeFile(join(server.project, 'src', 'b.ts'), 'export const other = 2;\n');
  await server.start();
  chat.attach(createConversations(options)); void connection.connect(createTransport(options));
  await waitFor(() => connection.state.phase === 'connected', 'connected');
  await chat.create(); await waitFor(() => idle() && !!chat.state.selectedId, 'session');
  const session = chat.state.selectedId!;

  chat.addContext(session, [
    entry('file', 'src/a.ts', pathToFileURL(join(server.project, 'src', 'a.ts')).href),
    entry('folder', 'src', pathToFileURL(join(server.project, 'src')).href),
    entry('selection', 'src/a.ts:1', 'data:text/plain;base64,' + Buffer.from('const MARK_UNSAVED_SELECTION = 1;').toString('base64')),
  ]);
  assert.deepEqual(chat.state.context.map(i => i.label), ['src/a.ts', 'src', 'src/a.ts:1']);
  await chat.send(session, 'Explain this', 'req_ctx');
  await waitFor(() => idle() && chat.state.messages.at(-1)?.status === 'complete', 'reply');
  const seen = lastUserContent();
  assert.match(seen, /MARK_FILE/); assert.match(seen, /a\.ts\\nb\.ts|<entries>/); assert.match(seen, /MARK_UNSAVED_SELECTION/);
  console.log('PASS: file, folder and selection context reach the model');

  const user = chat.state.messages.find(m => m.role === 'user')!;
  assert.equal(user.text, 'Explain this', 'injected file contents are not shown as message text');
  assert.deepEqual(user.attachments, [{ kind: 'file', label: 'src/a.ts' }, { kind: 'folder', label: 'src' }, { kind: 'selection', label: 'src/a.ts:1' }]);
  assert.equal(user.otherParts, false);
  assert.deepEqual(chat.state.context, [], 'sent once, then cleared');
  const state = JSON.stringify(chat.state);
  assert.doesNotMatch(state, new RegExp(server.project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); assert.doesNotMatch(state, /MARK_|base64/);
  console.log('PASS: history shows attachment labels only; no paths or contents in chat state');

  await chat.send(session, 'Follow-up without context', 'req_plain');
  await waitFor(() => idle() && chat.state.messages.length === 4 && chat.state.messages.at(-1)?.status === 'complete', 'second reply');
  assert.doesNotMatch(lastUserContent(), /MARK_/); assert.deepEqual(chat.state.messages[2]!.attachments, []);
  console.log('PASS: context is not repeated on the next message');
} finally { connection.dispose(); chat.dispose(); await server.stop(); await model.stop(); }
