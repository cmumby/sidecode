import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import { setTimeout as pause } from 'node:timers/promises';
import { modelFixture } from './fixtures/model';
import { isolatedServer } from './fixtures/server';
/** What happens to a pending permission when its session is aborted (1.19.4)? */
const model = await modelFixture(50);
const server = await isolatedServer({ ...model.config, permission: { bash: 'ask' } });
try {
  await server.start();
  const dir = server.project;
  const c = createOpencodeClient({ baseUrl: server.baseUrl, headers: server.headers, directory: dir, throwOnError: true });
  const s = (await c.session.create({ directory: dir })).data!;
  await c.session.promptAsync({ directory: dir, sessionID: s.id, parts: [{ type: 'text', text: 'RUN_TOOL' }] });
  let list: { id: string; sessionID: string }[] = [];
  for (let i = 0; i < 60 && !list.length; i++) { list = (await c.permission.list({ directory: dir })).data as typeof list; await pause(100); }
  console.log('pending before abort', list.length);
  console.log('abort', (await c.session.abort({ directory: dir, sessionID: s.id })).data);
  for (const wait of [200, 1000, 3000]) { await pause(wait); console.log(`after +${wait}ms pending`, ((await c.permission.list({ directory: dir })).data as unknown[]).length, 'status', JSON.stringify((await c.session.status({ directory: dir })).data)); }
  const calls = model.requests.length;
  try { console.log('reply once to stale request ->', (await c.permission.reply({ directory: dir, requestID: list[0]!.id, reply: 'once' })).data); } catch (e) { console.log('reply rejected', String(e).slice(0, 120)); }
  await pause(1500);
  const msgs = (await c.session.messages({ directory: dir, sessionID: s.id })).data!;
  console.log('tool states after reply', msgs.flatMap(m => m.parts).filter(p => p.type === 'tool').map(p => p.type === 'tool' ? p.state.status + ':' + ('output' in p.state ? p.state.output.trim() : 'error' in p.state ? p.state.error : '') : ''));
  console.log('pending after reply', ((await c.permission.list({ directory: dir })).data as unknown[]).length, 'new model calls', model.requests.length - calls, 'status', JSON.stringify((await c.session.status({ directory: dir })).data));
} finally { await server.stop(); await model.stop(); }
