import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { OpenCode } from '@opencode/client';
import { modelFixture } from './fixtures/model';

/** Discovery only: how an isolated OpenCode 2.3.0 server behaves (auth, location, sessions, events). */
const binary = join(process.cwd(), 'node_modules', '@opencode', `cli-${process.platform}-${process.arch}`, 'bin', 'opencode');
const root = await mkdtemp(join(tmpdir(), 'sidecode-v2-'));
const project = join(root, 'project'); await mkdir(join(project, 'src'), { recursive: true });
await writeFile(join(project, 'src', 'a.ts'), 'export const value = 1;\n');
for (const dir of ['home', 'config', 'data', 'cache', 'state', 'tmp']) await mkdir(join(root, dir));
const model = await modelFixture(20);
const extra = process.argv[2] ? JSON.parse(process.argv[2]) as Record<string, unknown> : {};
const port = 40000 + Math.floor(Math.random() * 10000);
const env = {
  PATH: process.env.PATH, HOME: join(root, 'home'),
  XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), TMPDIR: join(root, 'tmp'),
  OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...model.config, ...extra }), OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_FREE_MODELS: '1',
  OPENCODE_SERVER_PASSWORD: 'probe-secret',
};
const server = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${port}`;
const show = (label: string, value: unknown, max = 3000) => console.log(`--- ${label}\n${typeof value === 'string' ? value : JSON.stringify(value, null, 1)?.slice(0, max)}`);
const client = OpenCode.make({ baseUrl: base, headers: { Authorization: `Basic ${Buffer.from('opencode:probe-secret').toString('base64')}` } });
const attempt = async (label: string, work: () => Promise<unknown>, max?: number) => { try { show(label, await work(), max); } catch (error) { show(`${label} FAILED`, { name: (error as Error).name, message: (error as Error).message, ...(error as object) }); } };
const location = { directory: project };
const mode = process.argv[3] ?? 'basic';
try {
  for (let i = 0; i < 100; i++) { try { await client.server.info(); break; } catch { await pause(100); } }
  await attempt('location', () => client.location.get({ location }));
  await attempt('location missing', () => client.location.get({ location: { directory: '/nonexistent/sidecode' } }));
  await attempt('agents', async () => (await client.agent.list({ location })).data.map(a => ({ id: a.id, name: a.name, mode: a.mode, hidden: a.hidden })));
  await attempt('models', () => client.model.list({ location }), 2000);
  await attempt('model default', () => client.model.default({ location }));
  await attempt('config', () => client.config.get({ location }), 1500);
  const session = await client.session.create({ location });
  show('session', session);
  const events: unknown[] = [];
  const controller = new AbortController();
  void (async () => { try { for await (const event of client.event.subscribe({ signal: controller.signal })) events.push(event); } catch (error) { events.push({ streamError: String(error) }); } })();
  await pause(300);
  const prompts = mode === 'basic' ? ['hello', 'RUN_TOOL go', 'RUN_REASON think'] : mode === 'edit' ? ['RUN_EDIT please'] : mode === 'write' ? ['RUN_WRITE please'] : mode === 'long' ? ['RUN_LONGWRITE please'] : mode === 'fail' ? ['FAIL_500'] : mode === 'slow' ? ['RUN_SLOW'] : [mode];
  for (const text of prompts) {
    await attempt(`prompt ${text}`, () => client.session.prompt({ sessionID: session.id, text }));
    for (let i = 0; i < 80; i++) {
      await pause(100);
      const asked = events.find(e => (e as { type: string }).type === 'permission.asked') as { data: { id: string } } | undefined;
      if (asked && mode !== 'fail') { show('permission list', await client.permission.list({ sessionID: session.id })); await attempt('reply', () => client.permission.reply({ sessionID: session.id, requestID: asked.data.id, decision: process.argv[4] === 'reject' ? 'reject' : 'once' })); events.push({ replied: true }); break; }
      if (events.some(e => ['session.execution.succeeded', 'session.execution.failed', 'session.idle'].includes((e as { type: string }).type))) break;
    }
    await pause(mode === 'fail' ? 6000 : 1500);
    if (mode === 'fail') await attempt('interrupt', () => client.session.interrupt({ sessionID: session.id }));
  }
  await pause(500);
  const compact = new Map<string, number>();
  for (const event of events) { const type = (event as { type?: string }).type ?? 'other'; compact.set(type, (compact.get(type) ?? 0) + 1); }
  show('event counts', Object.fromEntries(compact));
  const seen = new Set<string>();
  show('first of each event type', events.filter(e => { const t = (e as { type?: string }).type ?? JSON.stringify(e); if (seen.has(t)) return false; seen.add(t); return true; }), 40000);
  await attempt('messages', () => client.message.list({ sessionID: session.id }), 30000);
  await attempt('session get', () => client.session.get({ sessionID: session.id }));
  await attempt('session active', () => client.session.active());
  await attempt('session list', () => client.session.list({ directory: project }), 1500);
  show('model saw tools', (model.requests.find(r => (r as { tools?: unknown[] }).tools?.length) as { tools?: { function: { name: string; parameters: unknown } }[] } | undefined)?.tools?.filter(t => ['edit', 'write', 'shell', 'read', 'question'].includes(t.function.name)).map(t => ({ name: t.function.name, parameters: t.function.parameters })), 20000);
  controller.abort();
} finally {
  server.kill('SIGTERM'); await model.stop();
  show('server log tail', log.slice(-2000));
}
