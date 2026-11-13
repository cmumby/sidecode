import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { Connection } from '../src/adapter/connection';
import { createTransport } from '../src/adapter/transport';
import { isolatedServer } from './fixtures/server';

/** Connect checks that the project folder exists on the server's machine (isolated OpenCode 2.3.0). */
const server = await isolatedServer({});
try {
  await server.start();
  for (const [label, directory, expected] of [['missing folder', '/Users/someone/Projects/git', 'error'], ['existing folder', server.project, 'connected']] as const) {
    const connection = new Connection();
    const phases: string[] = [];
    connection.subscribe(state => { phases.push(state.phase); });
    void connection.connect(createTransport({ baseUrl: server.baseUrl, directory, credentials: server.credentials }));
    for (let count = 0; count < 200 && !['error', 'connected'].includes(connection.state.phase); count++) await pause(50);
    assert.equal(connection.state.phase, expected, label);
    if (expected === 'error') { assert.equal(connection.state.error, 'folderMissing'); assert.ok(!phases.includes('retrying'), 'not retried'); }
    connection.dispose();
  }
  console.log('PASS: Connect fails clearly (no retries) when the server cannot open the folder; an existing folder connects');
} finally { await server.stop(); }
