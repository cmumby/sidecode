import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import { setTimeout as pause } from 'node:timers/promises';
import { modelFixture } from './fixtures/model';
import { isolatedServer } from './fixtures/server';
/** Read-mostly discovery of 1.19.4 agent/model listing and per-prompt selection on an isolated server. */
const model = await modelFixture(20);
const provider = model.config.provider.fixture;
const server = await isolatedServer({ ...model.config,
  provider: { fixture: { ...provider, models: { ...provider.models, second: { name: 'Second fixture', limit: { context: 32000, output: 4096 } } } } },
  agent: { reviewer: { description: 'Test-only reviewer', mode: 'primary', model: 'fixture/second' }, helper: { description: 'Test-only subagent', mode: 'subagent' } },
});
try {
  await server.start();
  const directory = server.project;
  const client = createOpencodeClient({ baseUrl: server.baseUrl, headers: server.headers, directory, throwOnError: true });
  const agents = (await client.app.agents({ directory })).data as Record<string, unknown>[];
  console.log('agent keys', Object.keys(agents[0] ?? {}));
  for (const a of agents) console.log('agent', JSON.stringify({ name: a.name, mode: a.mode, hidden: a.hidden, native: a.native, model: a.model, description: String(a.description ?? '').slice(0, 60) }));
  const providers = (await client.config.providers({ directory })).data as { providers: Record<string, unknown>[]; default: Record<string, string> };
  console.log('providers keys', Object.keys(providers), 'default', JSON.stringify(providers.default));
  for (const p of providers.providers) console.log('provider', p.id, p.name, 'keys', Object.keys(p), 'models', JSON.stringify(Object.entries(p.models as Record<string, Record<string, unknown>>).map(([id, m]) => ({ id, name: m.name, status: m.status, keys: Object.keys(m) }))));
  const config = (await client.config.get({ directory })).data as Record<string, unknown>;
  console.log('config.model', config.model, 'default_agent', config.default_agent);

  async function run(label: string, extra: Record<string, unknown>) {
    const session = (await client.session.create({ directory })).data!;
    const before = model.requests.length;
    try { await client.session.promptAsync({ directory, sessionID: session.id, parts: [{ type: 'text', text: 'hello' }], ...extra }); }
    catch (error) { console.log(label, 'promptAsync threw', String(error).slice(0, 200)); return; }
    for (let i = 0; i < 100; i++) { const s = (await client.session.status({ directory })).data as Record<string, { type: string }>; await pause(100); if (!s[session.id] || s[session.id]!.type === 'idle') break; }
    const messages = (await client.session.messages({ directory, sessionID: session.id })).data!;
    for (const m of messages) { const info = m.info as unknown as Record<string, unknown>; console.log(label, info.role, JSON.stringify({ agent: info.agent, model: info.model, providerID: info.providerID, modelID: info.modelID, mode: info.mode, error: info.error })); }
    console.log(label, 'model requests', model.requests.slice(before).map(r => (r as { model?: string }).model));
  }
  await run('default', {});
  await run('explicit', { agent: 'plan', model: { providerID: 'fixture', modelID: 'second' } });
  await run('agent-default-model', { agent: 'reviewer' });
  await run('unknown-model', { model: { providerID: 'fixture', modelID: 'nope' } });
  await run('unknown-agent', { agent: 'nope' });
  await run('subagent', { agent: 'helper' });

  // Does an existing session keep its last agent/model when a prompt omits them?
  // And what, if anything, reports an unknown agent/model?
  const errors: string[] = []; const controller = new AbortController();
  const events = await client.event.subscribe({ directory }, { signal: controller.signal });
  void (async () => { for await (const e of events.stream) if (e.type === 'session.error') errors.push(JSON.stringify(e.properties).slice(0, 300)); })().catch(() => {});
  const session = (await client.session.create({ directory })).data!;
  const settle = async () => { for (let i = 0; i < 100; i++) { await pause(100); const s = (await client.session.status({ directory })).data as Record<string, { type: string }>; if (!s[session.id] || s[session.id]!.type === 'idle') return; } };
  await client.session.promptAsync({ directory, sessionID: session.id, agent: 'plan', model: { providerID: 'fixture', modelID: 'second' }, parts: [{ type: 'text', text: 'a' }] }); await settle();
  await client.session.promptAsync({ directory, sessionID: session.id, parts: [{ type: 'text', text: 'b' }] }); await settle();
  for (const m of (await client.session.messages({ directory, sessionID: session.id })).data!) { const info = m.info as unknown as Record<string, unknown>; console.log('omit', info.role, info.agent, JSON.stringify(info.model ?? info.modelID)); }
  await client.session.promptAsync({ directory, sessionID: session.id, model: { providerID: 'fixture', modelID: 'nope' }, parts: [{ type: 'text', text: 'c' }] }); await settle(); await pause(500);
  console.log('unknown model errors', errors.splice(0));
  await client.session.promptAsync({ directory, sessionID: session.id, agent: 'nope', parts: [{ type: 'text', text: 'd' }] }); await settle(); await pause(500);
  console.log('unknown agent errors', errors.splice(0));
  controller.abort();
} finally { await server.stop(); await model.stop(); }
