import assert from 'node:assert/strict';
import test from 'node:test';
import { Connection, type Timing } from '../src/adapter/connection';
import { ConnectionError, normalizeUrl, assertSafeAuth } from '../src/adapter/errors';
import { createTransport, validEvent, type Transport } from '../src/adapter/transport';
import type { ConnectionState } from '../src/shared/connection';
const timing: Timing = { requestMs: 30, idleMs: 30, backoffMs: 1, stableMs: 10000 };
const waitAbort = (signal: AbortSignal) => new Promise<void>((resolve) => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); });
const connected = { type: 'server.connected', properties: {} };
const transport = (events: Transport['events']): Transport => ({ health: async () => {}, sessions: async () => {}, events });

test('explicit stages, connection event and clean disconnect', async () => {
  const connection = new Connection(timing);
  const states: ConnectionState[] = [];
  connection.subscribe((state) => { states.push(state); if (state.phase === 'connected') connection.disconnect(); });
  await connection.connect(transport(async function* (signal) { yield connected; await waitAbort(signal); }));
  assert.deepEqual(states.map(s => s.phase), ['health', 'sessions', 'events', 'connected', 'disconnected']);
});
test('EOF retries are bounded even when every attempt briefly connects', async () => {
  const connection = new Connection(timing);
  let calls = 0;
  const states: ConnectionState[] = [];
  connection.subscribe(state => states.push(state));
  await connection.connect(transport(async function* () { calls++; yield connected; }));
  assert.equal(calls, 4);
  assert.deepEqual(states.filter(s => s.phase === 'retrying').map(s => s.attempt), [1, 2, 3]);
  assert.equal(connection.state.error, 'streamClosed');
});
test('health timeout and event silence are recoverable but bounded', async () => {
  for (const source of [
    { health: waitAbort, sessions: async () => {}, events: async function* () {} },
    transport(async function* (signal) { yield connected; await waitAbort(signal); }),
  ]) {
    const connection = new Connection(timing);
    await connection.connect(source);
    assert.equal(connection.state.phase, 'error');
    assert.equal(connection.state.error, 'timeout');
  }
});
test('auth failures do not retry and diagnostics contain no exception content', async () => {
  const connection = new Connection(timing);
  let calls = 0;
  await connection.connect({ ...transport(async function* () {}), health: async () => { calls++; throw new ConnectionError('authRequired'); } });
  assert.equal(calls, 1); assert.equal(connection.state.error, 'authRequired');
  await connection.connect({ ...transport(async function* () {}), health: async () => { throw new Error('TOKEN /private/path prompt contents'); } });
  assert.doesNotMatch(JSON.stringify(connection.state), /TOKEN|private|contents/);
});
test('disconnect during retry cancels pending work', async () => {
  const connection = new Connection(timing);
  let calls = 0;
  connection.subscribe(state => { if (state.phase === 'retrying') connection.disconnect(); });
  await connection.connect({ ...transport(async function* () {}), health: async () => { calls++; throw new Error(); } });
  assert.equal(calls, 1); assert.equal(connection.state.phase, 'disconnected');
});
test('replaced connections cannot publish stale results', async () => {
  const connection = new Connection(timing);
  let release!: () => void;
  const old = connection.connect({ ...transport(async function* () { yield connected; }), health: () => new Promise<void>(resolve => { release = resolve; }) });
  const next = connection.connect({ ...transport(async function* () {}), health: async () => { throw new ConnectionError('authRequired'); } });
  await next; release(); await old;
  assert.equal(connection.state.error, 'authRequired');
});
test('event shapes are validated without trusting arbitrary payloads', async () => {
  assert.equal(validEvent(connected), true);
  for (const value of [null, [], 'data', {}, { type: 'server.connected' }, { type: '<script>', properties: {} }, { type: 'x', properties: [] }]) assert.equal(validEvent(value), false);
  const connection = new Connection(timing);
  await connection.connect(transport(async function* () { yield 'malformed'; }));
  assert.equal(connection.state.error, 'incompatible');
});
test('URL validation and endpoint-specific credential transport policy', () => {
  assert.equal(normalizeUrl('http://127.0.0.1:4096/'), 'http://127.0.0.1:4096');
  for (const value of ['file:///tmp', 'https://u:p@host', 'http://host/?token=x', 'http://host/#x', 'broken']) assert.throws(() => normalizeUrl(value));
  assertSafeAuth('http://127.0.0.1:4096'); assertSafeAuth('https://example.com');
  assert.throws(() => assertSafeAuth('http://example.com'));
});
test('SDK checks status and content type for JSON and SSE, without accepting the HTML root', async () => {
  for (const [status, contentType, code] of [[200, 'text/html', 'incompatible'], [401, 'text/html', 'authRequired'], [500, 'text/plain', 'serverError']] as const) {
    const client = createTransport({ baseUrl: 'http://localhost:4096', directory: '/test' }, async () => new Response('secret response', { status, headers: { 'content-type': contentType } }));
    await assert.rejects(client.health(new AbortController().signal), (error: unknown) => error instanceof ConnectionError && error.code === code);
    await assert.rejects(async () => { for await (const event of client.events(new AbortController().signal)) void event; }, (error: unknown) => error instanceof ConnectionError && error.code === code);
  }
});
test('uses the OpenCode 2 routes and project folder, and Basic auth only in host requests', async () => {
  const requests: Request[] = [];
  const client = createTransport({ baseUrl: 'http://127.0.0.1:4096', directory: '/project with spaces', credentials: { username: 'opencode', password: 'test' } }, async (input, init) => {
    const request = new Request(input, init); requests.push(request);
    const path = new URL(request.url).pathname;
    return Response.json(path === '/api/info' ? { version: '2.3.0' } : path === '/api/location' ? { directory: '/project with spaces', project: {} } : { data: [], cursor: {} });
  });
  const signal = new AbortController().signal;
  await client.health(signal); await client.sessions(signal);
  assert.deepEqual(requests.map(request => new URL(request.url).pathname), ['/api/info', '/api/location', '/api/session']);
  assert.equal(new URL(requests[1]!.url).searchParams.get('location[directory]'), '/project with spaces', 'folder check uses the project');
  assert.equal(new URL(requests[2]!.url).searchParams.get('directory'), '/project with spaces');
  assert.match(requests[0]!.headers.get('authorization')!, /^Basic /);
  assert.equal(requests.every(request => request.redirect === 'error'), true, 'redirects are never followed');
});
test('a project folder the server cannot open fails Connect clearly instead of every prompt', async () => {
  const transport = createTransport({ baseUrl: 'http://127.0.0.1:4096', directory: '/Users/someone/Projects/git' }, async (input, init) => {
    const path = new URL(new Request(input, init).url).pathname;
    if (path === '/api/location') return Response.json({ _tag: 'LocationNotFoundError', message: 'Location not found: /Users/someone/Projects/git' }, { status: 404 });
    return Response.json(path === '/api/info' ? { version: '2.3.0' } : { data: [] });
  });
  await assert.rejects(transport.sessions(new AbortController().signal), (error: unknown) => (error as { code?: string }).code === 'folderMissing');
});
test('an OpenCode 1 server is recognized and other versions are refused', async () => {
  const v1 = createTransport({ baseUrl: 'http://127.0.0.1:4096', directory: '/p' }, async (input, init) => {
    const path = new URL(new Request(input, init).url).pathname;
    // 1.x answers unknown routes with its web app.
    return path === '/global/health' ? Response.json({ healthy: true, version: '1.19.4' }) : new Response('<html>', { headers: { 'content-type': 'text/html' } });
  });
  await assert.rejects(v1.health(new AbortController().signal), (error: unknown) => (error as { code?: string }).code === 'oldServer');
  for (const version of ['3.0.0', 'banana']) {
    const other = createTransport({ baseUrl: 'http://127.0.0.1:4096', directory: '/p' }, async () => Response.json({ version }));
    await assert.rejects(other.health(new AbortController().signal), (error: unknown) => (error as { code?: string }).code === 'incompatible');
  }
});
test('events: OpenCode 2 envelopes, heartbeats and other projects', async () => {
  const body = [': heartbeat', '', 'data: {"type":"server.connected","data":{}}', '', 'data: {"type":"session.text.delta","location":{"directory":"/other"},"data":{"sessionID":"ses_x"}}', '',
    'data: {"id":"evt_1","type":"session.step.ended","location":{"directory":"/p"},"data":{"sessionID":"ses_a"},"durable":{"seq":1}}', '', 'data: {"type":"session.execution.started","data":{"sessionID":"ses_a"}}', '', ''].join('\n');
  const client = createTransport({ baseUrl: 'http://127.0.0.1:4096', directory: '/p' }, async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
  const seen: unknown[] = [];
  await assert.rejects(async () => { for await (const event of client.events(new AbortController().signal)) seen.push(event); }, (error: unknown) => (error as { code?: string }).code === 'streamClosed');
  assert.deepEqual(seen, [
    { type: 'server.heartbeat', properties: {} }, { type: 'server.connected', properties: {} },
    { type: 'session.step.ended', properties: { sessionID: 'ses_a' } }, { type: 'session.execution.started', properties: { sessionID: 'ses_a' } },
  ]);
  const bad = createTransport({ baseUrl: 'http://127.0.0.1:4096', directory: '/p' }, async () => new Response('data: {"type":"x","data":[1]}\n\n', { headers: { 'content-type': 'text/event-stream' } }));
  await assert.rejects(async () => { for await (const event of bad.events(new AbortController().signal)) void event; }, (error: unknown) => (error as { code?: string }).code === 'incompatible');
});
