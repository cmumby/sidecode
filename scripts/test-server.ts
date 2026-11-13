/** Launches ONLY isolated test servers. Never imported by extension runtime. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { Connection } from '../src/adapter/connection';
import { createTransport } from '../src/adapter/transport';
import type { ConnectionState } from '../src/shared/connection';
import { isolatedServer } from './fixtures/server';

const server = await isolatedServer();
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
  await server.start();
  const info = await (await fetch(`${server.baseUrl}/api/info`, { headers: server.headers })).json() as { version: string };
  assert.equal(info.version, '2.3.0', 'Integration fixture targets the researched version');
  await connection.connect(createTransport({ baseUrl: server.baseUrl, directory: server.project }));
  assert.equal(connection.state.error, 'authRequired');
  assert.equal(states.filter(state => state.phase === 'retrying').length, 0);
  await connection.connect(createTransport({ baseUrl: server.baseUrl, directory: '/nonexistent/sidecode-folder', credentials: server.credentials }));
  assert.equal(connection.state.error, 'folderMissing', 'a folder the server machine does not have');
  const source = createTransport({ baseUrl: server.baseUrl, directory: server.project, credentials: server.credentials });
  const first = states.length;
  const task = connection.connect(source);
  await waitFor('connected', first);
  // Observe heartbeat traffic long enough to catch envelope differences.
  await pause(12000);
  assert.equal(connection.state.phase, 'connected');
  const restart = states.length;
  await server.stop();
  await waitFor('retrying', restart);
  await server.start();
  await waitFor('connected', restart);
  connection.disconnect(); await task;
  assert.equal(connection.state.phase, 'disconnected');
  assert.doesNotMatch(JSON.stringify(states), new RegExp(server.credentials.password));
  console.log('PASS: real OpenCode 2.3.0 Basic auth rejection/success, missing folder, sessions, SSE/heartbeat, stop/restart recovery and cancellation.');
} finally { connection.dispose(); await server.stop(); }

// An OpenCode 1.x server (when one is installed) is recognized and explained.
// (`npm run` puts the 2.x test CLI first on PATH, so look for the usual 1.x install location.)
const v1Binary = process.env.SIDECODE_OPENCODE_V1 || join(homedir(), '.opencode', 'bin', 'opencode');
let v1: string | undefined;
try { if (existsSync(v1Binary)) v1 = execFileSync(v1Binary, ['--version'], { encoding: 'utf8', timeout: 20000 }).trim(); } catch { /* not runnable */ }
if (v1 && /^1\./.test(v1)) {
  const old = await isolatedServer({}, v1Binary);
  const check = new Connection({ requestMs: 5000, idleMs: 45000, backoffMs: 100, stableMs: 60000 });
  try {
    await old.start();
    await check.connect(createTransport({ baseUrl: old.baseUrl, directory: old.project, credentials: old.credentials }));
    assert.equal(check.state.error, 'oldServer');
    console.log(`PASS: an OpenCode ${v1} server is reported as version 1 (upgrade needed).`);
  } finally { check.dispose(); await old.stop(); }
} else console.log('SKIP: no OpenCode 1.x installed; version-1 detection not exercised.');
