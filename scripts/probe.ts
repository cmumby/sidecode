/**
 * Read-only check of a running OpenCode server with Sidecode's own transport; never
 * imported by the extension. Prints no session contents, URLs, paths or credentials.
 *
 *   OPENCODE_URL=http://127.0.0.1:4096 OPENCODE_DIRECTORY=$PWD [OPENCODE_SERVER_PASSWORD=…] npm run probe
 */
import { createTransport } from '../src/adapter/transport';
import { ConnectionError } from '../src/adapter/errors';
import { errorMessages } from '../src/shared/connection';

const signal = AbortSignal.timeout(10_000);
const password = process.env.OPENCODE_SERVER_PASSWORD;
const transport = createTransport({ baseUrl: process.env.OPENCODE_URL || 'http://127.0.0.1:4096', directory: process.env.OPENCODE_DIRECTORY || process.cwd(), ...(password ? { credentials: { username: 'opencode', password } } : {}) });
try {
  await transport.health(signal); console.log('health: OpenCode 2 API');
  await transport.sessions(signal); console.log('folder and sessions: readable');
  for await (const event of transport.events(signal)) {
    if ((event as { type: string }).type === 'server.connected') { console.log('events: connected'); break; }
  }
} catch (error) {
  console.error(`Probe failed: ${error instanceof ConnectionError ? errorMessages[error.code] : 'unexpected error (details suppressed)'}`);
  process.exitCode = 1;
}
