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
test('SDK uses documented routes and directory, and Basic auth only in host requests', async () => {
  const requests: Request[] = [];
  const client = createTransport({ baseUrl: 'http://127.0.0.1:4096', directory: '/project with spaces', credentials: { username: 'opencode', password: 'test' } }, async input => {
    const request = new Request(input); requests.push(request);
    const path = new URL(request.url).pathname;
    return new Response(JSON.stringify(path === '/global/health' ? { healthy: true, version: '1.19.4' } : []), { headers: { 'content-type': 'application/json; charset=utf-8' } });
  });
  const signal = new AbortController().signal;
  await client.health(signal); await client.sessions(signal);
  assert.deepEqual(requests.map(request => new URL(request.url).pathname), ['/global/health', '/session']);
  assert.equal(new URL(requests[1]!.url).searchParams.get('directory'), '/project with spaces');
  assert.match(requests[0]!.headers.get('authorization')!, /^Basic /);
});
