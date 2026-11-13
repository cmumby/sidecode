import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { Chat } from '../src/adapter/chat';
import { Connection } from '../src/adapter/connection';
import { createConversations } from '../src/adapter/conversations';
import { createTransport } from '../src/adapter/transport';
import { modelFixture } from './fixtures/model';
import { isolatedServer } from './fixtures/server';

/**
 * What a long run looks like against isolated OpenCode 1.19.4: reasoning streams before
 * the reply, a running command shows its newest output, and a failing provider surfaces
 * OpenCode's retry status (attempt + provider message) until Stop.
 */
const model = await modelFixture(150);
const server = await isolatedServer(model.config);
const options = { baseUrl: server.baseUrl, directory: server.project, credentials: server.credentials };
const chat = new Chat(50);
const connection = new Connection();
connection.subscribe(state => chat.connection(state.phase === 'connected'));
connection.onEvent(event => chat.event(event));
async function waitFor(predicate: () => boolean, label: string, limit = 300) {
  for (let count = 0; count < limit; count++) { if (predicate()) return; await pause(50); }
  throw new Error(`Timed out: ${label}; busy=${chat.state.busy} retry=${JSON.stringify(chat.state.retry)}`);
}
const idle = () => !chat.state.busy && !chat.state.loading && chat.state.operation === 'none';
const last = () => chat.state.messages.at(-1);
async function prompt(text: string) {
  await chat.create(); await waitFor(() => idle() && !!chat.state.selectedId, 'session');
  await chat.send(chat.state.selectedId!, text, `req_${Date.now()}`);
}
try {
  await server.start();
  chat.attach(createConversations(options)); void connection.connect(createTransport(options));
  await waitFor(() => connection.state.phase === 'connected', 'connected');

  await prompt('RUN_REASON please');
  await waitFor(() => last()?.role === 'assistant' && last()!.reasoning.length > 0 && last()!.text === '', 'reasoning visible before the reply');
  await waitFor(() => idle() && last()?.status === 'complete', 'reply complete');
  assert.equal(last()!.reasoning, 'Considering the question carefully.'); assert.equal(last()!.otherParts, false);
  console.log('PASS: reasoning streams live before the reply and stays in history');

  // Usage: timing and token counts arrive; the model reports its context size; Compact summarizes.
  const reply = last()!;
  assert.ok(reply.time.completed! >= reply.time.created && reply.time.created > 0, 'reply timing');
  assert.deepEqual(reply.tokens, { context: 20, output: 10 }, 'fixture usage: 10 in + 10 out');
  assert.equal(chat.state.models.find(m => m.providerID === 'fixture' && m.modelID === 'fixture')?.context, 32000);
  await chat.compact(chat.state.selectedId!);
  await waitFor(() => idle() && chat.state.messages.some(m => m.kind === 'summary' && m.status === 'complete'), 'compaction summary');
  assert.ok(chat.state.messages.some(m => m.kind === 'compaction'), 'compaction marker'); assert.equal(chat.state.error, null);
  console.log('PASS: reply timing/tokens and model context size are reported; Compact adds a marker and a summary');

  await prompt('RUN_SLOW please');
  await waitFor(() => chat.state.messages.some(m => m.tools.some(t => t.status === 'running' && t.detail.includes('sidecode-first') && !t.detail.includes('sidecode-second'))), 'live command output');
  const runningStep = chat.state.messages.flatMap(m => m.tools).find(t => t.status === 'running')!;
  assert.ok(runningStep.started && Math.abs(Date.now() - runningStep.started) < 60000, 'running step has a server start time');
  await waitFor(() => idle() && chat.state.messages.some(m => m.tools.some(t => t.status === 'completed')), 'command finished');
  console.log('PASS: a running command shows its output while it runs');

  // Slow model writing a large edit: OpenCode reports the step as pending with empty input until the arguments are complete.
  await prompt('RUN_LONGWRITE please');
  await waitFor(() => chat.state.messages.some(m => m.tools.some(t => t.status === 'pending')), 'pending step visible while the model writes it');
  const pending = chat.state.messages.flatMap(m => m.tools).find(t => t.status === 'pending')!;
  assert.equal(pending.title, '', 'no "{}" placeholder'); assert.equal(pending.tool, 'write');
  await waitFor(() => idle() && chat.state.messages.some(m => m.tools.some(t => t.tool === 'write' && t.status === 'completed' && t.change?.label === 'notes.md')), 'write completes with its file');
  console.log('PASS: a step the model is still writing shows as pending, then completes with its file');

  // Empty-response loop (user report): OpenCode keeps creating empty assistant steps.
  await prompt('EMPTY_LOOP please');
  const empty = () => chat.state.messages.filter(m => m.role === 'assistant' && m.status === 'complete' && !m.text && !m.reasoning && !m.tools.length && !m.otherParts).length;
  await waitFor(() => empty() >= 5, 'repeated empty assistant steps', 400);
  assert.ok(chat.state.busy, 'OpenCode is still running the loop');
  await chat.stop(chat.state.selectedId!);
  await waitFor(() => idle(), 'Stop ends the loop');
  console.log(`PASS: an empty-response loop shows as consecutive empty steps (${empty()} seen) while busy; Stop ends it`);

  await prompt('FAIL_500 please');
  await waitFor(() => chat.state.retry !== null, 'retry status shown', 400);
  assert.ok(chat.state.busy); assert.ok(chat.state.retry!.attempt >= 1);
  assert.equal(chat.state.retry!.message, 'fixture provider failure'); assert.ok(chat.state.retry!.next > Date.now() - 60000);
  await chat.stop(chat.state.selectedId!);
  await waitFor(() => idle() && chat.state.retry === null, 'Stop ends the retry loop');
  console.log('PASS: provider failures surface attempt, provider message and next try; Stop ends them');
} finally { connection.dispose(); chat.dispose(); await server.stop(); await model.stop(); }
