import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { isolatedServer } from './fixtures/server';
import { modelFixture } from './fixtures/model';
const model = await modelFixture();
const server = await isolatedServer(model.config);
const controller = new AbortController();
try {
  await server.start();
  const client = createOpencodeClient({ baseUrl: server.baseUrl, headers: server.headers, directory: server.project, throwOnError: true });
  const session = (await client.session.create({ directory: server.project, title: 'Discovery' })).data!;
  const other = join(server.root, 'other'); await mkdir(other);
  await client.session.create({ directory: other, title: 'Other project' });
  console.log('session keys', Object.keys(session), 'directory match', session.directory === server.project);
  for (const params of [{ directory: server.project }, { directory: server.project, path: server.project }]) {
    const data = (await client.session.list(params)).data!;
    console.log('list', 'path' in params ? 'filtered' : 'default', data.map(s => ({ sameDirectory: s.directory === server.project, sameSession: s.id === session.id })));
  }
  const events = await client.event.subscribe({ directory: server.project }, { signal: controller.signal });
  const seen = new Set<string>();
  const reading = (async () => { for await (const event of events.stream) { if (!seen.has(event.type)) { seen.add(event.type); console.log('event', event.type, Object.keys(event.properties)); } } })();
  const result = await client.session.promptAsync({ directory: server.project, sessionID: session.id, parts: [{ type: 'text', text: 'Say hello, without tools.' }] });
  console.log('prompt status', result.response.status, result.response.headers.get('content-type'));
  const cli = spawn('opencode', ['run', '--attach', server.baseUrl, '--dir', server.project, '--title', 'CLI fixture', '--format', 'json', 'Say hello without tools.'], { env: server.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; cli.stdout.on('data', chunk => { output += chunk; }); cli.stderr.resume();
  const timer = setTimeout(() => cli.kill('SIGTERM'), 20000);
  const [exit] = await once(cli, 'exit'); clearTimeout(timer);
  console.log('CLI exit', exit, 'JSON event lines', output.trim().split('\n').length);
  const messages = (await client.session.messages({ directory: server.project, sessionID: session.id })).data!;
  console.log('message shapes', messages.map(m => ({ role: m.info.role, infoKeys: Object.keys(m.info), parts: m.parts.map(p => ({ type: p.type, keys: Object.keys(p) })) })));
  console.log('status', (await client.session.status({ directory: server.project })).data);
  console.log('sessions after CLI', (await client.session.list({ directory: server.project, path: server.project })).data?.length, 'model calls', model.requests.length);
  controller.abort(); await reading;
} finally { controller.abort(); await server.stop(); await model.stop(); }
