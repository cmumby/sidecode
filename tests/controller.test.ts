import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createHash, randomBytes } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import * as nodePath from 'node:path';
import * as nodeUrl from 'node:url';
import { build } from 'esbuild';
import type { Controller } from '../src/extension/controller';

async function harness(options: { hangSecrets?: boolean; unsetUrl?: boolean } = {}) {
  const bundle = await build({ entryPoints: ['src/extension/controller.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
  const logs: string[] = [];
  const secrets = new Map<string, string>();
  const prompts: Array<{ password?: boolean }> = [];
  const responses: Array<string | undefined | Promise<string | undefined>> = [];
  const requests: Request[] = [];
  let url = 'http://127.0.0.1:4096';
  let saved = !options.unsetUrl;
  let change: (event: { affectsConfiguration(key: string): boolean }) => void = () => {};
  const dispose = { dispose() {} };
  const workspace = {
    isTrusted: true, workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/private/project' } }],
    getConfiguration: () => ({ get: () => url, inspect: () => ({ globalValue: saved ? url : undefined }),
      update: async (_name: string, value: string) => { url = value; saved = true; change({ affectsConfiguration: () => true }); } }),
    onDidChangeConfiguration: (listener: typeof change) => { change = listener; return dispose; },
    onDidChangeWorkspaceFolders: () => dispose,
  };
  const vscode = { workspace, ConfigurationTarget: { Global: 1 }, window: {
    createOutputChannel: () => ({ appendLine: (line: string) => logs.push(line), show() {}, dispose() {} }),
    showInputBox: async (options: { password?: boolean }) => { prompts.push(options); return await responses.shift(); },
  } };
  const module = { exports: {} as { Controller: new (context: unknown) => Controller } };
  vm.runInNewContext(bundle.outputFiles[0]!.text, {
    module, exports: module.exports, Headers, Request, Response, URL, Buffer, AbortController, TextDecoderStream,
    setTimeout, clearTimeout,
    fetch: async (request: Request) => {
      requests.push(request);
      const path = new URL(request.url).pathname;
      if (path.endsWith('/event')) return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"server.connected","properties":{}}\n\n'));
        request.signal.addEventListener('abort', () => { try { controller.close(); } catch { /* already cancelled */ } }, { once: true });
      } }), { headers: { 'content-type': 'text/event-stream' } });
      return Response.json(path.endsWith('/health') ? { healthy: true, version: '1.19.4' } : []);
    },
    require: (id: string) => { if (id === 'vscode') return vscode; if (id === 'node:crypto') return { createHash, randomBytes };
      // Read-only path resolution for the context boundary; no other filesystem access.
      if (id === 'node:fs/promises') return { realpath }; if (id === 'node:path') return nodePath; if (id === 'node:url') return nodeUrl;
      throw new Error('unexpected dependency'); },
  });
  const controller = new module.exports.Controller({ secrets: {
    get: async (key: string) => options.hangSecrets ? new Promise<string | undefined>(() => {}) : secrets.get(key), store: async (key: string, value: string) => { secrets.set(key, value); }, delete: async (key: string) => { secrets.delete(key); },
  } });
  return { controller, secrets, responses, requests, prompts, logs, workspace, change: () => change({ affectsConfiguration: () => true }) };
}
test('credentials use endpoint-scoped SecretStorage and never diagnostics', async () => {
  const h = await harness();
  try {
    h.responses.push('opencode', 'private-password'); await h.controller.action('credentials');
    assert.equal(h.prompts[1]?.password, true); assert.equal(h.secrets.size, 1);
    const firstKey = [...h.secrets.keys()][0]!;
    assert.doesNotMatch(firstKey, /4096|private-password/);
    h.responses.push('http://127.0.0.1:4097'); await h.controller.action('configure');
    h.responses.push('opencode', 'other-password'); await h.controller.action('credentials');
    assert.equal(h.secrets.size, 2);
    await h.controller.action('clearCredentials');
    assert.equal(h.secrets.size, 1); assert.ok(h.secrets.has(firstKey));
    assert.doesNotMatch(h.logs.join('\n'), /private-password|other-password|127\.0\.0\.1|4096/);
  } finally { h.controller.dispose(); }
});
test('cancelled credential dialogs and disposed controllers do not store late values', async () => {
  const h = await harness();
  h.responses.push(undefined); await h.controller.action('credentials'); assert.equal(h.secrets.size, 0);
  let release!: (value: string) => void;
  h.responses.push(new Promise<string>(resolve => { release = resolve; }));
  const action = h.controller.action('credentials');
  h.controller.dispose(); release('late username'); await action;
  assert.equal(h.secrets.size, 0); assert.equal(h.prompts.length, 2);
});
test('untrusted workspaces cannot connect; trusted connection cancels on settings changes', async () => {
  const h = await harness();
  try {
    h.workspace.isTrusted = false; await h.controller.action('connect');
    assert.equal(h.controller.connection.state.error, 'untrusted'); assert.equal(h.requests.length, 0);
    h.workspace.isTrusted = true;
    const connected = new Promise<void>(resolve => h.controller.connection.subscribe(state => { if (state.phase === 'connected') resolve(); }));
    await h.controller.action('connect'); await connected;
    assert.equal(h.requests.length, 4, 'health, sessions, folder check, events');
    h.change(); assert.equal(h.controller.connection.state.phase, 'disconnected');
    assert.doesNotMatch(h.logs.join('\n'), /private|project/);
  } finally { h.controller.dispose(); }
});

test('a stalled keyring read never blocks other connection actions and fails visibly', async () => {
  const h = await harness({ hangSecrets: true });
  try {
    h.controller.secretTimeout = 30;
    const connecting = h.controller.action('connect');
    // Server URL still opens its prompt while Connect waits on secret storage.
    // (Cancelled here: saving a new URL would rightly cancel this Connect attempt.)
    h.responses.push(undefined); await h.controller.action('configure');
    assert.equal(h.prompts.length, 1, 'Server URL prompt shown while Connect is waiting');
    await connecting;
    assert.equal(h.controller.connection.state.error, 'credentials');
    assert.match(h.logs.join('\n'), /action=connect[\s\S]*action=configure[\s\S]*credentials=read-timeout/);
    assert.doesNotMatch(h.logs.join('\n'), /127\.0\.0\.1|4097/);
  } finally { h.controller.dispose(); }
});
test('a second prompt replaces the first instead of being ignored', async () => {
  const h = await harness();
  try {
    let first!: (value: string | undefined) => void;
    h.responses.push(new Promise<string | undefined>(resolve => { first = resolve; }));
    const credentials = h.controller.action('credentials');
    h.responses.push('http://127.0.0.1:4097');
    const configure = h.controller.action('configure');
    first(undefined); // VS Code cancels the open input box when another opens.
    await Promise.all([credentials, configure]);
    assert.equal(h.prompts.length, 2, 'the second click opened its prompt'); assert.equal(h.secrets.size, 0);
  } finally { h.controller.dispose(); }
});

test('first Connect asks for the server URL instead of silently using the default', async () => {
  const h = await harness({ unsetUrl: true });
  try {
    h.responses.push(undefined); await h.controller.action('connect');
    assert.equal(h.prompts.length, 1, 'URL prompt shown'); assert.equal(h.requests.length, 0, 'cancelled: no connection attempt');
    const connected = new Promise<void>(resolve => h.controller.connection.subscribe(state => { if (state.phase === 'connected') resolve(); }));
    h.responses.push('http://127.0.0.1:4097'); await h.controller.action('connect'); await connected;
    assert.match(h.requests[0]!.url, /^http:\/\/127\.0\.0\.1:4097\//, 'connects to the confirmed address');
    h.controller.action('disconnect');
    await h.controller.action('connect');
    assert.equal(h.prompts.length, 2, 'not asked again once saved');
  } finally { h.controller.dispose(); }
});
