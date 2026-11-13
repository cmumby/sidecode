import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { Chat } from '../src/adapter/chat';
import { Connection } from '../src/adapter/connection';
import { createConversations } from '../src/adapter/conversations';
import { createTransport } from '../src/adapter/transport';
import { modelFixture } from './fixtures/model';
import { isolatedServer } from './fixtures/server';

/**
 * Per-session "ask before edits" against isolated OpenCode 2.3.0 (session permission rules,
 * nothing written to configuration): toggling on makes edits ask, off lets them apply,
 * the remembered default applies to new sessions, and a configuration that requires
 * approval is never relaxed.
 */
async function withServer(config: Record<string, unknown>, work: (chat: Chat, file: string) => Promise<void>) {
  const model = await modelFixture(20);
  const server = await isolatedServer({ ...model.config, ...config });
  const options = { baseUrl: server.baseUrl, directory: server.project, credentials: server.credentials };
  const chat = new Chat(50); const connection = new Connection();
  connection.subscribe(state => chat.connection(state.phase === 'connected'));
  connection.onEvent(event => chat.event(event));
  try {
    await mkdir(join(server.project, 'src'));
    await server.start();
    chat.attach(createConversations(options)); void connection.connect(createTransport(options));
    await waitFor(chat, () => connection.state.phase === 'connected' && chat.state.agents.length > 0, 'connected');
    await work(chat, join(server.project, 'src', 'a.ts'));
  } finally { connection.dispose(); chat.dispose(); await server.stop(); await model.stop(); }
}
async function waitFor(chat: Chat, predicate: () => boolean, label: string) {
  for (let count = 0; count < 300; count++) { if (predicate()) return; await pause(50); }
  throw new Error(`Timed out: ${label}; busy=${chat.state.busy} permissions=${chat.state.permissions.length} error=${chat.state.error}`);
}
const idle = (chat: Chat) => !chat.state.busy && !chat.state.loading && chat.state.operation === 'none';
/** Sends RUN_EDIT; returns whether OpenCode asked (and denies it) or the edit applied. */
async function edit(chat: Chat, file: string): Promise<'asked' | 'applied'> {
  await writeFile(file, 'export const value = 1;\nexport const other = 0;\n');
  await chat.send(chat.state.selectedId!, 'RUN_EDIT please', `req_${Date.now()}`);
  await waitFor(chat, () => chat.state.permissions.length > 0 || (idle(chat) && chat.state.messages.some(m => m.tools.some(t => t.tool === 'edit' && t.status !== 'running' && t.status !== 'pending'))), 'edit outcome');
  if (chat.state.permissions.length) {
    await chat.reply(chat.state.selectedId!, chat.state.permissions[0]!.id, 'reject');
    await waitFor(chat, () => idle(chat), 'after deny');
    assert.doesNotMatch(await readFile(file, 'utf8'), /sidecode-edited/);
    return 'asked';
  }
  let content = await readFile(file, 'utf8');
  // The step can be reported complete a moment before the file write is visible.
  for (let count = 0; count < 30 && !/sidecode-edited/.test(content); count++) { await pause(100); content = await readFile(file, 'utf8'); }
  if (!/sidecode-edited/.test(content)) console.error('edit step:', JSON.stringify(chat.state.messages.flatMap(m => m.tools).filter(t => t.tool === 'edit').map(t => ({ status: t.status, detail: t.detail.slice(0, 200) }))));
  assert.match(content, /sidecode-edited/);
  return 'applied';
}
const session = (chat: Chat) => chat.state.sessions.find(s => s.id === chat.state.selectedId)!;

await withServer({}, async (chat, file) => {
  assert.equal(chat.state.editPolicy, null, 'no configured policy (OpenCode default: allow)');
  await chat.create(); await waitFor(chat, () => idle(chat) && !!chat.state.selectedId, 'session');
  assert.equal(await edit(chat, file), 'applied', 'OpenCode default: edits apply');
  await chat.setEditApproval(chat.state.selectedId!, true);
  assert.equal(session(chat).edit, 'ask');
  assert.equal(await edit(chat, file), 'asked', 'toggle on: OpenCode asks before the edit');
  await chat.setEditApproval(chat.state.selectedId!, false);
  assert.equal(session(chat).edit, 'allow');
  assert.equal(await edit(chat, file), 'applied', 'toggle off: edits apply again');
  chat.askNewSessions = true;
  await chat.create(); await waitFor(chat, () => idle(chat) && session(chat)?.edit === 'ask', 'new session starts asking');
  assert.equal(await edit(chat, file), 'asked', 'remembered default applies to new sessions');
  await chat.refresh();
  assert.equal(session(chat).edit, 'ask', 'state read back from the server after refresh');
  console.log('PASS: toggle on asks, off applies, the remembered default carries to new sessions, state survives refresh');
});

await withServer({ permission: { edit: 'ask' } }, async (chat, file) => {
  assert.equal(chat.state.editPolicy, 'ask');
  await chat.create(); await waitFor(chat, () => idle(chat) && !!chat.state.selectedId, 'session');
  await chat.setEditApproval(chat.state.selectedId!, false);
  assert.equal(session(chat).edit, null, 'no allow rule added');
  assert.equal(await edit(chat, file), 'asked', 'configuration still requires approval');
  console.log('PASS: a configuration that requires approval cannot be relaxed from Sidecode');
});
