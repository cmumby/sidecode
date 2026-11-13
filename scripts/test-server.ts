/** Launches ONLY an isolated test server. Never imported by extension runtime. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { Connection } from '../src/adapter/connection';
import { createTransport } from '../src/adapter/transport';
import type { ConnectionState } from '../src/shared/connection';

const root = await mkdtemp(join(tmpdir(), 'sidecode-server-'));
const project = join(root, 'project'); await mkdir(project);
const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const address = socket.address(); if (!address || typeof address === 'string') throw new Error('No test port');
const port = address.port; await new Promise<void>(resolve => socket.close(() => resolve()));
const baseUrl = `http://127.0.0.1:${port}`;
const password = randomBytes(24).toString('hex');
// Allowlist process environment; no inherited model keys, plugins, telemetry or config overrides.
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME,
  XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'),
  XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), TMPDIR: join(root, 'tmp'),
  OPENCODE_TEST_HOME: root, OPENCODE_CONFIG_DIR: join(root, 'config'), OPENCODE_CONFIG_CONTENT: '{}',
  OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_AUTOUPDATE: '1',
  OPENCODE_SERVER_USERNAME: 'sidecode-test', OPENCODE_SERVER_PASSWORD: password,
};
await mkdir(env.TMPDIR);
const headers = { Authorization: `Basic ${Buffer.from(`sidecode-test:${password}`).toString('base64')}` };
let server: ChildProcess | undefined;
async function start() {
  server = spawn(process.env.SIDECODE_OPENCODE || 'opencode', ['serve', '--pure', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: project, env, stdio: 'ignore' });
  let launchFailed = false;
  server.on('error', () => { launchFailed = true; });
  for (let count = 0; count < 150; count++) {
    if (launchFailed || server.exitCode !== null) throw new Error('Isolated server failed to start');
    try { if ((await fetch(`${baseUrl}/global/health`, { headers, signal: AbortSignal.timeout(500) })).ok) return; } catch { /* startup */ }
    await pause(100);
  }
  throw new Error('Test server startup timed out');
}
async function stop() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exit = once(server, 'exit');
  server.kill('SIGTERM');
  const timer = setTimeout(() => server?.kill('SIGKILL'), 3000);
  try { await exit; } finally { clearTimeout(timer); }
}
const connection = new Connection({ requestMs: 5000, idleMs: 45000, backoffMs: 1000, stableMs: 60000 });
const states: ConnectionState[] = [];
connection.subscribe(state => states.push(state));
async function waitFor(phase: ConnectionState['phase'], from = 0) {
  for (let count = 0; count < 200; count++) {
    if (states.slice(from).some(state => state.phase === phase)) return;
    await pause(50);
  }
  throw new Error(`Expected state ${phase}; observed ${states.map(s => s.phase).join(',')}`);
}
try {
  await start();
  const health = await (await fetch(`${baseUrl}/global/health`, { headers })).json() as { version: string };
  assert.equal(health.version, '1.19.4', 'Integration fixture targets the installed, researched version');
  await connection.connect(createTransport({ baseUrl, directory: project }));
  assert.equal(connection.state.error, 'authRequired');
  assert.equal(states.filter(state => state.phase === 'retrying').length, 0);
  const source = createTransport({ baseUrl, directory: project, credentials: { username: 'sidecode-test', password } });
  const first = states.length;
  const task = connection.connect(source);
  await waitFor('connected', first);
  // Observe heartbeat traffic long enough to catch envelope differences.
  await pause(12000);
  assert.equal(connection.state.phase, 'connected');
  const restart = states.length;
  await stop();
  await waitFor('retrying', restart);
  await start();
  await waitFor('connected', restart);
  connection.disconnect(); await task;
  assert.equal(connection.state.phase, 'disconnected');
  assert.doesNotMatch(JSON.stringify(states), new RegExp(password));
  console.log('PASS: real OpenCode 1.19.4 Basic auth rejection/success, sessions, SSE/heartbeat, stop/restart recovery and cancellation. Isolated data:', root);
} finally { connection.dispose(); await stop(); }
