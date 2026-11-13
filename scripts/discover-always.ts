import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { modelFixture } from './fixtures/model';
import { isolatedServer } from './fixtures/server';
async function files(dir: string): Promise<string[]> { const out: string[] = []; for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) { const p = join(dir, e.name); if (e.isDirectory()) out.push(...await files(p)); else out.push(`${p}:${(await stat(p)).mtimeMs}`); } return out; }
const model = await modelFixture(50);
const server = await isolatedServer({ ...model.config, permission: { bash: 'ask' } });
try {
  await server.start();
  const dir = server.project;
  const client = createOpencodeClient({ baseUrl: server.baseUrl, headers: server.headers, directory: dir, throwOnError: true });
  const watched = [join(server.root, 'config'), dir];
  const before = new Set((await Promise.all(watched.map(files))).flat());
  async function run(label: string, reply?: 'always') {
    const s = (await client.session.create({ directory: dir })).data!;
    await client.session.promptAsync({ directory: dir, sessionID: s.id, parts: [{ type: 'text', text: 'RUN_TOOL' }] });
    let asked: { id: string } | undefined;
    for (let i = 0; i < 60; i++) { const l = (await client.permission.list({ directory: dir })).data as { id: string; sessionID: string }[]; asked = l.find(p => p.sessionID === s.id); const st = (await client.session.status({ directory: dir })).data as Record<string, { type: string }>; if (asked || (i > 5 && (!st[s.id] || st[s.id]!.type === 'idle'))) break; await pause(100); }
    console.log(label, asked ? 'ASKED' : 'not asked (auto-allowed)');
    if (asked && reply) await client.permission.reply({ directory: dir, requestID: asked.id, reply });
    else if (asked) await client.permission.reply({ directory: dir, requestID: asked.id, reply: 'reject' });
    for (let i = 0; i < 60; i++) { const st = (await client.session.status({ directory: dir })).data as Record<string, { type: string }>; if (!st[s.id] || st[s.id]!.type === 'idle') break; await pause(100); }
  }
  await run('session 1 (reply always):', 'always');
  await run('session 2 same server:');
  const changed = (await Promise.all(watched.map(files))).flat().filter(f => !before.has(f));
  console.log('changed files outside node_modules:', changed.filter(f => !f.includes('node_modules') && !f.includes('/bun.lock')).map(f => f.replace(server.root, '<root>')));
  await server.stop(); await server.start();
  await run('session 3 after server restart:');
} finally { await server.stop(); await model.stop(); }
