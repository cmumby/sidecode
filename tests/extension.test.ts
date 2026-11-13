import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import * as nodePath from 'node:path';
import * as nodeUrl from 'node:url';

test('activation only registers a view; bridge validates and disposes listeners', async () => {
  const result = await build({ entryPoints: ['src/extension/activate.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
  let provider: { resolveWebviewView(view: unknown): void } | undefined;
  let receiver: (value: unknown) => void = () => assert.fail('not registered');
  let onDispose = () => assert.fail('not registered');
  const sent: unknown[] = [];
  let disposed = 0;
  const subscription = { dispose: () => { disposed++; } };
  const vscode = {
    window: { createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, dispose: () => {} }), registerWebviewViewProvider: (id: string, value: typeof provider) => { assert.equal(id, 'sidecode.chat'); provider = value; return subscription; } },
    commands: { registerCommand: () => subscription },
    workspace: { onDidChangeConfiguration: () => subscription, onDidChangeWorkspaceFolders: () => subscription },
    Uri: { joinPath: (root: string, ...parts: string[]) => [root, ...parts].join('/') },
  };
  // No workspace/configuration/command/terminal APIs: any accidental use fails this test.
  const module = { exports: {} as { activate(context: unknown): void } };
  vm.runInNewContext(result.outputFiles[0]!.text, { Headers, Request, Response, AbortController, setTimeout, clearTimeout, module, exports: module.exports, require: (id: string) => {
    if (id === 'vscode') return vscode;
    if (id === 'node:crypto') return { randomBytes, createHash };
    // Read-only realpath for the context boundary; any other filesystem API fails this test.
    if (id === 'node:fs/promises') return { realpath };
    if (id === 'node:path') return nodePath;
    if (id === 'node:url') return nodeUrl;
    throw new Error(`Unexpected runtime dependency: ${id}`);
  } });
  const subscriptions: unknown[] = [];
  module.exports.activate({ extensionUri: '/extension', subscriptions });
  assert.ok(subscriptions.length > 1);
  assert.ok(provider);
  const webview = { options: { enableScripts: false, localResourceRoots: [] as string[] }, html: '', cspSource: 'vscode-webview:',
    asWebviewUri: (uri: string) => uri,
    onDidReceiveMessage: (fn: typeof receiver) => { receiver = fn; return subscription; },
    postMessage: (message: unknown) => { sent.push(message); return Promise.resolve(true); },
  };
  provider.resolveWebviewView({ webview, visible: true, onDidChangeVisibility: () => subscription, onDidDispose: (fn: typeof onDispose) => { onDispose = fn; return subscription; } });
  assert.equal(webview.options.enableScripts, true);
  assert.equal(webview.options.localResourceRoots.join(','), '/extension/dist');
  receiver({ type: 'execute', command: 'workbench.action.moveView' });
  assert.equal(sent.length, 0);
  receiver({ version: 1, type: 'ready' });
  assert.equal(sent.length, 2);
  assert.equal(JSON.stringify(sent[0]), '{"version":1,"type":"connection","state":{"phase":"disconnected","attempt":0,"error":null}}');
  assert.equal((sent[1] as { type: string }).type, 'chat');
  onDispose();
  assert.equal(disposed, 3, 'message listener, disposal and visibility listeners are released');
});
test('manifest contributes only namespaced commands/configuration and its own sidebar', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  assert.deepEqual(Object.keys(manifest.contributes).sort(), ['commands', 'configuration', 'views', 'viewsContainers']);
  assert.deepEqual(Object.keys(manifest.contributes.configuration.properties), ['sidecode.serverUrl', 'sidecode.notifications']);
  assert.equal(manifest.contributes.configuration.properties['sidecode.notifications'].default, true);
  assert.equal(manifest.contributes.configuration.properties['sidecode.serverUrl'].scope, 'machine');
  assert.equal(manifest.contributes.views.sidecode[0].type, 'webview');
  // A tab in the secondary side bar (beside other chat extensions); requires VS Code 1.106+.
  assert.deepEqual(Object.keys(manifest.contributes.viewsContainers), ['secondarySidebar']);
  assert.equal(manifest.contributes.viewsContainers.secondarySidebar[0].id, 'sidecode');
  assert.equal(manifest.engines.vscode, '^1.106.0');
});
