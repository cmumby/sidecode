import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import { setTimeout as pause } from 'node:timers/promises';
import { modelFixture } from './fixtures/model';
import { isolatedServer } from './fixtures/server';
/** Read-mostly discovery of 1.19.4 tool/permission semantics on an isolated server. */
const model = await modelFixture(50);
const server = await isolatedServer({ ...model.config, permission: { bash: 'ask' } });
const controller = new AbortController();
try {
  await server.start();
  const dir = server.project;
  const client = createOpencodeClient({ baseUrl: server.baseUrl, headers: server.headers, directory: dir, throwOnError: true });
  const events = await client.event.subscribe({ directory: dir }, { signal: controller.signal });
  const asked: Record<string, unknown>[] = [];
  const log: string[] = [];
  void (async () => { for await (const e of events.stream) {
    if (e.type.startsWith('permission.') || e.type.startsWith('question.')) { log.push(`${e.type} ${JSON.stringify(e.properties).slice(0, 400)}`); if (e.type === 'permission.asked') asked.push(e.properties as Record<string, unknown>); }
    if (e.type === 'message.part.updated') { const p = (e.properties as { part: { type: string; state?: { status: string } } }).part; if (p.type === 'tool') log.push(`tool part ${p.state?.status}`); }
  } })().catch(() => {});
  for (const reply of ['once', 'reject'] as const) {
    const session = (await client.session.create({ directory: dir })).data!;
    asked.length = 0;
    await client.session.promptAsync({ directory: dir, sessionID: session.id, parts: [{ type: 'text', text: 'RUN_TOOL please' }] });
    for (let i = 0; i < 100 && !asked.length; i++) await pause(100);
    console.log(`\n== ${reply}: asked`, asked.length, JSON.stringify(asked[0], null, 1)?.slice(0, 900));
    console.log('list', JSON.stringify((await client.permission.list({ directory: dir })).data).slice(0, 300));
    console.log('status while waiting', JSON.stringify((await client.session.status({ directory: dir })).data));
    if (asked[0]) console.log('reply result', (await client.permission.reply({ directory: dir, requestID: String(asked[0].id), reply, ...(reply === 'reject' ? { message: 'Not now' } : {}) })).data);
    for (let i = 0; i < 100; i++) { const s = (await client.session.status({ directory: dir })).data as Record<string, { type: string }>; if (!s[session.id] || s[session.id]!.type === 'idle') break; await pause(100); }
    const msgs = (await client.session.messages({ directory: dir, sessionID: session.id })).data!;
    for (const m of msgs) console.log(m.info.role, (m.info as { error?: { name: string } }).error?.name ?? '', m.parts.map(p => p.type === 'tool' ? `tool:${p.tool}:${p.state.status}:${JSON.stringify({ input: p.state.input, title: 'title' in p.state ? p.state.title : undefined, output: 'output' in p.state ? String(p.state.output).slice(0, 80) : undefined, error: 'error' in p.state ? p.state.error : undefined, metaKeys: Object.keys(('metadata' in p.state && p.state.metadata) || {}) })}` : p.type === 'text' ? `text:${p.text.slice(0, 40)}` : p.type).join(' | '));
    try { await client.permission.reply({ directory: dir, requestID: String(asked[0]?.id), reply: 'once' }); console.log('second reply accepted'); } catch (e) { console.log('second reply rejected', (e as { _tag?: string })?._tag ?? String(e).slice(0, 100)); }
  }
  console.log('\nevents:\n' + log.join('\n'));
  console.log('model calls', model.requests.length);
} finally { controller.abort(); await server.stop(); await model.stop(); }
