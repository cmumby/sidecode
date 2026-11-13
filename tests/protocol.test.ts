import assert from 'node:assert/strict';
import test from 'node:test';
import { isHostMessage, isWebviewMessage } from '../src/shared/protocol';
import { webviewHtml } from '../src/extension/html';

test('only the current, exact shell protocol crosses the bridge', () => {
  assert.equal(isWebviewMessage({ version: 1, type: 'ready' }), true);
  assert.equal(isHostMessage({ version: 1, type: 'connection', state: { phase: 'disconnected', attempt: 0, error: null } }), true);
  for (const value of [null, [], 'ready', 1, {}, { version: 2, type: 'ready' },
    { version: 1, type: 'ready', token: 'secret' }, { version: 1, type: 'execute', command: 'x' },
    Object.create({ version: 1, type: 'ready' })]) assert.equal(isWebviewMessage(value), false);
  for (const value of [{ version: 1, type: 'connection', state: { phase: 'connected', attempt: 4, error: null } }, { version: 1, type: 'connection', state: { phase: 'connected', attempt: 0, error: 'raw secret' } }, { version: 1, type: 'connection', state: { phase: 'connected', attempt: 0, error: null, secret: 'x' } }, null, [], {}, { version: 1, type: 'shell', connection: 'connected' },
    { version: 1, type: 'shell', connection: 'disconnected', data: 'private' }]) assert.equal(isHostMessage(value), false);
});
test('webview restricts resource loading and escapes HTML attributes', () => {
  const html = webviewHtml({ script: 'asset:" onload="bad', style: 'asset:style', source: 'vscode-webview:', nonce: 'random' });
  assert.match(html, /default-src 'none'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /script-src 'nonce-random'/);
  assert.match(html, /form-action 'none'/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval| onload="bad/);
  assert.match(html, /asset:&quot; onload=&quot;bad/);
});
