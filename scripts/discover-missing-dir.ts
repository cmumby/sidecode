import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import { isolatedServer } from './fixtures/server';
/** Discovery: how 1.19.4 responds when the requested project directory does not exist on the server. */
const server = await isolatedServer({});
try {
  await server.start();
  for (const directory of [server.project, '/Users/someone/Projects/missing']) {
    const client = createOpencodeClient({ baseUrl: server.baseUrl, headers: server.headers, directory });
    const show = async (label: string, run: () => Promise<{ data?: unknown; error?: unknown; response?: Response }>) => {
      try { const r = await run(); console.log(`  ${label}: http ${r.response?.status}`, r.error ? 'error ' + JSON.stringify(r.error).slice(0, 160) : 'data ' + JSON.stringify(r.data).slice(0, 120)); }
      catch (e) { console.log(`  ${label}: threw`, String(e).slice(0, 160)); }
    };
    console.log(directory === server.project ? 'existing folder' : 'missing folder');
    await show('session.list', () => client.session.list({ directory }));
    await show('path.get', () => client.path.get({ directory }));
    await show('file.list .', () => client.file.list({ directory, path: '.' }));
    await show('project.current', () => client.project.current({ directory }));
  }
} finally { await server.stop(); }
