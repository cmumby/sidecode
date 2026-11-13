import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { Chat } from '../src/adapter/chat';
import { Connection } from '../src/adapter/connection';
import { createConversations } from '../src/adapter/conversations';
import { applyPatch } from '../src/adapter/patch';
import { createTransport } from '../src/adapter/transport';
import { projectTarget } from '../src/extension/context';
import { modelFixture } from './fixtures/model';
import { isolatedServer } from './fixtures/server';

/**
 * File changes against isolated OpenCode 1.19.4 with `permission.edit = "ask"` in a
 * temporary non-git project: the edit is reviewable before approval (patch applies to
 * the file on disk), held until answered, and afterwards reversible into a before view.
 */
const model = await modelFixture(20);
const server = await isolatedServer({ ...model.config, permission: { edit: 'ask' } });
const options = { baseUrl: server.baseUrl, directory: server.project, credentials: server.credentials };
const chat = new Chat(50);
const connection = new Connection();
connection.subscribe(state => chat.connection(state.phase === 'connected'));
connection.onEvent(event => chat.event(event));
async function waitFor(predicate: () => boolean, label: string) {
  for (let count = 0; count < 300; count++) { if (predicate()) return; await pause(50); }
  throw new Error(`Timed out: ${label}; error=${chat.state.error}; busy=${chat.state.busy}; permissions=${chat.state.permissions.length}`);
}
const idle = () => !chat.state.busy && !chat.state.loading && chat.state.operation === 'none';
const tools = () => chat.state.messages.flatMap(m => m.tools);
const original = 'export const value = 1;\nexport const other = 0;\n';
const file = join(server.project, 'src', 'a.ts');
try {
  await mkdir(join(server.project, 'src')); await writeFile(file, original);
  await server.start();
  chat.attach(createConversations(options)); void connection.connect(createTransport(options));
  await waitFor(() => connection.state.phase === 'connected', 'connected');

  await chat.create(); await waitFor(() => idle() && !!chat.state.selectedId, 'session');
  const session = chat.state.selectedId!;
  await chat.send(session, 'RUN_EDIT please', 'req_edit');
  await waitFor(() => chat.state.permissions.length === 1, 'edit permission');
  const request = chat.state.permissions[0]!;
  assert.equal(request.permission, 'edit');
  assert.deepEqual(request.change, { label: 'src/a.ts', additions: 1, deletions: 1, diff: true });
  const review = chat.reviewSource(session, request.id)!;
  const target = await projectTarget(server.project, review.path);
  assert.equal(target?.label, 'src/a.ts');
  assert.equal(applyPatch(await readFile(target!.path, 'utf8'), review.patch!), 'export const value = 2; // sidecode-edited\nexport const other = 0;\n', 'proposed version builds from disk');
  await pause(1000);
  assert.equal(await readFile(file, 'utf8'), original, 'nothing written while the review is pending');
  assert.doesNotMatch(JSON.stringify(chat.state), new RegExp(server.project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  console.log('PASS: edit permission carries a reviewable proposed change; file untouched until answered');

  await chat.reply(session, request.id, 'once');
  await waitFor(() => idle() && tools().some(t => t.tool === 'edit' && t.status === 'completed'), 'edit completed');
  const edit = tools().find(t => t.tool === 'edit')!;
  assert.deepEqual(edit.change, { label: 'src/a.ts', additions: 1, deletions: 1, diff: true });
  const source = chat.changeSource(session, edit.id)!;
  assert.equal(applyPatch(await readFile(file, 'utf8'), source.patch!, true), original, 'before view reconstructs the original');
  console.log('PASS: completed edit shows label/counts; before ↔ after view reconstructs from the file');

  await chat.send(session, 'RUN_WRITE please', 'req_write');
  await waitFor(() => chat.state.permissions.length === 1, 'write permission');
  assert.deepEqual(chat.state.permissions[0]!.change, { label: 'notes.md', additions: 2, deletions: 0, diff: true });
  const proposedTarget = await projectTarget(server.project, chat.reviewSource(session, chat.state.permissions[0]!.id)!.path);
  assert.equal(proposedTarget?.exists, false, 'new file previewed against empty');
  assert.equal(applyPatch('', chat.reviewSource(session, chat.state.permissions[0]!.id)!.patch!), '# Notes\nsidecode-written\n');
  await chat.reply(session, chat.state.permissions[0]!.id, 'reject');
  await waitFor(() => idle() && tools().some(t => t.tool === 'write' && t.status === 'error'), 'write rejected');
  assert.equal(tools().find(t => t.tool === 'write')!.change, null, 'a rejected write has no change');
  await assert.rejects(readFile(join(server.project, 'notes.md')), 'rejected write did not create the file');
  console.log('PASS: proposed new file is previewable; Deny leaves no file and no change row');
} finally { connection.dispose(); chat.dispose(); await server.stop(); await model.stop(); }
