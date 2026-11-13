import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { modelFixture } from './fixtures/model';
import { isolatedServer } from './fixtures/server';
/** Read-mostly discovery of 1.19.4 edit/write tool parts, edit permissions and session diffs (temporary project). */
const model = await modelFixture(10);
const server = await isolatedServer({ ...model.config, permission: { edit: 'ask' } });
try {
  await mkdir(join(server.project, 'src'));
  await writeFile(join(server.project, 'src', 'a.ts'), 'export const value = 1;\nexport const other = 0;\n');
  // SIDECODE_GIT=1: same run inside a git repository (session.diff relies on snapshots).
  if (process.env.SIDECODE_GIT) for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']]) execFileSync('git', args, { cwd: server.project });
  await server.start();
  const directory = server.project;
  const client = createOpencodeClient({ baseUrl: server.baseUrl, headers: server.headers, directory, throwOnError: true });
  const asked: Record<string, unknown>[] = []; const log: string[] = []; const controller = new AbortController();
  const events = await client.event.subscribe({ directory }, { signal: controller.signal });
  void (async () => { for await (const e of events.stream) {
    if (e.type === 'permission.asked') asked.push(e.properties as Record<string, unknown>);
    if (/^(session\.diff|file\.|session\.error)/.test(e.type)) log.push(`${e.type} ${JSON.stringify(e.properties).slice(0, 400)}`);
  } })().catch(() => {});
  for (const marker of ['RUN_EDIT', 'RUN_WRITE']) {
    const session = (await client.session.create({ directory })).data!;
    asked.length = 0; log.length = 0;
    await client.session.promptAsync({ directory, sessionID: session.id, parts: [{ type: 'text', text: `${marker} please` }] });
    for (let i = 0; i < 100 && !asked.length; i++) await pause(100);
    console.log(`\n== ${marker} permission.asked:`, JSON.stringify(asked[0], null, 1)?.slice(0, 1500));
    if (asked[0]) await client.permission.reply({ directory, requestID: String(asked[0].id), reply: 'once' });
    for (let i = 0; i < 100; i++) { await pause(100); const s = (await client.session.status({ directory })).data as Record<string, { type: string }>; if (!s[session.id] || s[session.id]!.type === 'idle') break; }
    const messages = (await client.session.messages({ directory, sessionID: session.id })).data!;
    for (const m of messages) for (const p of m.parts as unknown as Record<string, unknown>[]) {
      if (p.type === 'tool') { const st = p.state as Record<string, unknown>; console.log('tool', p.tool, st.status, 'input', JSON.stringify(st.input), '\n  title', st.title, '\n  metadata', JSON.stringify(st.metadata).slice(0, 900)); }
      if (p.type === 'patch') console.log('patch part', JSON.stringify(p));
      if (p.type !== 'text' && p.type !== 'tool' && p.type !== 'step-start' && p.type !== 'step-finish') console.log('other part', p.type);
    }
    const userId = messages.find(m => m.info.role === 'user')!.info.id;
    console.log('session.diff(all)', JSON.stringify((await client.session.diff({ directory, sessionID: session.id })).data).slice(0, 700));
    console.log('session.diff(message)', JSON.stringify((await client.session.diff({ directory, sessionID: session.id, messageID: userId })).data).slice(0, 700));
    const info = (await client.session.get({ directory, sessionID: session.id })).data as unknown as Record<string, unknown>;
    console.log('session.summary', JSON.stringify(info.summary).slice(0, 400));
    console.log('events', log);
  }
  console.log('\nfile now:', JSON.stringify(await readFile(join(server.project, 'src', 'a.ts'), 'utf8')), JSON.stringify(await readFile(join(server.project, 'notes.md'), 'utf8').catch(() => null)));
  try { console.log('vcs.diff', JSON.stringify((await client.vcs.diff({ directory, mode: 'git' })).data).slice(0, 300)); } catch (e) { console.log('vcs.diff failed', String(e).slice(0, 150)); }
  controller.abort();
} finally { await server.stop(); await model.stop(); }
