import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import { setTimeout as pause } from 'node:timers/promises';
import { modelFixture } from './fixtures/model';
import { isolatedServer } from './fixtures/server';
/** Read-mostly discovery of what 1.19.4 reports while work is in progress: reasoning, long tools, provider retries. */
const model = await modelFixture(100);
const server = await isolatedServer(model.config);
const controller = new AbortController();
try {
  await server.start();
  const directory = server.project;
  const client = createOpencodeClient({ baseUrl: server.baseUrl, headers: server.headers, directory, throwOnError: true });
  const log: string[] = [];
  const events = await client.event.subscribe({ directory }, { signal: controller.signal });
  void (async () => { for await (const e of events.stream) {
    const p = e.properties as Record<string, unknown>;
    if (e.type === 'message.part.delta') log.push(`delta field=${p.field} ${JSON.stringify(p.delta).slice(0, 40)}`);
    else if (e.type === 'message.part.updated') { const part = p.part as Record<string, unknown>; const st = part.state as Record<string, unknown> | undefined;
      log.push(`part.updated ${part.type}${st ? ' ' + st.status + ' input=' + JSON.stringify(st.input ?? null).slice(0, 60) + ' raw=' + (typeof st.raw === 'string' ? st.raw.length + ':' + JSON.stringify(st.raw.slice(0, 40)) : 'none') + ' metadata=' + JSON.stringify(st.metadata ?? null).slice(0, 100) : ''}${part.type === 'reasoning' ? ' text=' + JSON.stringify(part.text).slice(0, 60) + ' keys=' + Object.keys(part).join(',') : ''}`); }
    else if (e.type === 'session.status' || e.type === 'session.error' || e.type === 'session.idle') log.push(`${e.type} ${JSON.stringify(p).slice(0, 300)}`);
  } })().catch(() => {});
  const only = process.env.ONLY;
  for (const [label, text, wait] of ([['reasoning', 'RUN_REASON please', 6000], ['slow tool', 'RUN_SLOW please', 6000], ['provider failure', 'FAIL_500 please', 12000], ['streamed tool arguments', 'RUN_LONGWRITE please', 12000]] as const).filter(([label]) => !only || label === only)) {
    const session = (await client.session.create({ directory })).data!;
    log.length = 0;
    await client.session.promptAsync({ directory, sessionID: session.id, parts: [{ type: 'text', text }] });
    const statuses: string[] = [];
    for (let elapsed = 0; elapsed < wait; elapsed += 500) {
      await pause(500);
      const s = (await client.session.status({ directory })).data as Record<string, unknown>;
      statuses.push(JSON.stringify(s[session.id] ?? 'none').slice(0, 200));
      if (!s[session.id] && elapsed > 1000) break;
    }
    if (label === 'provider failure') await client.session.abort({ directory, sessionID: session.id });
    console.log(`\n== ${label}\nstatus polls: ${[...new Set(statuses)].join(' | ')}`);
    console.log([...new Set(log)].slice(0, 30).join('\n'));
    const messages = (await client.session.messages({ directory, sessionID: session.id })).data!;
    for (const m of messages) console.log('stored', m.info.role, (m.parts as unknown as Record<string, unknown>[]).map(p => p.type + (p.type === 'reasoning' ? `(${JSON.stringify(p.text).slice(0, 40)})` : '')).join(','), JSON.stringify((m.info as unknown as Record<string, unknown>).error ?? null).slice(0, 200));
  }
} finally { controller.abort(); await server.stop(); await model.stop(); }
