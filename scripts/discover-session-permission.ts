import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { modelFixture } from './fixtures/model';
import { isolatedServer } from './fixtures/server';
/** Discovery: per-session permission rules (session.update permission) on a server whose config sets none. */
const model = await modelFixture(10);
// CONFIG_ASK=1: the server config itself requires approval for edits.
const server = await isolatedServer(process.env.CONFIG_ASK ? { ...model.config, permission: { edit: 'ask' } } : model.config);
const controller = new AbortController();
try {
  await mkdir(join(server.project, 'src'));
  await server.start();
  const directory = server.project;
  const client = createOpencodeClient({ baseUrl: server.baseUrl, headers: server.headers, directory, throwOnError: true });
  const asked: Record<string, unknown>[] = [];
  const events = await client.event.subscribe({ directory }, { signal: controller.signal });
  void (async () => { for await (const e of events.stream) if (e.type === 'permission.asked') asked.push(e.properties as Record<string, unknown>); })().catch(() => {});
  const settle = async (id: string) => { for (let i = 0; i < 80; i++) { await pause(100); const s = (await client.session.status({ directory })).data as Record<string, unknown>; if (!s[id] && i > 3) return; if (asked.length) return; } };
  async function attempt(label: string, sessionID: string, marker = 'RUN_EDIT') {
    await writeFile(join(server.project, 'src', 'a.ts'), 'export const value = 1;\nexport const other = 0;\n');
    asked.length = 0;
    await client.session.promptAsync({ directory, sessionID, parts: [{ type: 'text', text: `${marker} please` }] });
    await settle(sessionID);
    const content = await readFile(join(server.project, 'src', 'a.ts'), 'utf8');
    console.log(`${label}: asked=${asked.length} ${asked[0] ? `(permission=${asked[0].permission})` : ''} edited=${content.includes('sidecode-edited')}`);
    if (asked[0]) { await client.permission.reply({ directory, requestID: String(asked[0].id), reply: 'reject' }); await settle(sessionID); }
  }
  const s1 = (await client.session.create({ directory })).data!;
  await attempt('default (no rules)', s1.id);
  const updated = await client.session.update({ directory, sessionID: s1.id, permission: [{ permission: 'edit', pattern: '*', action: 'ask' }] });
  console.log('update returns permission:', JSON.stringify((updated.data as unknown as Record<string, unknown>).permission));
  console.log('get shows permission:', JSON.stringify(((await client.session.get({ directory, sessionID: s1.id })).data as unknown as Record<string, unknown>).permission));
  await attempt('session edit=ask', s1.id);
  await attempt('session edit=ask, write tool', s1.id, 'RUN_WRITE');
  await client.session.update({ directory, sessionID: s1.id, permission: [{ permission: 'bash', pattern: '*', action: 'ask' }] });
  console.log('after second update (bash only):', JSON.stringify(((await client.session.get({ directory, sessionID: s1.id })).data as unknown as Record<string, unknown>).permission));
  await attempt('after replacing rules with bash-only', s1.id);
  await client.session.update({ directory, sessionID: s1.id, permission: [{ permission: 'edit', pattern: '*', action: 'allow' }] });
  await attempt('session edit=allow', s1.id);
  console.log('rules after toggling back to allow:', JSON.stringify(((await client.session.get({ directory, sessionID: s1.id })).data as unknown as Record<string, unknown>).permission));
  for (let n = 0; n < 4; n++) await client.session.update({ directory, sessionID: s1.id, permission: [{ permission: 'edit', pattern: '*', action: n % 2 ? 'allow' : 'ask' }] });
  console.log('rules after 4 more toggles:', JSON.stringify(((await client.session.get({ directory, sessionID: s1.id })).data as unknown as Record<string, unknown>).permission));
  const s2 = (await client.session.create({ directory, permission: [{ permission: 'edit', pattern: '*', action: 'ask' }] })).data!;
  await attempt('created with edit=ask', s2.id);
  const listed = (await client.session.list({ directory })).data as unknown as Record<string, unknown>[];
  console.log('list includes permission:', JSON.stringify(listed.find(s => s.id === s2.id)?.permission));
} finally { controller.abort(); await server.stop(); await model.stop(); }
