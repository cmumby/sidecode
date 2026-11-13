import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { modelFixture } from './fixtures/model';
import { isolatedServer } from './fixtures/server';
/** Read-mostly discovery of 1.19.4 file/context parts on an isolated server with temporary files. */
const model = await modelFixture(10);
const server = await isolatedServer(model.config);
try {
  await server.start();
  const directory = server.project;
  await mkdir(join(directory, 'src'));
  await writeFile(join(directory, 'src', 'a.ts'), Array.from({ length: 30 }, (_, n) => `const line${n + 1} = ${n + 1}; // MARK_A`).join('\n'));
  await writeFile(join(directory, 'notes with space.md'), '# Notes MARK_NOTES\n');
  const outside = await mkdtemp(join(tmpdir(), 'sidecode-outside-'));
  await writeFile(join(outside, 'secret.txt'), 'MARK_OUTSIDE');
  const client = createOpencodeClient({ baseUrl: server.baseUrl, headers: server.headers, directory, throwOnError: true });
  const errors: string[] = []; const controller = new AbortController();
  const events = await client.event.subscribe({ directory }, { signal: controller.signal });
  void (async () => { for await (const e of events.stream) if (e.type === 'session.error') errors.push(JSON.stringify(e.properties).slice(0, 300)); })().catch(() => {});

  async function run(label: string, parts: unknown[]) {
    const session = (await client.session.create({ directory })).data!;
    const before = model.requests.length;
    try { await client.session.promptAsync({ directory, sessionID: session.id, parts: parts as never }); }
    catch (error) { console.log(`\n== ${label}: promptAsync threw`, String(error).slice(0, 200)); return; }
    for (let i = 0; i < 100; i++) { await pause(100); const s = (await client.session.status({ directory })).data as Record<string, { type: string }>; if (!s[session.id] || s[session.id]!.type === 'idle') break; }
    console.log(`\n== ${label}`);
    const messages = (await client.session.messages({ directory, sessionID: session.id })).data!;
    for (const m of messages) for (const p of m.parts as unknown as Record<string, unknown>[]) {
      console.log(' ', m.info.role, JSON.stringify(Object.fromEntries(Object.entries(p).filter(([key]) => !['id', 'sessionID', 'messageID'].includes(key)))).slice(0, 350));
    }
    const sent = model.requests.slice(before).find(r => JSON.stringify(r).includes('MARK') || JSON.stringify(r).includes('hello')) as { messages?: { role: string; content: unknown }[] } | undefined;
    const user = sent?.messages?.filter(m => m.role === 'user').at(-1);
    console.log('  model saw:', JSON.stringify(user?.content ?? null).slice(0, 700));
    if (errors.length) console.log('  session.error:', errors.splice(0));
  }
  const file = (path: string, extra: Record<string, unknown> = {}) => ({ type: 'file', mime: 'text/plain', filename: path.split('/').at(-1), url: pathToFileURL(path).href, ...extra });
  await run('whole file', [{ type: 'text', text: 'hello' }, file(join(directory, 'src', 'a.ts'))]);
  await run('line range via query', [{ type: 'text', text: 'hello' }, { ...file(join(directory, 'src', 'a.ts')), url: pathToFileURL(join(directory, 'src', 'a.ts')).href + '?start=5&end=7' }]);
  await run('file with source', [{ type: 'text', text: 'hello @src/a.ts' }, file(join(directory, 'src', 'a.ts'), { source: { type: 'file', path: 'src/a.ts', text: { value: '@src/a.ts', start: 6, end: 15 } } })]);
  await run('space in name', [{ type: 'text', text: 'hello' }, file(join(directory, 'notes with space.md'))]);
  await run('directory', [{ type: 'text', text: 'hello' }, { ...file(join(directory, 'src')), mime: 'application/x-directory' }]);
  await run('outside project', [{ type: 'text', text: 'hello' }, file(join(outside, 'secret.txt'))]);
  await run('missing file', [{ type: 'text', text: 'hello' }, file(join(directory, 'missing.ts'))]);
  await run('data url', [{ type: 'text', text: 'hello' }, { type: 'file', mime: 'text/plain', filename: 'selection.ts', url: 'data:text/plain;base64,' + Buffer.from('const MARK_DATA = 1;').toString('base64') }]);
  controller.abort();
} finally { await server.stop(); await model.stop(); }
