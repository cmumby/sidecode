/** Read-only discovery tool; never imported by the extension. Prints no session contents. */
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';

async function probe() {
  const baseUrl = new URL(process.env.OPENCODE_URL || 'http://127.0.0.1:4096');
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new Error('invalid URL');
  const directory = process.env.OPENCODE_DIRECTORY || process.cwd();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const headers: Record<string, string> = {};
  if (process.env.OPENCODE_SERVER_PASSWORD) headers.Authorization = `Basic ${Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME || 'opencode'}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`;
  const checkedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const response = await fetch(request, { signal: AbortSignal.any([request.signal, controller.signal]), redirect: 'error' });
    const path = new URL(request.url).pathname;
    const expected = path.endsWith('/event') ? 'text/event-stream' : 'application/json';
    if (!response.ok || response.headers.get('content-type')?.split(';')[0]?.trim() !== expected) {
      await response.body?.cancel();
      throw new Error('invalid API response');
    }
    return response;
  };
  try {
    const client = createOpencodeClient({ baseUrl: baseUrl.toString(), directory, headers, fetch: checkedFetch, throwOnError: true });
    const health = await client.global.health({ signal: controller.signal });
    if (health.data?.healthy !== true || typeof health.data.version !== 'string') throw new Error('invalid health');
    console.log('health:', JSON.stringify({ healthy: true, version: health.data.version }));
    const sessions = await client.session.list({ directory }, { signal: controller.signal });
    if (!Array.isArray(sessions.data)) throw new Error('invalid session list');
    console.log('sessions:', sessions.data.length, '(contents omitted)');
    const events = await client.event.subscribe({ directory }, { signal: controller.signal, sseMaxRetryAttempts: 1 });
    let connected = false;
    for await (const event of events.stream) {
      if (event.type === 'server.connected') { connected = true; console.log('SSE: server.connected'); break; }
    }
    if (!connected) throw new Error('stream ended before connection');
    controller.abort();
  } finally { controller.abort(); clearTimeout(timer); }
}
probe().catch(() => {
  console.error('Probe failed. Check server availability, API compatibility, directory and documented Basic auth. Details suppressed to protect credentials and paths.');
  process.exitCode = 1;
});
