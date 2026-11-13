import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import { setTimeout as pause } from 'node:timers/promises';
import { modelFixture } from './fixtures/model';
import { isolatedServer } from './fixtures/server';
/** Read-mostly discovery of per-message timing/token fields and model context limits in 1.19.4. */
const model = await modelFixture(20);
const server = await isolatedServer(model.config);
try {
  await server.start();
  const directory = server.project;
  const client = createOpencodeClient({ baseUrl: server.baseUrl, headers: server.headers, directory, throwOnError: true });
  const session = (await client.session.create({ directory })).data!;
  await client.session.promptAsync({ directory, sessionID: session.id, parts: [{ type: 'text', text: 'RUN_TOOL please' }] });
  for (let i = 0; i < 100; i++) { await pause(100); const s = (await client.session.status({ directory })).data as Record<string, unknown>; if (!s[session.id] && i > 5) break; }
  for (const m of (await client.session.messages({ directory, sessionID: session.id })).data!) {
    const info = Object.fromEntries(Object.entries(m.info as unknown as Record<string, unknown>).filter(([key]) => !['id', 'sessionID', 'parentID', 'path', 'system'].includes(key)));
    console.log(m.info.role, JSON.stringify(info).slice(0, 500));
    for (const p of m.parts as unknown as Record<string, unknown>[]) if (p.type === 'step-finish') console.log('  step-finish', JSON.stringify({ tokens: p.tokens, cost: p.cost, reason: p.reason }));
  }
  const providers = (await client.config.providers({ directory })).data as { providers: { id: string; models: Record<string, { limit?: unknown }> }[] };
  console.log('fixture model limit', JSON.stringify(providers.providers.find(p => p.id === 'fixture')?.models.fixture?.limit));
  const info = (await client.session.get({ directory, sessionID: session.id })).data as unknown as Record<string, unknown>;
  console.log('session keys', Object.keys(info).join(','));
  // Compaction ("summarize"): what it returns and what it leaves in the history.
  const before = model.requests.length;
  const result = await client.session.summarize({ directory, sessionID: session.id, providerID: 'fixture', modelID: 'fixture' });
  console.log('summarize result', JSON.stringify(result.data), 'model requests', model.requests.length - before);
  for (let i = 0; i < 50; i++) { await pause(100); const s = (await client.session.status({ directory })).data as Record<string, unknown>; if (!s[session.id] && i > 5) break; }
  for (const m of (await client.session.messages({ directory, sessionID: session.id })).data!) {
    const i = m.info as unknown as Record<string, unknown>;
    console.log('after', i.role, 'summary=' + JSON.stringify(i.summary ?? null).slice(0, 60), 'mode=' + (i.mode ?? '-'), (m.parts as unknown as Record<string, unknown>[]).map(p => p.type + (p.type === 'text' ? `(${String(p.text).slice(0, 30)})` : '')).join(' '));
  }
} finally { await server.stop(); await model.stop(); }
