import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { applyPatch, patchStats } from '../src/adapter/patch';
import { Chat } from '../src/adapter/chat';
import { changeLabel, permissionChange, projectMessages, projectPermissions, toolChange, type ChangeSource, type ConversationApi } from '../src/adapter/conversations';
import { projectTarget } from '../src/extension/context';
import { isChatState, emptyChat } from '../src/shared/chat';
import { isWebviewMessage } from '../src/shared/protocol';

// Patches exactly as OpenCode 1.19.4 produced them (scripts/discover-diffs.ts).
const editPatch = 'Index: /p/src/a.ts\n===================================================================\n--- /p/src/a.ts\n+++ /p/src/a.ts\n@@ -1,2 +1,2 @@\n-export const value = 1;\n+export const value = 2; // sidecode-edited\n export const other = 0;\n';
const newFilePatch = 'Index: /p/notes.md\n===================================================================\n--- /p/notes.md\n+++ /p/notes.md\n@@ -0,0 +1,2 @@\n+# Notes\n+sidecode-written\n';
const before = 'export const value = 1;\nexport const other = 0;\n';
const after = 'export const value = 2; // sidecode-edited\nexport const other = 0;\n';

test('patches apply and reverse strictly', () => {
  assert.equal(applyPatch(before, editPatch), after);
  assert.equal(applyPatch(after, editPatch, true), before);
  assert.equal(applyPatch('', newFilePatch), '# Notes\nsidecode-written\n');
  assert.equal(applyPatch('# Notes\nsidecode-written\n', newFilePatch, true), '');
  assert.equal(applyPatch(before.replace(/\n/g, '\r\n'), editPatch), after.replace(/\n/g, '\r\n'), 'CRLF preserved');
  assert.equal(applyPatch('export const value = 9;\nexport const other = 0;\n', editPatch), undefined, 'mismatch refuses');
  assert.equal(applyPatch(after, editPatch), undefined, 'already applied refuses');
  assert.equal(applyPatch(before, 'not a patch'), undefined);
  assert.equal(applyPatch(before, '@@ -1,5 +1,1 @@\n-x\n'), undefined, 'inconsistent counts refuse');
  const noNewline = '--- a\n+++ b\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n';
  assert.equal(applyPatch('a', noNewline), 'b');
  const multi = '@@ -1,1 +1,1 @@\n-a\n+A\n@@ -3,1 +3,2 @@\n-c\n+C\n+D\n';
  assert.equal(applyPatch('a\nb\nc\n', multi), 'A\nb\nC\nD\n');
  assert.equal(applyPatch('A\nb\nC\nD\n', multi, true), 'a\nb\nc\n');
  assert.deepEqual(patchStats(editPatch), { additions: 1, deletions: 1 });
  assert.deepEqual(patchStats(newFilePatch), { additions: 2, deletions: 0 });
});

test('edit/write tool changes and edit permissions project labels and counts only', () => {
  const completed = (tool: string, metadata: unknown, input: unknown = {}) => ({ id: 'prt_t', tool, state: { status: 'completed', input, output: '', title: '', metadata } });
  const edit = toolChange(completed('edit', { diff: editPatch, filediff: { file: '/p/src/a.ts', patch: editPatch, additions: 1, deletions: 1 } }), '/p');
  assert.deepEqual(edit?.change, { label: 'src/a.ts', additions: 1, deletions: 1, diff: true });
  assert.deepEqual(edit?.source, { path: '/p/src/a.ts', patch: editPatch, created: false });
  const created = toolChange(completed('write', { filepath: '/p/notes.md', exists: false }, { content: '# Notes\nx\n' }), '/p');
  assert.deepEqual(created?.change, { label: 'notes.md', additions: 2, deletions: 0, diff: true });
  const overwrite = toolChange(completed('write', { filepath: '/p/notes.md', exists: true }, { content: 'x' }), '/p');
  assert.deepEqual(overwrite?.change, { label: 'notes.md', additions: 0, deletions: 0, diff: false });
  assert.equal(toolChange({ id: 'prt_t', tool: 'edit', state: { status: 'running', input: {} } }, '/p'), null);
  assert.equal(toolChange(completed('bash', { output: 'x' }), '/p'), null);
  assert.equal(changeLabel('/elsewhere/secret.txt', '/p'), 'secret.txt', 'outside: basename only');
  assert.equal(changeLabel('/p-evil/x.ts', '/p'), 'x.ts');

  const request = { id: 'per_e', sessionID: 'ses_a', permission: 'edit', patterns: ['p/src/a.ts'], always: ['*'], metadata: { filepath: '/p/src/a.ts', diff: editPatch } };
  const reviews: Record<string, ChangeSource> = {};
  const [prompt] = projectPermissions([request], 'ses_a', '/p', reviews);
  assert.deepEqual(prompt?.change, { label: 'src/a.ts', additions: 1, deletions: 1, diff: true });
  assert.equal(reviews.per_e?.patch, editPatch);
  assert.doesNotMatch(JSON.stringify(prompt), /Index:|\/p\/src/);
  assert.equal(permissionChange({ ...request, metadata: { filepath: '/p/a', diff: 'garbage' } }, '/p'), null, 'unparsable diff → no review');
  assert.equal(permissionChange({ ...request, permission: 'bash' }, '/p'), null);

  const info = { id: 'msg_a', sessionID: 'ses_a', role: 'assistant', time: { completed: 1 } };
  const [message] = projectMessages([{ info, parts: [{ ...completed('edit', { filediff: { file: '/p/src/a.ts', patch: editPatch } }), id: 'prt_t', sessionID: 'ses_a', messageID: 'msg_a', type: 'tool' }] }], 'ses_a', '/p');
  assert.equal(message?.tools[0]?.change?.label, 'src/a.ts'); assert.equal(message?.changes?.prt_t?.path, '/p/src/a.ts');
  assert.equal(isChatState({ ...emptyChat(), permissions: [prompt] }), true);
  assert.equal(isChatState({ ...emptyChat(), permissions: [{ ...prompt, change: { ...prompt!.change, path: '/p' } }] }), false);
});

test('change sources stay host-only and are found only for the selected session', async () => {
  const info = { id: 'msg_a', sessionID: 'ses_a', role: 'assistant', time: { completed: 1 } };
  const tool = { id: 'prt_t', sessionID: 'ses_a', messageID: 'msg_a', type: 'tool', tool: 'edit', state: { status: 'completed', input: {}, output: '', title: '', metadata: { filediff: { file: '/p/src/a.ts', patch: editPatch } } } };
  const reviews = { per_e: { path: '/p/src/a.ts', patch: editPatch, created: false } };
  const api: ConversationApi = {
    list: async () => [{ id: 'ses_a', title: 'A', edit: null }, { id: 'ses_b', title: 'B', edit: null }], create: async () => ({ id: 'ses_new', title: 'N', edit: null }), setEditRule: async (id, rule) => ({ id, title: 'A', edit: rule }),
    snapshot: async id => id === 'ses_a' ? { messages: projectMessages([{ info, parts: [tool] }], 'ses_a', '/p'), permissions: [{ id: 'per_e', permission: 'edit', patterns: [], always: [], change: { label: 'src/a.ts', additions: 1, deletions: 1, diff: true } }], busy: true, waiting: true, hasMore: false, reviews }
      : { messages: [], permissions: [], busy: false, waiting: false, hasMore: false },
    options: async () => ({ agents: [], models: [], editPolicy: null }), compact: async () => {}, send: async () => {}, stop: async () => {}, reply: async () => {},
  };
  const chat = new Chat(1); chat.attach(api); chat.connection(true); await chat.refresh(); await pause(5);
  try {
    const state = JSON.stringify(chat.state);
    assert.doesNotMatch(state, /\/p\/src|Index:|reviews|changes"/);
    assert.equal(chat.state.messages[0]?.tools[0]?.change?.label, 'src/a.ts');
    assert.equal(chat.changeSource('ses_a', 'prt_t')?.path, '/p/src/a.ts');
    assert.equal(chat.reviewSource('ses_a', 'per_e')?.patch, editPatch);
    assert.equal(chat.changeSource('ses_b', 'prt_t'), undefined); assert.equal(chat.reviewSource('ses_a', 'per_other'), undefined);
    await chat.select('ses_b');
    assert.equal(chat.changeSource('ses_a', 'prt_t'), undefined); assert.equal(chat.reviewSource('ses_a', 'per_e'), undefined);
  } finally { chat.dispose(); }
});

test('review/open commands carry IDs only', () => {
  assert.equal(isWebviewMessage({ version: 1, type: 'reviewPermission', sessionId: 'ses_a', requestId: 'per_a' }), true);
  assert.equal(isWebviewMessage({ version: 1, type: 'openChange', sessionId: 'ses_a', toolId: 'prt_a', view: 'diff' }), true);
  for (const value of [
    { version: 1, type: 'openChange', sessionId: 'ses_a', toolId: 'prt_a', view: 'write' },
    { version: 1, type: 'openChange', sessionId: 'ses_a', toolId: '/etc/passwd', view: 'file' },
    { version: 1, type: 'reviewPermission', sessionId: 'ses_a', requestId: 'per_a', path: '/x' },
  ]) assert.equal(isWebviewMessage(value), false);
});

test('change targets may be new files but must stay inside the real project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sidecode-target-'));
  const project = join(root, 'project');
  await mkdir(join(project, 'src'), { recursive: true }); await mkdir(join(root, 'outside'));
  await symlink(join(root, 'outside'), join(project, 'linked'));
  assert.deepEqual(await projectTarget(project, join(project, 'src', 'new', 'file.ts')), { path: join(project, 'src', 'new', 'file.ts'), label: 'src/new/file.ts', exists: false });
  assert.deepEqual(await projectTarget(project, 'src'), { path: join(project, 'src'), label: 'src', exists: true });
  for (const outside of [join(project, 'linked', 'new.ts'), join(root, 'outside', 'x.ts'), join(project, '..', 'x.ts'), project, '/etc/passwd']) {
    assert.equal(await projectTarget(project, outside), undefined, outside);
  }
});
