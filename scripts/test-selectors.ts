import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { Chat } from '../src/adapter/chat';
import { Connection } from '../src/adapter/connection';
import { createConversations } from '../src/adapter/conversations';
import { createTransport } from '../src/adapter/transport';
import { modelFixture } from './fixtures/model';
import { isolatedServer } from './fixtures/server';

/**
 * Agent/model selection against isolated OpenCode 1.19.4: server-listed choices only,
 * explicit choices reach the model, the session's last choice is reported back, and
 * an asynchronous `session.error` is surfaced without raw server text.
 */
const model = await modelFixture(20);
const provider = model.config.provider.fixture;
const server = await isolatedServer({ ...model.config,
  provider: { fixture: { ...provider, models: { ...provider.models, second: { name: 'Second fixture', limit: { context: 32000, output: 4096 } } } } },
  agent: { reviewer: { description: 'Test-only reviewer', mode: 'primary' }, helper: { description: 'Test-only subagent', mode: 'subagent' } },
});
const options = { baseUrl: server.baseUrl, directory: server.project, credentials: server.credentials };
const chat = new Chat(50);
const connection = new Connection();
connection.subscribe(state => chat.connection(state.phase === 'connected'));
connection.onEvent(event => chat.event(event));
async function waitFor(predicate: () => boolean, label: string) {
  for (let count = 0; count < 300; count++) { if (predicate()) return; await pause(50); }
  throw new Error(`Timed out: ${label}; error=${chat.state.error}; busy=${chat.state.busy}`);
}
const idle = () => !chat.state.busy && !chat.state.loading && chat.state.operation === 'none';
const lastModel = () => (model.requests.at(-1) as { model?: string } | undefined)?.model;
try {
  await server.start();
  chat.attach(createConversations(options)); void connection.connect(createTransport(options));
  await waitFor(() => connection.state.phase === 'connected' && chat.state.agents.length > 0, 'connected with options');

  const agents = chat.state.agents.map(a => a.name);
  assert.ok(agents.includes('build') && agents.includes('plan') && agents.includes('reviewer'), `agents ${agents}`);
  for (const hidden of ['helper', 'explore', 'general', 'title', 'summary', 'compaction']) assert.ok(!agents.includes(hidden), `${hidden} not selectable`);
  const fixtures = chat.state.models.filter(m => m.providerID === 'fixture').map(m => m.modelID);
  assert.deepEqual(fixtures.sort(), ['fixture', 'second']);
  assert.equal(chat.state.agents.find(a => a.name === 'reviewer')?.description, 'Test-only reviewer');
  console.log('PASS: only primary, visible agents and configured models are offered');

  await chat.create(); await waitFor(() => idle() && !!chat.state.selectedId, 'session');
  const session = chat.state.selectedId!;
  await chat.send(session, 'hello', 'req_default');
  await waitFor(() => idle() && chat.state.messages.at(-1)?.status === 'complete', 'default reply');
  assert.equal(lastModel(), 'fixture'); assert.deepEqual(chat.state.used, { agent: 'build', model: { providerID: 'fixture', modelID: 'fixture' } });
  console.log('PASS: default send uses the server defaults and reports them');

  await chat.send(session, 'hello again', 'req_explicit', { agent: 'plan', model: { providerID: 'fixture', modelID: 'second' } });
  await waitFor(() => idle() && chat.state.messages.length === 4 && chat.state.messages.at(-1)?.status === 'complete', 'explicit reply');
  assert.equal(lastModel(), 'second'); assert.deepEqual(chat.state.used, { agent: 'plan', model: { providerID: 'fixture', modelID: 'second' } });
  console.log('PASS: explicit agent and model reach OpenCode and become the session\'s selection');

  const requests = model.requests.length;
  await chat.send(session, 'not sent', 'req_bad', { agent: 'helper', model: null });
  assert.equal(chat.state.error, 'optionUnavailable'); await pause(300); assert.equal(model.requests.length, requests);
  assert.equal(chat.state.messages.length, 4, 'refused before reaching the server');
  console.log('PASS: unlisted agent (a subagent) is refused locally');

  // A list that went stale: the server rejects the name asynchronously via session.error.
  await createConversations(options).send(session, `msg_${Date.now().toString(16)}stalelist000000`, 'stale', { agent: 'removed', model: null }, AbortSignal.timeout(5000));
  await waitFor(() => chat.state.error === 'sessionError', 'session error surfaced');
  assert.doesNotMatch(JSON.stringify(chat.state), /removed|Agent not found|bunfs/);
  await chat.send(session, 'recover', 'req_recover');
  await waitFor(() => idle() && chat.state.messages.at(-1)?.status === 'complete' && chat.state.messages.length >= 6, 'recovered');
  assert.equal(chat.state.error, null);
  console.log('PASS: asynchronous session.error shows a fixed message; next send clears it');
} finally { connection.dispose(); chat.dispose(); await server.stop(); await model.stop(); }
