import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { OpenCode } from '@opencode/client';
import { modelFixture } from './fixtures/model';

/**
 * Discovery only (OpenCode 2.3.0): session permission rules (append or replace, and whether
 * they override the configuration), "always" replies, interrupt, compaction, prompt IDs,
 * file attachments, and what history shows while a reply streams.
 */
const binary = join(process.cwd(), 'node_modules', '@opencode', `cli-${process.platform}-${process.arch}`, 'bin', 'opencode');
async function server(config: Record<string, unknown>, delay = 20) {
  const root = await mkdtemp(join(tmpdir(), 'sidecode-v2b-'));
  const project = join(root, 'project'); await mkdir(join(project, 'src'), { recursive: true });
  for (const dir of ['home', 'config', 'data', 'cache', 'state', 'tmp']) await mkdir(join(root, dir));
  const model = await modelFixture(delay);
  const port = 40000 + Math.floor(Math.random() * 10000);
  const env = { PATH: process.env.PATH, HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), TMPDIR: join(root, 'tmp'),
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...model.config, ...config }), OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_FREE_MODELS: '1', OPENCODE_SERVER_PASSWORD: 'probe-secret' };
  const child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: root, env, stdio: 'ignore' });
  const client = OpenCode.make({ baseUrl: `http://127.0.0.1:${port}`, headers: { Authorization: `Basic ${Buffer.from('opencode:probe-secret').toString('base64')}` } });
  for (let i = 0; i < 100; i++) { try { await client.server.info(); break; } catch { await pause(100); } }
  const location = { directory: project };
  return { client, project, location, model, stop: async () => { child.kill('SIGTERM'); await model.stop(); } };
}
type Client = Awaited<ReturnType<typeof server>>['client'];
const show = (label: string, value: unknown) => console.log(`--- ${label}: ${JSON.stringify(value, (_k, v) => typeof v === 'string' ? v.replace(/\/tmp\/sidecode-v2b-[^/"]+/g, '<root>') : v).slice(0, 1500)}`);
const attempt = async (label: string, work: () => Promise<unknown>) => { try { show(label, await work()); } catch (error) { show(`${label} FAILED`, { ...(error as object), message: (error as Error).message }); } };
async function idle(client: Client, sessionID: string, limit = 100) {
  for (let i = 0; i < limit; i++) { await pause(100); const active = await client.session.active(); if (!active[sessionID]) return true; }
  return false;
}
async function edit(s: Awaited<ReturnType<typeof server>>, sessionID: string, reply: 'once' | 'always' | 'reject' = 'reject') {
  await writeFile(join(s.project, 'src', 'a.ts'), 'export const value = 1;\n');
  await s.client.session.prompt({ sessionID, text: 'RUN_EDIT please' });
  for (let i = 0; i < 60; i++) {
    await pause(100);
    const pending = await s.client.permission.list({ sessionID });
    if (pending.length) { await s.client.permission.reply({ sessionID, requestID: pending[0]!.id, decision: reply }); await idle(s.client, sessionID); return `asked→${reply}`; }
    if (!(await s.client.session.active())[sessionID] && i > 5) break;
  }
  return /sidecode-edited/.test(await readFile(join(s.project, 'src', 'a.ts'), 'utf8')) ? 'applied' : 'not applied';
}

// 1. Session rules: append or replace? Do they override the configuration?
{
  const s = await server({});
  const session = await s.client.session.create({ location: s.location });
  show('default edit', await edit(s, session.id));
  await s.client.session.update({ sessionID: session.id, permissions: [{ action: 'edit', resource: '*', effect: 'ask' }] });
  show('rules after ask', (await s.client.session.get({ sessionID: session.id })).permissions);
  show('edit with session ask', await edit(s, session.id));
  await s.client.session.update({ sessionID: session.id, permissions: [{ action: 'edit', resource: '*', effect: 'allow' }] });
  show('rules after allow', (await s.client.session.get({ sessionID: session.id })).permissions);
  show('edit with session allow', await edit(s, session.id));
  const created = await s.client.session.create({ location: s.location, permissions: [{ action: 'edit', resource: '*', effect: 'ask' }] });
  show('created with ask', created.permissions);
  show('edit in created-with-ask', await edit(s, created.id));
  // "always": what is saved, and does it persist beyond the session?
  show('always reply', await edit(s, created.id, 'always'));
  await attempt('saved after always', async () => s.client.permission.saved.list({ projectID: (await s.client.location.get({ location: s.location })).project.id }));
  const other = await s.client.session.create({ location: s.location, permissions: [{ action: 'edit', resource: '*', effect: 'ask' }] });
  show('edit in another session after always', await edit(s, other.id));
  // Prompt ID format and an interrupted reply.
  await attempt('prompt with our id', () => s.client.session.prompt({ sessionID: session.id, id: `msg_${Date.now().toString(16)}${'ab'.repeat(12)}`, text: 'hello' }));
  await idle(s.client, session.id);
  await s.client.session.prompt({ sessionID: session.id, text: 'RUN_SLOW' });
  await pause(800);
  const midway = await s.client.message.list({ sessionID: session.id, limit: 3, order: 'desc' });
  show('history mid-tool', midway.data.map(m => ({ type: m.type, ...(m.type === 'assistant' ? { completed: m.time.completed, content: m.content.map(c => c.type === 'tool' ? { tool: c.name, status: c.state.status, time: c.time, metadata: 'metadata' in c.state ? c.state.metadata : undefined } : { type: c.type, len: c.text.length }) } : {}) })));
  await attempt('interrupt', () => s.client.session.interrupt({ sessionID: session.id }));
  await idle(s.client, session.id);
  const after = await s.client.message.list({ sessionID: session.id, limit: 3, order: 'desc' });
  show('history after interrupt', after.data);
  // Compaction.
  await attempt('compact', () => s.client.session.compact({ sessionID: session.id }));
  show('active during compact', await s.client.session.active());
  await idle(s.client, session.id, 200);
  const compacted = await s.client.message.list({ sessionID: session.id, limit: 4, order: 'desc' });
  show('history after compact', compacted.data);
  // File attachments.
  await writeFile(join(s.project, 'src', 'b.ts'), 'export const b = 2;\n');
  await attempt('prompt with file uri', () => s.client.session.prompt({ sessionID: session.id, text: 'look', files: [{ uri: `file://${join(s.project, 'src', 'b.ts')}`, name: 'src/b.ts' }] }));
  await idle(s.client, session.id);
  await attempt('prompt with folder uri', () => s.client.session.prompt({ sessionID: session.id, text: 'look', files: [{ uri: `file://${join(s.project, 'src')}`, name: 'src' }] }));
  await idle(s.client, session.id);
  await attempt('prompt with data uri', () => s.client.session.prompt({ sessionID: session.id, text: 'look', files: [{ uri: `data:text/plain;base64,${Buffer.from('selected text').toString('base64')}`, name: 'a.ts (lines 1-2)', source: { type: 'inline' } }] }));
  await idle(s.client, session.id);
  const withFiles = await s.client.message.list({ sessionID: session.id, limit: 12, order: 'desc', type: 'user' });
  show('user messages with files', withFiles.data);
  const requests = s.model.requests.slice(-6).map(r => JSON.stringify((r as { messages?: unknown[] }).messages?.slice(-1)).slice(0, 600));
  show('what the model saw (last user turns)', requests);
  // Agent/model switching.
  await attempt('switch agent', () => s.client.session.switchAgent({ sessionID: session.id, agent: 'plan' }));
  await attempt('switch agent unknown', () => s.client.session.switchAgent({ sessionID: session.id, agent: 'nope' }));
  await attempt('switch model', () => s.client.session.switchModel({ sessionID: session.id, model: { id: 'fixture', providerID: 'fixture' } }));
  await attempt('switch model unknown', () => s.client.session.switchModel({ sessionID: session.id, model: { id: 'nope', providerID: 'fixture' } }));
  show('session after switch', await s.client.session.get({ sessionID: session.id }));
  await attempt('rename', () => s.client.session.update({ sessionID: session.id, title: 'Renamed' }));
  await attempt('archive', () => s.client.session.update({ sessionID: other.id, archived: true }));
  show('list default', (await s.client.session.list({ directory: s.project })).data.map(x => ({ id: x.id, title: x.title, archived: x.time.archived })));
  await s.stop();
}
// 2. A configuration that requires approval: does a session allow override it?
{
  const s = await server({ permission: { edit: 'ask' } });
  const session = await s.client.session.create({ location: s.location });
  show('config ask', await edit(s, session.id));
  await s.client.session.update({ sessionID: session.id, permissions: [{ action: 'edit', resource: '*', effect: 'allow' }] });
  show('config ask + session allow', await edit(s, session.id));
  show('config entries', (await s.client.config.get({ location: s.location })).map(e => e.type === 'document' ? e.info.permissions : e));
  await s.stop();
}
// 3. A failing provider: the error and how the failure is recorded.
{
  const s = await server({});
  const session = await s.client.session.create({ location: s.location });
  await s.client.session.prompt({ sessionID: session.id, text: 'FAIL_500' });
  await pause(3000);
  show('history while retrying', (await s.client.message.list({ sessionID: session.id, limit: 2, order: 'desc' })).data);
  await s.client.session.interrupt({ sessionID: session.id });
  await idle(s.client, session.id);
  show('history after stop', (await s.client.message.list({ sessionID: session.id, limit: 3, order: 'desc' })).data);
  await s.client.session.switchModel({ sessionID: session.id, model: { id: 'missing', providerID: 'fixture' } }).catch(() => undefined);
  await attempt('prompt after bad model', () => s.client.session.prompt({ sessionID: session.id, text: 'hello' }));
  await idle(s.client, session.id);
  show('history after bad model', (await s.client.message.list({ sessionID: session.id, limit: 3, order: 'desc' })).data);
  await s.stop();
}
