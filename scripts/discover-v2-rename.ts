import { setTimeout as pause } from 'node:timers/promises';
import { isolatedServer } from './fixtures/server';
import { modelFixture } from './fixtures/model';

/** Discovery only: renaming a session (PATCH title) and whether OpenCode's automatic title overwrites it. */
const model = await modelFixture(20);
const server = await isolatedServer(model.config);
await server.start();
const call = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(server.baseUrl + path, { method, headers: { ...server.headers, 'content-type': 'application/json' }, body: body === undefined ? null : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text };
};
const title = async (id: string) => (JSON.parse((await call('GET', `/api/session/${id}`)).body) as { data: { title?: string } }).data.title;
try {
  const location = { directory: server.project };
  for (const [label, renameFirst] of [['rename before first prompt', true], ['rename after first prompt', false]] as const) {
    const created = JSON.parse((await call('POST', '/api/session', { location })).body).data;
    console.log(`--- ${label}: new session title`, JSON.stringify(created.title));
    if (renameFirst) console.log('patch', await call('PATCH', `/api/session/${created.id}`, { title: 'My name' }));
    console.log('prompt', (await call('POST', `/api/session/${created.id}/prompt`, { text: 'hello there' })).status);
    await pause(4000);
    console.log('title after run', JSON.stringify(await title(created.id)));
    if (!renameFirst) {
      console.log('patch', await call('PATCH', `/api/session/${created.id}`, { title: 'Renamed later' }));
      console.log('prompt', (await call('POST', `/api/session/${created.id}/prompt`, { text: 'again' })).status);
      await pause(3000);
      console.log('title after second run', JSON.stringify(await title(created.id)));
    }
  }
  const created = JSON.parse((await call('POST', '/api/session', { location })).body).data;
  console.log('--- edge cases');
  console.log('empty', await call('PATCH', `/api/session/${created.id}`, { title: '' }), JSON.stringify(await title(created.id)));
  console.log('long', (await call('PATCH', `/api/session/${created.id}`, { title: 'x'.repeat(5000) })).status, (await title(created.id))?.length);
  console.log('missing session', await call('PATCH', '/api/session/ses_doesnotexist000000000000', { title: 'a' }));
} finally { await server.stop(); await model.stop(); }
