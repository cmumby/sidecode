# Sidecode

> We're starting a new VS Code/VSCodium extension project.
>
> Read `AGENTS.md`, `SPEC.md`, and `PLAN.md` in full before making any changes.
>
> Your task is to begin implementing the project according to those documents.
>
> **Instructions:**
>
> 1. Review the requirements and identify any contradictions, missing dependencies, or architectural concerns.
> 2. Research the existing OpenCode SDK and server APIs available to us. Prefer supported, documented interfaces.
> 3. Establish the project structure and development tooling according to the specification.
> 4. Begin **Phase 1** of `PLAN.md`, completing its tasks and acceptance criteria.
> 5. Update `PLAN.md` as tasks are completed, documenting important decisions and discoveries.
> 6. Run relevant checks and tests before reporting completion.
>
> **Important constraints:**
>
> - Do not attempt to implement the entire extension in one pass.
> - Do not modify my VSCodium settings, existing extensions, workspace layout, or user configuration.
> - Do not build a separate OpenCode agent runtime. This is a graphical client for the existing OpenCode server.
> - Keep the architecture modular so the UI can be redesigned without rewriting the backend integration.
> - Follow `AGENTS.md` throughout the project.
>
> **Start by briefly explaining your proposed architecture and Phase 1 approach. Then proceed with implementation.**
>
> When finished, summarize what you implemented, what you tested, any blockers, and the recommended next step.

<details><summary>18 previous messages</summary>

> I’ll start with a modular extension host for the OpenCode connection, a separate SDK adapter, and a webview UI behind a message boundary. I’ll read all three project documents before changing anything, verify the supported OpenCode interfaces, then implement and validate only Phase 1.
>
> <details><summary>Ran 5 commands, searched the web</summary>
>
> - Ran `pwd && rg --files -g 'AGENTS.md' -g 'SPEC.md' -g 'PLAN.md' -g '!node_modules' -g '!vendor'`
> - Ran `ls -la && for p in /home/AGENTS.md /home/curtis/AGENTS.md /home/curtis/Projects/AGENTS.md /home/curtis/Projects/workspace/AGENTS.md /home/curtis/Projects/workspace/git/AGENTS.md; do if [ -f "$p" ]; then cat "$p"; fi; done
head -40 git/sidecode/SPEC.md
head -30 git/podular/SPEC.md`
> - Ran `cat AGENTS.md SPEC.md PLAN.md
git status --short
ls -la`
>
> Searched the web for `site.opencode.ai docs sdk server`
>
> Searched the web for `https://opencode.ai/docs/sdk/`
>
> - Ran `command -v node npm opencode codium code Xvfb
node --version
npm --version
curl --max-time 5 -sS -D - http://127.0.0.1:4096/global/health`
> - Ran `opencode --version
codium --version
code --version
npm view @opencode-ai/sdk version
curl --max-time 5 -sS -D - http://127.0.0.1:4096/global/health`
>
> </details>
>
> The project is in `git/sidecode`, and I’ve read all three documents. Phase 1 will be a disconnected UI shell; connection handling belongs in Phase 2. I’ll use a dedicated Activity Bar container, as required by the spec, and treat the name and visual style as provisional.
>
> The main verification gaps are live-server compatibility and editor layout safety. OpenCode 1.19.4 is installed, but the initial health probe failed. I’m checking that before recording API support, and I’ll keep any unverified acceptance criteria open in `PLAN.md`.
>
> <details><summary>Ran 2 commands, searched the web</summary>
>
> - Ran `opencode serve --help
ls /usr/bin/*xvfb* /usr/bin/*Xvfb* 2>/dev/null
rg --files /home/curtis/.opencode | head -25`
>
> Searched the web for `https://raw.githubusercontent.com/anomalyco/opencode/v1.19.4/packages/sdk/js/src/v2/client.ts`
>
> - Ran `node --input-type=module <<'JS'
const base='http://127.0.0.1:4096';
for (const path of ['/','/doc','/session?directory='+encodeURIComponent(process.cwd()),'/event?directory='+encodeURIComponent(process.cwd()),'/global/event']) {
 const signal=AbortSignal.timeout(6000);
 try {
 const r=await fetch(base+path,{signal});
 console.log(path.split('?')[0],r.status,r.headers.get('content-type'));
 if(path==='/doc') { const d=await r.json(); console.log(JSON.stringify({info:d.info,routes:Object.entries(d.paths).filter(([p])=>/health|event|session|permission/.test(p)).map(([p,v])=>[p,Object.keys(v)])})); }
 else if(path.startsWith('/session')) {const s=await r.json();console.log('session array',Array.isArray(s),'count',s.length);}
 else if(path.includes('event')) {const reader=r.body.getReader(); const {value}=await reader.read(); const text=new TextDecoder().decode(value);console.log('first event types', [...text.matchAll(/"type"\s*:\s*"([^"]+)"/g)].map(m=>m[1])); await reader.cancel();}
 else await r.body.cancel();
 } catch {console.log('probe failed or timed out');process.exitCode=1;}
}
JS`
>
> </details>
>
> The server is reachable outside the sandbox: OpenCode 1.19.4 returns JSON from `/global/health` and `/session`, and both event routes emit `server.connected` over SSE. Its root returns HTML, exactly as the spec warns.
>
> I’ll pin the discovery SDK to 1.19.4 and use its client-only entry point. The live schema exposes both legacy routes and newer `/api/*` routes, so I’ll document that version boundary rather than assume all SDK examples are interchangeable. The Phase 1 extension itself will make no server requests.
>
> <details><summary>Explored a list, ran 3 commands</summary>
>
> - Ran `mkdir -p src/extension src/adapter src/shared src/webview scripts tests media docs
cat > package.json <<'EOF'
{
  "name": "sidecode",
  "displayName": "OpenCode IDE Client (Sidecode)",
  "description": "A sidebar client shell for an existing OpenCode server.",
  "version": "0.1.0",
  "publisher": "sidecode-local",
  "private": true,
  "license": "UNLICENSED",
  "engines": { "vscode": "^1.90.0", "node": ">=22.12.0" },
  "categories": ["Other"],
  "main": "./dist/extension.cjs",
  "extensionKind": ["workspace"],
  "capabilities": { "untrustedWorkspaces": { "supported": true }, "virtualWorkspaces": { "supported": true } },
  "contributes": {
    "viewsContainers": { "activitybar": [{ "id": "sidecode", "title": "OpenCode", "icon": "media/opencode.svg" }] },
    "views": { "sidecode": [{ "id": "sidecode.chat", "name": "OpenCode", "type": "webview" }] }
  },
  "scripts": {
    "build": "node scripts/build.mjs",
    "watch": "node scripts/build.mjs --watch",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "tsx --test tests/*.test.ts",
    "check": "npm run typecheck && npm run lint && npm test && npm run build",
    "vscode:prepublish": "npm run build",
    "package": "vsce package --no-dependencies --allow-missing-repository --skip-license --out sidecode-0.1.0.vsix",
    "probe": "tsx scripts/probe.ts",
    "test:editor": "node scripts/test-editor.mjs"
  }
}
EOF
cat > .gitignore <<'EOF'
node_modules/
dist/
*.vsix
.test-editor/
EOF
cat > .vscodeignore <<'EOF'
**/*
!package.json
!README.md
!media/opencode.svg
!dist/extension.cjs
!dist/webview.js
!dist/webview.css
EOF
cat > tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"], "jsx": "react-jsx",
    "strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true,
    "esModuleInterop": true, "skipLibCheck": true, "noEmit": true,
    "types": ["node", "vscode"]
  },
  "include": ["src", "tests", "scripts/*.ts"]
}
EOF
cat > eslint.config.mjs <<'EOF'
import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  { ignores: ['dist/**', 'node_modules/**', '.test-editor/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { files: ['**/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly' } } },
);
EOF
cat > scripts/build.mjs <<'EOF'
import { build, context } from 'esbuild';
const options = [
  { entryPoints: ['src/extension/activate.ts'], outfile: 'dist/extension.cjs', platform: 'node', format: 'cjs', external: ['vscode'], target: 'node20' },
  { entryPoints: ['src/webview/main.tsx'], outfile: 'dist/webview.js', platform: 'browser', format: 'iife', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"' } },
];
for (const option of options) {
  const config = { ...option, bundle: true, minify: true, legalComments: 'eof', logLevel: 'info' };
  if (process.argv.includes('--watch')) await (await context(config)).watch();
  else await build(config);
}
EOF
cat > media/opencode.svg <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M4 4h16v13H9l-5 4V4Z"/><path d="m10 8-3 3 3 3m4-6 3 3-3 3"/></svg>
EOF
npm install --save-exact react react-dom
npm install --save-dev --save-exact typescript @types/node@22 @types/react @types/react-dom @types/vscode@1.90.0 esbuild eslint@9 @eslint/js@9 typescript-eslint tsx @vscode/vsce @opencode-ai/sdk@1.19.4 @vscode/test-electron`
> - Ran ``cat > src/shared/protocol.ts <<'EOF'
>   /\*_ Versioned, deliberately small protocol. No server data or credentials in Phase 1. _/
>   export type WebviewMessage = { version: 1; type: 'ready' };
>   export type HostMessage = { version: 1; type: 'shell'; connection: 'disconnected' };
>
> function hasExactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
> return typeof value === 'object' && value !== null && !Array.isArray(value)
> && Object.keys(value).length === keys.length
> && keys.every((key) => Object.hasOwn(value, key));
> }
> export function isWebviewMessage(value: unknown): value is WebviewMessage {
> return hasExactKeys(value, ['version', 'type']) && value.version === 1 && value.type === 'ready';
> }
> export function isHostMessage(value: unknown): value is HostMessage {
> return hasExactKeys(value, ['version', 'type', 'connection'])
> && value.version === 1 && value.type === 'shell' && value.connection === 'disconnected';
> }
> EOF
> cat > src/adapter/README.md <<'EOF'
>
> # OpenCode adapter boundary
>
> Phase 1 intentionally has no live adapter. `scripts/probe.ts` verifies the pinned
> SDK against an existing server without becoming extension runtime code.
>
> Phase 2 owns SDK imports, endpoint validation, connection states, auth, bounded
> retries, SSE cancellation and disposal here. The extension host supplies explicit
> server and directory context and credentials from SecretStorage. React must not
> import this layer or receive SDK objects, paths, credentials or raw errors.
> Translate SDK results into a minimal validated shared protocol. Keep session,
> message and permission operations behind this boundary as later phases add them.
> EOF
> cat > src/extension/html.ts <<'EOF'
> function escapeAttribute(value: string): string {
> return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
> }
> export function webviewHtml(resources: { script: string; style: string; source: string; nonce: string }): string {
> const { script, style, source, nonce } = Object.fromEntries(
> Object.entries(resources).map(([key, value]) => [key, escapeAttribute(value)]),
> );
> return `<!doctype html>
>
> <html lang="en"><head><meta charset="UTF-8">
> <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${source}; connect-src 'none'; img-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none';">
> <meta name="viewport" content="width=device-width, initial-scale=1.0">
> <title>OpenCode</title><link rel="stylesheet" href="${style}"></head>
> <body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
> }
> EOF
> cat > src/extension/activate.ts <<'EOF'
> import { randomBytes } from 'node:crypto';
> import * as vscode from 'vscode';
> import { isWebviewMessage, type HostMessage } from '../shared/protocol';
> import { webviewHtml } from './html';
>
> export function activate(context: vscode.ExtensionContext): void {
> context.subscriptions.push(vscode.window.registerWebviewViewProvider('sidecode.chat', {
> resolveWebviewView(view) {
> const resources = vscode.Uri.joinPath(context.extensionUri, 'dist');
> view.webview.options = { enableScripts: true, localResourceRoots: [resources] };
> const listener = view.webview.onDidReceiveMessage((message: unknown) => {
> if (!isWebviewMessage(message)) return;
> const response: HostMessage = { version: 1, type: 'shell', connection: 'disconnected' };
> void view.webview.postMessage(response);
> });
> const disposal = view.onDidDispose(() => { listener.dispose(); disposal.dispose(); });
> context.subscriptions.push(listener, disposal);
> view.webview.html = webviewHtml({
> script: view.webview.asWebviewUri(vscode.Uri.joinPath(resources, 'webview.js')).toString(),
> style: view.webview.asWebviewUri(vscode.Uri.joinPath(resources, 'webview.css')).toString(),
> source: view.webview.cspSource,
> nonce: randomBytes(24).toString('base64'),
> });
> },
> }));
> }
> EOF
> cat > src/webview/App.tsx <<'EOF'
> import { useEffect, useState } from 'react';
> import { isHostMessage, type WebviewMessage } from '../shared/protocol';
>
> export interface HostBridge { postMessage(message: WebviewMessage): void }
> export function App({ bridge }: { bridge: HostBridge }) {
> const [ready, setReady] = useState(false);
> useEffect(() => {
> const receive = (event: MessageEvent<unknown>) => {
> if (isHostMessage(event.data)) setReady(true);
> };
> window.addEventListener('message', receive);
> bridge.postMessage({ version: 1, type: 'ready' });
> return () => window.removeEventListener('message', receive);
> }, [bridge]);
> return <main className="shell" aria-label="OpenCode chat">
> <header className="header">
> <div className="session-row"><h1>OpenCode</h1><button disabled title="Sessions arrive in Phase 3" aria-label="New session (unavailable)">New session</button></div>
> <p className="status" role="status"><span className="status-dot" aria-hidden="true" />{ready ? 'Not connected' : 'Initializing view…'}</p>
> </header>
> <section className="conversation" aria-label="Conversation">
> <div className="empty-state"><span className="eyebrow">OPENCODE IN YOUR IDE</span><h2>A place for your next idea</h2><p>Your conversations will appear here when server connections are available.</p><p className="phase-note">Phase 1 preview · Interface only</p></div>
> <ol className="messages" aria-label="Messages" aria-live="polite" />
> </section>
> <footer className="composer">
> <label htmlFor="prompt">Message OpenCode</label>
> <textarea id="prompt" rows={3} disabled placeholder="Connect a server to start a conversation" aria-describedby="composer-help" />
> <div className="composer-actions"><span id="composer-help">Connection support is coming in Phase 2.</span><button disabled>Send</button></div>
> </footer>
>
>   </main>;
> }
> EOF
> cat > src/webview/main.tsx <<'EOF'
> import { createRoot } from 'react-dom/client';
> import { App, type HostBridge } from './App';
> import './style.css';
> declare function acquireVsCodeApi(): HostBridge;
> const bridge = acquireVsCodeApi();
> const root = document.getElementById('root');
> if (root) createRoot(root).render(<App bridge={bridge} />);
> EOF
> cat > src/webview/style.css <<'EOF'
> :root { color-scheme: light dark; font-family: var(--vscode-font-family, sans-serif); font-size: var(--vscode-font-size, 13px); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
> * { box-sizing: border-box; }
> body { margin: 0; padding: 0; }
> html, body, #root { height: 100%; }
> button, textarea { font: inherit; }
> .shell { height: 100%; display: flex; flex-direction: column; min-width: 0; }
> .header { padding: 14px 12px 10px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border)); }
> .session-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
> h1 { font-size: 1rem; margin: 0; font-weight: 600; }
> .status { display: flex; align-items: center; gap: 6px; color: var(--vscode-descriptionForeground); font-size: .9rem; margin: 9px 0 0; }
> .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--vscode-descriptionForeground); flex-shrink: 0; }
> .conversation { flex: 1; overflow: auto; min-height: 64px; padding: 16px 12px; overflow-wrap: anywhere; }
> .empty-state { max-width: 36rem; margin: 24px auto; }
> .eyebrow { font-size: .75rem; letter-spacing: .08em; color: var(--vscode-descriptionForeground); }
> h2 { font-size: 1.3rem; line-height: 1.4; font-weight: 500; margin: 12px 0; }
> p { line-height: 1.6; }
> .empty-state p { color: var(--vscode-descriptionForeground); }
> .phase-note { font-size: .9rem; border-left: 2px solid var(--vscode-panel-border); padding-left: 8px; }
> .messages { list-style: none; padding: 0; margin: 0; }
> .composer { flex-shrink: 0; padding: 12px; border-top: 1px solid var(--vscode-panel-border); }
> label { display: block; margin-bottom: 8px; }
> textarea { resize: vertical; width: 100%; min-height: 64px; max-height: 25vh; padding: 9px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 3px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
> textarea::placeholder { color: var(--vscode-input-placeholderForeground); opacity: 1; }
> .composer-actions { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
> .composer-actions span { flex: 1 1 120px; font-size: .85rem; line-height: 1.5; color: var(--vscode-descriptionForeground); }
> button { padding: 5px 9px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
> button:disabled { color: var(--vscode-disabledForeground); cursor: not-allowed; }
> :focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
> body.vscode-high-contrast button, body.vscode-high-contrast-light button, body.vscode-high-contrast textarea, body.vscode-high-contrast-light textarea { border-color: var(--vscode-contrastBorder); }
> @media (max-width: 240px) { .header, .conversation, .composer { padding-left: 8px; padding-right: 8px; } .empty-state { margin-top: 8px; } }
> @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
> EOF``
>
> <details><summary>Explored a list</summary>
>
> - Listed files in `_logs`
>
> </details>
>
> - Ran `printenv DISPLAY WAYLAND_DISPLAY
ls -l /usr/bin/code /usr/bin/codium
rg --files /home/curtis/.cache | rg 'playwright.*(chrome$|headless_shell$)' | head -5`
>
> </details>
>
> The shell now has a dockable view, React layout, validated host/webview messages, and a Content Security Policy that blocks webview network access. The controls clearly show that this is an interface preview.
>
> I’m adding protocol and lifecycle tests, a reproducible read-only server probe, and isolated editor checks. Test editors will use temporary profiles so they leave your current settings and extensions alone.
>
> <details><summary>Explored 2 files, a search, ran 9 commands</summary>
>
> - Ran `ps -eo pid,etime,args | rg 'npm install|npm exec'`
> - Ran `npm install --save-exact react react-dom --cache /tmp/sidecode-npm-cache --fetch-retries=0 --fetch-timeout=15000 && npm install --save-dev --save-exact typescript @types/node@22 @types/react @types/react-dom @types/vscode@1.90.0 esbuild eslint@9 @eslint/js@9 typescript-eslint tsx @vscode/vsce @opencode-ai/sdk@1.19.4 @vscode/test-electron --cache /tmp/sidecode-npm-cache --fetch-retries=0 --fetch-timeout=15000`
> - Ran ``cat > tests/protocol.test.ts <<'EOF'
>   import assert from 'node:assert/strict';
>   import test from 'node:test';
>   import { isHostMessage, isWebviewMessage } from '../src/shared/protocol';
>   import { webviewHtml } from '../src/extension/html';
>
> test('only the current, exact shell protocol crosses the bridge', () => {
> assert.equal(isWebviewMessage({ version: 1, type: 'ready' }), true);
> assert.equal(isHostMessage({ version: 1, type: 'shell', connection: 'disconnected' }), true);
> for (const value of [null, [], 'ready', 1, {}, { version: 2, type: 'ready' },
> { version: 1, type: 'ready', token: 'secret' }, { version: 1, type: 'execute', command: 'x' },
> Object.create({ version: 1, type: 'ready' })]) assert.equal(isWebviewMessage(value), false);
> for (const value of [null, [], {}, { version: 1, type: 'shell', connection: 'connected' },
> { version: 1, type: 'shell', connection: 'disconnected', data: 'private' }]) assert.equal(isHostMessage(value), false);
> });
> test('webview restricts resource loading and escapes HTML attributes', () => {
> const html = webviewHtml({ script: 'asset:" onload="bad', style: 'asset:style', source: 'vscode-webview:', nonce: 'random' });
> assert.match(html, /default-src 'none'/);
> assert.match(html, /connect-src 'none'/);
> assert.match(html, /script-src 'nonce-random'/);
> assert.match(html, /form-action 'none'/);
> assert.doesNotMatch(html, /unsafe-inline|unsafe-eval| onload="bad/);
> assert.match(html, /asset:&quot; onload=&quot;bad/);
> });
> EOF
> cat > tests/extension.test.ts <<'EOF'
> import assert from 'node:assert/strict';
> import test from 'node:test';
> import { build } from 'esbuild';
> import vm from 'node:vm';
> import { randomBytes } from 'node:crypto';
> import { readFile } from 'node:fs/promises';
>
> test('activation only registers a view; bridge validates and disposes listeners', async () => {
> const result = await build({ entryPoints: ['src/extension/activate.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
> let provider: { resolveWebviewView(view: unknown): void } | undefined;
> let receiver: (value: unknown) => void = () => assert.fail('not registered');
> let onDispose = () => assert.fail('not registered');
> const sent: unknown[] = [];
> let disposed = 0;
> const subscription = { dispose: () => { disposed++; } };
> const vscode = {
> window: { registerWebviewViewProvider: (id: string, value: typeof provider) => { assert.equal(id, 'sidecode.chat'); provider = value; return subscription; } },
> Uri: { joinPath: (root: string, ...parts: string[]) => [root, ...parts].join('/') },
> };
> // No workspace/configuration/command/terminal APIs: any accidental use fails this test.
> const module = { exports: {} as { activate(context: unknown): void } };
> vm.runInNewContext(result.outputFiles[0]!.text, { module, exports: module.exports, require: (id: string) => {
> if (id === 'vscode') return vscode;
> if (id === 'node:crypto') return { randomBytes };
> throw new Error(`Unexpected runtime dependency: ${id}`);
> } });
> const subscriptions: unknown[] = [];
> module.exports.activate({ extensionUri: '/extension', subscriptions });
> assert.equal(subscriptions.length, 1);
> assert.ok(provider);
> const webview = { options: { enableScripts: false, localResourceRoots: [] as string[] }, html: '', cspSource: 'vscode-webview:',
> asWebviewUri: (uri: string) => uri,
> onDidReceiveMessage: (fn: typeof receiver) => { receiver = fn; return subscription; },
> postMessage: (message: unknown) => { sent.push(message); return Promise.resolve(true); },
> };
> provider.resolveWebviewView({ webview, onDidDispose: (fn: typeof onDispose) => { onDispose = fn; return subscription; } });
> assert.equal(webview.options.enableScripts, true);
> assert.equal(webview.options.localResourceRoots.join(','), '/extension/dist');
> receiver({ type: 'execute', command: 'workbench.action.moveView' });
> assert.equal(sent.length, 0);
> receiver({ version: 1, type: 'ready' });
> assert.equal(JSON.stringify(sent), '[{"version":1,"type":"shell","connection":"disconnected"}]');
> onDispose();
> assert.equal(disposed, 2);
> });
> test('manifest contributes only its own sidebar and has no layout or settings contributions', async () => {
> const manifest = JSON.parse(await readFile('package.json', 'utf8'));
> assert.deepEqual(Object.keys(manifest.contributes).sort(), ['views', 'viewsContainers']);
> assert.equal(manifest.contributes.views.sidecode[0].type, 'webview');
> assert.equal(manifest.contributes.viewsContainers.activitybar[0].id, 'sidecode');
> });
> EOF
> cat > tests/editor-suite.ts <<'EOF'
> import assert from 'node:assert/strict';
> import \* as vscode from 'vscode';
> export async function run(): Promise<void> {
> const before = vscode.window.tabGroups.all.map((group) => ({ active: group.isActive, count: group.tabs.length }));
> const config = JSON.stringify(vscode.workspace.getConfiguration());
> const extension = vscode.extensions.getExtension('sidecode-local.sidecode');
> assert.ok(extension, 'packaged extension is installed');
> await extension.activate();
> await vscode.commands.executeCommand('sidecode.chat.focus');
> assert.equal(extension.isActive, true);
> assert.deepEqual(vscode.window.tabGroups.all.map((group) => ({ active: group.isActive, count: group.tabs.length })), before);
> assert.equal(JSON.stringify(vscode.workspace.getConfiguration()), config);
> console.log('PASS: activation and view focus preserve editor groups and configuration', vscode.workspace.workspaceFolders ? 'folder' : 'empty window');
> }
> EOF
> cat > scripts/test-editor.mjs <<'EOF'
> import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
> import { tmpdir } from 'node:os';
> import { join, resolve } from 'node:path';
> import { execFileSync } from 'node:child_process';
> import { build } from 'esbuild';
> import { runTests } from '@vscode/test-electron';
> const cli = process.env.SIDECODE_EDITOR_CLI || '/usr/bin/codium';
> const executable = process.env.SIDECODE_EDITOR_BINARY || '/usr/share/codium/codium';
> const root = await mkdtemp(join(tmpdir(), 'sidecode-editor-'));
> const extensions = join(root, 'extensions');
> const user = join(root, 'profile');
> const harness = join(root, 'harness');
> const folder = join(root, 'workspace');
> await Promise.all([mkdir(extensions), mkdir(user), mkdir(harness), mkdir(folder)]);
> await writeFile(join(harness, 'package.json'), JSON.stringify({ name: 'sidecode-test-harness', publisher: 'sidecode-local', version: '0.0.0', engines: { vscode: '^1.90.0' } }));
> await build({ entryPoints: ['tests/editor-suite.ts'], outfile: join(harness, 'suite.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['vscode'] });
> const args = ['--user-data-dir', user, '--extensions-dir', extensions];
> const install = () => execFileSync(cli, [...args, '--install-extension', resolve('sidecode-0.1.0.vsix')], { stdio: 'inherit' });
> install();
> for (const workspace of [[], [folder]]) {
> await runTests({ vscodeExecutablePath: executable, extensionDevelopmentPath: harness, extensionTestsPath: join(harness, 'suite.cjs'),
> launchArgs: [...args, '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry', '--disable-workspace-trust', ...workspace] });
> }
> // Lifecycle verification applies only to this disposable test profile.
> const settingsPath = join(user, 'User', 'settings.json');
> const settings = await readFile(settingsPath, 'utf8').catch(() => undefined);
> execFileSync(cli, [...args, '--uninstall-extension', 'sidecode-local.sidecode'], { stdio: 'inherit' });
> install();
> if (await readFile(settingsPath, 'utf8').catch(() => undefined) !== settings) throw new Error('Settings changed during install/uninstall');
> console.log('PASS: clean-profile install/uninstall/reinstall; profile retained at', root);
> EOF``
>
> - Ran `npm audit --json --cache /tmp/sidecode-npm-cache`
> - Ran `rg -n 'health\(|subscribe\(|list\(' node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts | head -25
cat node_modules/@opencode-ai/sdk/package.json
npm run typecheck
npm run lint
npm test`
> - Ran `rg -n 'class Global|class Event|class Session|health<|subscribe<|list<' node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts | head -35
sed -n '25,105p' node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts
rg -n 'class Event' node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts
cat > src/webview/assets.d.ts <<'EOF'
declare module '*.css';
EOF`
> - Ran `npm install --save-dev --save-exact typescript@5.8.3 typescript-eslint@8.36.0 @vscode/vsce@3.9.1 --cache /tmp/sidecode-npm-cache --fetch-retries=0 --fetch-timeout=15000`
>
> <details><summary>Explored 3 files, a search</summary>
>
> - Read `./node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts`
> - Read `./node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts`
> - Searched for `get session|get event|get global` in `sdk.gen.d.ts`
> - Read `./node_modules/@opencode-ai/sdk/dist/v2/gen/core/serverSentEvents.gen.d.ts`
>
> </details>
>
> - Ran ````cat > scripts/probe.ts <<'EOF'
>   /\*_ Read-only discovery tool; never imported by the extension. Prints no session contents. _/
>   import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
>
> async function probe() {
> const baseUrl = new URL(process.env.OPENCODE_URL || 'http://127.0.0.1:4096');
> if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new Error('invalid URL');
> const directory = process.env.OPENCODE_DIRECTORY || process.cwd();
> const controller = new AbortController();
> const timer = setTimeout(() => controller.abort(), 10_000);
> const headers: Record<string, string> = {};
> if (process.env.OPENCODE_SERVER_PASSWORD) headers.Authorization = `Basic ${Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME || 'opencode'}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`;
> const checkedFetch: typeof fetch = async (input, init) => {
> const request = new Request(input, init);
> const response = await fetch(request, { signal: AbortSignal.any([request.signal, controller.signal]), redirect: 'error' });
> const path = new URL(request.url).pathname;
> const expected = path.endsWith('/event') ? 'text/event-stream' : 'application/json';
> if (!response.ok || response.headers.get('content-type')?.split(';')[0]?.trim() !== expected) {
> await response.body?.cancel();
> throw new Error('invalid API response');
> }
> return response;
> };
> try {
> const client = createOpencodeClient({ baseUrl: baseUrl.toString(), directory, headers, fetch: checkedFetch, throwOnError: true });
> const health = await client.global.health({ signal: controller.signal });
> if (health.data?.healthy !== true || typeof health.data.version !== 'string') throw new Error('invalid health');
> console.log('health:', JSON.stringify({ healthy: true, version: health.data.version }));
> const sessions = await client.session.list({ directory }, { signal: controller.signal });
> if (!Array.isArray(sessions.data)) throw new Error('invalid session list');
> console.log('sessions:', sessions.data.length, '(contents omitted)');
> const events = await client.event.subscribe({ directory }, { signal: controller.signal, sseMaxRetryAttempts: 1 });
> for await (const event of events.stream) {
> if (event.type === 'server.connected') { console.log('SSE: server.connected'); break; }
> }
> controller.abort();
> } finally { controller.abort(); clearTimeout(timer); }
> }
> probe().catch(() => {
> console.error('Probe failed. Check server availability, API compatibility, directory and documented Basic auth. Details suppressed to protect credentials and paths.');
> process.exitCode = 1;
> });
> EOF
> cat > README.md <<'EOF'
>
> # OpenCode IDE Client (Sidecode)
>
> A VS Code/VSCodium sidebar client for an **existing OpenCode server**. Phase 1
> provides an installable, disconnected React interface: header, empty conversation
> and disabled composer. It does not send prompts or start a server.
>
> ## Development
>
> Use Node.js 22.12+ and npm. From this directory:
>
> ```sh
> npm ci
> npm run check
> npm run package
> ```
>
> The package is `sidecode-0.1.0.vsix`. `npm run watch` rebuilds host and webview.
> No global tools or marketplace account are required. The publisher
> `sidecode-local` and display name are provisional, for local installation only.
> The project is private and currently has no distribution license.
>
> ## Try in an isolated editor profile
>
> To keep your everyday editor untouched, use fresh directories for BOTH user data
> and extensions. These commands are examples to run explicitly, not activation behavior:
>
> ```sh
> codium --user-data-dir /tmp/sidecode-preview/profile --extensions-dir /tmp/sidecode-preview/extensions --install-extension ./sidecode-0.1.0.vsix
> codium --user-data-dir /tmp/sidecode-preview/profile --extensions-dir /tmp/sidecode-preview/extensions --new-window
> ```
>
> Substitute `code` for VS Code. Select **OpenCode** in the Activity Bar. Use the
> view title's **Move View** action to choose **Secondary Side Bar**, or use the
> editor's normal drag controls. The extension never moves views or editor groups.
> For a development host, add `--extensionDevelopmentPath="$PWD"` to the second
> command (after building). No `.vscode` workspace configuration is required.
>
> Uninstall only in that test profile:
>
> ```sh
> codium --user-data-dir /tmp/sidecode-preview/profile --extensions-dir /tmp/sidecode-preview/extensions --uninstall-extension sidecode-local.sidecode
> ```
>
> ## Verification
>
> - `npm run check`: strict TypeScript, lint, protocol/security/lifecycle unit tests, bundled build.
> - `npm run test:editor`: installs the VSIX into a newly created temporary profile;
>   checks activation/view focus with a folder and an empty window, checks unchanged
>   configuration/editor groups, then uninstalls/reinstalls. Launches isolated editor windows.
> - For VS Code: `SIDECODE_EDITOR_CLI=/usr/bin/code SIDECODE_EDITOR_BINARY=/usr/share/code/code npm run test:editor`.
> - `npm run probe`: read-only SDK health, session count and first SSE connection event
>   against `http://127.0.0.1:4096`. Optional `OPENCODE_URL`, `OPENCODE_DIRECTORY`,
>   `OPENCODE_SERVER_USERNAME`, `OPENCODE_SERVER_PASSWORD` environment variables.
>   No credentials, directory values, session IDs or message contents are printed.
>
> See [verification checklist](docs/verification.md) for manual acceptance gates and
> [discovery notes](docs/discovery.md) for the exact tested API scope.
>
> ## Structure and boundaries
>
> - `src/extension`: VS Code activation, resource loading and webview bridge.
> - `src/shared`: versioned messages and runtime validators in both directions.
> - `src/webview`: React presentation and VS Code theme tokens; no HTTP or Node access.
> - `src/adapter`: reserved boundary for the Phase 2 SDK integration.
> - `scripts/probe.ts`: standalone discovery; SDK is only a development dependency now.
>
> No telemetry, credential storage, settings writes, session mutations, terminal
> creation or automatic opening of chat windows. The strict webview CSP blocks
> network requests and allows only bundled scripts/styles. React renders text;
> Markdown and other untrusted rich content rendering remain later-phase work.
>
> The Phase 1 visual direction is a provisional native minimal shell. Final visual
> design still requires the roadmap's 2–3 concepts and selection. Server auth,
> connection/reconnect, streaming conversations, permissions and models are not yet
> implemented. Empty windows and untrusted/virtual workspaces are safe for this
> shell; revisit capability declarations when adding privileged operations.
> EOF
> cat > docs/discovery.md <<'EOF'
>
> # Discovery — 2026-11-12
>
> ## Decisions and concerns
>
> The specification mandates a dedicated Activity Bar view; this resolves the
> roadmap's open question about the default container. Moving it remains a user
> action. Provisional identifier: `sidecode-local.sidecode`, view `sidecode.chat`.
> Do not publish this provisional identity. No Git repository existed in this folder.
>
> Keep the host, adapter, protocol and React UI separate. Use esbuild for two bundles,
> TypeScript, React, ESLint, Node tests and vsce. No UI framework, router, state
> library, runtime validation dependency or agent runtime is needed for the shell.
> Use exact dependencies and the committed lockfile. SDK 1.19.4 is a development-only
> discovery dependency, matching the installed server, not a declared compatibility range.
>
> The roadmap asks for discovery before implementation and integration coverage
> before feature completion. Read-only discovery is verified below; authenticated
> server behavior and conversation semantics remain outstanding. Phase 1 has no
> connection feature and can be tested independently. Final visual language is
> explicitly deferred until the planned concept exploration. Manual layout and
> accessibility checks must not be inferred from a passing build.
>
> ## Sources inspected
>
> - Official [SDK documentation](https://opencode.ai/docs/sdk/), currently redirecting
>   to V1 documentation: client-only `createOpencodeClient`; `createOpencode` starts
>   a server and must not be used by this extension.
> - Official [server documentation](https://opencode.ai/docs/server/): `/doc` OpenAPI,
>   health, session and SSE routes. Basic auth uses `OPENCODE_SERVER_PASSWORD` and
>   optional `OPENCODE_SERVER_USERNAME` (default `opencode`). Provider auth endpoints
>   are not server login endpoints.
> - [Versioned SDK client source](https://github.com/anomalyco/opencode/blob/v1.19.4/packages/sdk/js/src/v2/client.ts)
>   and installed `@opencode-ai/sdk@1.19.4` generated types/SSE implementation.
> - Live server `/doc`: lists legacy `/session`, `/event`, `/global/health`,
>   `/permission/{requestID}/reply` alongside newer `/api/*` routes. Its schema
>   `info.version` is `1.0.0`, which is NOT the running server version.
> - [VS Code webviews](https://code.visualstudio.com/api/extension-guides/webview)
>   and [packaging](https://code.visualstudio.com/api/working-with-extensions/publishing-extension):
>   stable WebviewViewProvider, message passing, theme variables, CSP, local VSIX.
>   Minimum API target 1.90 is a build target; tested editor versions are recorded separately.
>
> ## Live read-only findings
>
> Local binary and `/global/health` both report **1.19.4**. The network sandbox
> initially prevented connecting; the same probes succeeded with network access.
> No server was started, stopped or reconfigured.
>
> | Request                        | Observed response                                    |
> | ------------------------------ | ---------------------------------------------------- |
> | `/`                            | 200, `text/html`                                     |
> | `/global/health`               | 200, JSON, healthy and version 1.19.4                |
> | `/doc`                         | 200, JSON OpenAPI                                    |
> | `/session?directory=<project>` | 200, JSON array; zero sessions for this directory    |
> | `/event?directory=<project>`   | 200, `text/event-stream`, `server.connected`         |
> | `/global/event`                | 200, `text/event-stream`, wrapped `server.connected` |
>
> These endpoints required no credentials on this server. Basic auth protection
> has NOT been tested against an authenticated instance. No prompts, permissions,
> sessions or existing server configuration were modified.
>
> `@opencode-ai/sdk/v2/client` exposes flat arguments. `session.list({ directory })`
> and `event.subscribe({ directory })` correspond to the observed legacy routes.
> The SDK passes directory context via query/header handling; `session.list` also
> exposes `scope: 'project'` and `path`. Do not assume a global session list or infer
> CLI continuity from an empty array. Phase 3 must test a real CLI-created session
> using matching server, directory and session ID, including project/worktree scope.
>
> SSE supports AbortSignal, custom fetch and bounded retry options. The probe adds
> status/content-type validation to custom fetch because SDK HTML checks alone do
> not cover every invalid response. Global and directory event envelopes differ.
> Phase 2 must distinguish health, session initialization and event subscription,
> validate events, own cancellation/reconnection, and bound retries explicitly.
> No streaming, permission, reconnect or cross-version support is claimed yet.
> EOF
> cat > docs/verification.md <<'EOF'
>
> # Phase 1 verification
>
> Automated tests cover the exact bridge schema, unknown/malformed messages,
> HTML escaping/CSP, resource restrictions, activation without privileged APIs,
> listener disposal, manifest contributions and isolated editor lifecycle.
>
> Manual acceptance matrix (mark only after observing):
>
> - [ ] VSCodium: open view with folder and empty window; visible React content.
> - [ ] VS Code: open view with folder and empty window; visible React content.
> - [ ] Move view to Secondary Side Bar through native controls, then restore it.
> - [ ] Existing unrelated views/editor groups retain placement after activation.
> - [ ] Readable at 200/240/320 px widths with no horizontal overflow.
> - [ ] Light, dark, high contrast dark/light themes; visible labels and boundaries.
> - [ ] Keyboard navigation, screen reader labels, zoom, reduced motion.
> - [ ] Disable/re-enable, hide/show and reload restore the shell cleanly.
> - [ ] Install/uninstall leaves Codex/Claude, settings and layout unchanged.
>
> Use disposable profiles for every editor test. Never test layout moves or theme
> changes in the user's live profile. Automated group/configuration checks do not
> prove visual docking, assistive technology behavior or third-party coexistence.
> EOF
> npm run check````
>
> - Ran `npm run package`
>
> </details>
>
> Typechecking, linting, and all four unit tests pass. Packaging caught a documentation issue: relative README links need a repository URL, which this new project doesn’t have yet. I’m fixing that without inventing one.
>
> The SDK discovery script is ready. Next I’ll run it against the server and test the packaged extension in temporary VSCodium and VS Code profiles. Manual docking and visual checks will remain separate from automated activation checks.
>
> <details><summary>Ran 7 commands</summary>
>
> - Ran ``python3 - <<'PY'
p='README.md'
s=open(p).read().replace('[verification checklist](docs/verification.md)', '`docs/verification.md` checklist').replace('[discovery notes](docs/discovery.md)', '`docs/discovery.md` notes')
open(p,'w').write(s)
PY
npm run package``
> - Ran `npm run probe`
> - Ran `python3 - <<'PY'
import json
p='package.json'
d=json.load(open(p)); d['type']='module';open(p,'w').write(json.dumps(d,indent=2)+'\n')
PY`
> - Ran `npm run test:editor`
> - Ran `npm run probe`
> - Ran `python3 - <<'PY'
p='scripts/test-editor.mjs'
s=open(p).read().replace("const cli =", "// The coding environment can export this for CLI processes; the test binary needs GUI mode.\ndelete process.env.ELECTRON_RUN_AS_NODE;\nconst cli =")
open(p,'w').write(s)
PY
npm run package`
> - Ran `npm run test:editor`
>
> </details>
>
> The VSIX builds successfully, and the pinned SDK probe passes against OpenCode 1.19.4: healthy response, session listing, and an SSE connection event. The SDK required ESM imports; the extension host remains a CommonJS bundle.
>
> The first editor test failed because an inherited environment flag launched Electron in Node mode. I’ve corrected that in the test runner and am retrying with a fresh profile.
>
> <details><summary>Ran 6 commands</summary>
>
> - Ran `npm audit --json --cache /tmp/sidecode-npm-cache > /tmp/sidecode-audit.json
node --input-type=module -e 'import fs from "node:fs"; const a=JSON.parse(fs.readFileSync("/tmp/sidecode-audit.json")); console.log(JSON.stringify({counts:a.metadata.vulnerabilities,packages:Object.entries(a.vulnerabilities).map(([k,v])=>({name:k,direct:v.isDirect,via:v.via,fix:v.fixAvailable}))},null,2))'`
> - Ran `SIDECODE_EDITOR_CLI=/usr/bin/code SIDECODE_EDITOR_BINARY=/usr/share/code/code npm run test:editor`
> - Ran `command -v chromium chromium-browser google-chrome
npm ls --depth=0`
> - Ran `python3 - <<'PY'
import json
p='package.json';d=json.load(open(p));d['overrides']={'minimatch': '11.0.1'};open(p,'w').write(json.dumps(d,indent=2)+'\n')
p='scripts/probe.ts';s=open(p).read().replace('    for await (const event of events.stream) {','    let connected = false;\n    for await (const event of events.stream) {').replace("if (event.type === 'server.connected') { console.log", "if (event.type === 'server.connected') { connected = true; console.log").replace('    controller.abort();\n  } finally', "    if (!connected) throw new Error('stream ended before connection');\n    controller.abort();\n  } finally");open(p,'w').write(s)
PY`
> - Ran `npm install --save-dev --save-exact @vscode/vsce@4.1.0 playwright-core --cache /tmp/sidecode-npm-cache --fetch-retries=0 --fetch-timeout=15000`
> - Ran ``cat > scripts/test-webview.ts <<'EOF'
>   import assert from 'node:assert/strict';
>   import { readFile, mkdtemp } from 'node:fs/promises';
>   import { tmpdir } from 'node:os';
>   import { join } from 'node:path';
>   import { chromium } from 'playwright-core';
>   import { webviewHtml } from '../src/extension/html';
>
> const output = await mkdtemp(join(tmpdir(), 'sidecode-webview-'));
> const browser = await chromium.launch({ executablePath: process.env.SIDECODE_CHROME || '/usr/bin/google-chrome', headless: true });
> const themes = [
> > { name: 'vscode-dark', background: '#181818', foreground: '#cccccc', input: '#313131', border: '#454545' },
> > { name: 'vscode-light', background: '#f8f8f8', foreground: '#3b3b3b', input: '#ffffff', border: '#cecece' },
> > { name: 'vscode-high-contrast', background: '#000000', foreground: '#ffffff', input: '#000000', border: '#ffffff' },
> > { name: 'vscode-high-contrast-light', background: '#ffffff', foreground: '#292929', input: '#ffffff', border: '#292929' },
> > ];
> try {
> for (const theme of themes) for (const width of [200, 240, 320]) {
> const page = await browser.newPage({ viewport: { width, height: 600 }, reducedMotion: 'reduce' });
> const errors: string[] = [];
> page.on('pageerror', (error) => errors.push(error.message));
> const css = await readFile('dist/webview.css', 'utf8');
> const tokens = `:root { --vscode-font-family: sans-serif; --vscode-sideBar-background: ${theme.background}; --vscode-foreground: ${theme.foreground}; --vscode-descriptionForeground: ${theme.foreground}; --vscode-input-background: ${theme.input}; --vscode-input-foreground: ${theme.foreground}; --vscode-input-placeholderForeground: ${theme.foreground}; --vscode-panel-border: ${theme.border}; --vscode-contrastBorder: ${theme.border}; --vscode-button-secondaryBackground: ${theme.input}; --vscode-disabledForeground: ${theme.foreground}; }`;
> const html = webviewHtml({ script: 'https://sidecode.test/webview.js', style: 'https://sidecode.test/webview.css', source: 'https://sidecode.test', nonce: 'test-nonce' }).replace('<body>', `<body class="${theme.name}">`);
> await page.route('\*_/_', async (route) => {
> const path = new URL(route.request().url()).pathname;
> if (path === '/') await route.fulfill({ contentType: 'text/html', body: html });
> else if (path === '/webview.js') await route.fulfill({ contentType: 'text/javascript', body: await readFile('dist/webview.js', 'utf8') });
> else if (path === '/webview.css') await route.fulfill({ contentType: 'text/css', body: tokens + css });
> else { errors.push('Unexpected resource request'); await route.abort(); }
> });
> await page.addInitScript(() => {
> Object.assign(window, { acquireVsCodeApi: () => ({ postMessage: () => {
> queueMicrotask(() => window.postMessage({ version: 1, type: 'shell', connection: 'disconnected' }, '\*'));
> } }) });
> });
> await page.goto('https://sidecode.test/');
> await page.getByRole('status').filter({ hasText: 'Not connected' }).waitFor();
> assert.equal(await page.getByLabel('Message OpenCode', { exact: true }).isDisabled(), true);
> assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
> assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${theme.name} ${width}: horizontal overflow`);
> assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight), true, 'page should fit viewport');
> assert.deepEqual(errors, []);
> if (width === 320) await page.screenshot({ path: join(output, `${theme.name}.png`) });
> await page.close();
> }
> console.log('PASS: 12 theme/width cases, bridge handshake, disabled controls, no overflow or script errors. Screenshots:', output);
> } finally { await browser.close(); }
> EOF
> python3 - <<'PY'
> import json
> p='package.json';d=json.load(open(p));d['scripts']['test:webview']='tsx scripts/test-webview.ts';open(p,'w').write(json.dumps(d,indent=2)+'\n')
> PY``
>
> </details>
>
> The packaged extension passes activation, view focus, and install/uninstall/reinstall checks in both VSCodium and VS Code, with a folder open and in an empty window. Those tests found no changes to configuration or editor tab groups.
>
> The dependency audit is also clean after updating the packager and overriding a vulnerable development dependency. I’m finishing browser checks at 200, 240, and 320 pixels across four theme fixtures, then recording the results and remaining manual checks in `PLAN.md`.
>
> <details><summary>Explored a search, 2 lists, ran 6 commands</summary>
>
> - Ran `npm run check && npm run package && npm run test:webview`
>
> <details><summary>Explored a search, 2 lists</summary>
>
> - Searched for `sseMaxRetryAttempts|onSseError` in `serverSentEvents.gen.js`
> - Listed files in `sidecode-0.1.0.vsix`
> - Listed files
>
> </details>
>
> - Ran `python3 - <<'PY'
p='scripts/test-webview.ts';s=open(p).read().replace("page.on('pageerror', (error) => errors.push(error.message));", "page.on('pageerror', (error) => errors.push(error.message));\n    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });").replace("await page.getByRole('status').filter({ hasText: 'Not connected' }).waitFor();", "await page.getByRole('status').filter({ hasText: 'Not connected' }).waitFor({ timeout: 5000 }).catch(async (error) => { console.error(errors, await page.locator('body').innerText()); throw error; });");open(p,'w').write(s)
PY`
> - Ran `npm run test:webview`
> - Ran ``python3 - <<'PY'
p='scripts/test-webview.ts';s=open(p).read();start=s.index('    await page.addInitScript(');end=s.index("    await page.goto", start);s=s[:start]+'''    await page.addInitScript(`window.acquireVsCodeApi = () => ({ postMessage: () => {
      queueMicrotask(() => window.postMessage({ version: 1, type: 'shell', connection: 'disconnected' }, '*'));
    } });`);
'''+s[end:];open(p,'w').write(s)
PY``
> - Ran `npm run test:webview`
> - Ran ``python3 - <<'PY'
>   p='PLAN.md';s=open(p).read();done=[
>   > 'Inspect official OpenCode SDK/API and server event contracts; record supported versions.',
>   > 'Confirm supported VS Code APIs and VSCodium packaging requirements.',
>   > 'Record architecture decision and minimal dependencies.',
>   > 'Scaffold TypeScript extension, React webview, and shared typed protocol.',
>   > 'Register a dockable OpenCode sidebar view; no external window or editor tab for chat.',
>   > 'Apply IDE theme tokens, light/dark/high-contrast, and responsive narrow-width styling.',
>   > 'Add a placeholder header, message list, and composer.',
>   > 'Add VSIX packaging and local installation instructions.'
>   > ]
>   for item in done:s=s.replace('- [ ] '+item,'- [x] '+item)
>   s+='''
>
> ## Implementation record — 2026-11-12
>
> Phase 1 implementation is in place; **manual exit verification remains open**.
> No Phase 2 runtime connection behavior has been implemented.
>
> ### Discovery and decisions
>
> - Read AGENTS.md, SPEC.md and this roadmap in full before changes.
> - Local OpenCode binary/server: 1.19.4. Pinned SDK 1.19.4, client-only
>   `@opencode-ai/sdk/v2/client`; ESM discovery script, CommonJS extension bundle.
> - Real server: `/` serves HTML; `/global/health`, `/doc`, directory-scoped
>   `/session`, `/event` and `/global/event` passed read-only probes. SDK proof
>   lists session count and receives `server.connected` without logging contents.
> - Phase 0 connectivity proof passes for this unauthenticated instance. Authenticated
>   Basic auth, CLI continuity and precise project/worktree scope remain unverified;
>   their combined checklist items above intentionally stay open. No broader server
>   version range or conversation support is claimed. See `docs/discovery.md`.
> - Dedicated Activity Bar container follows SPEC.md; no automatic movement.
>   Provisional display name OpenCode IDE Client (Sidecode), ID `sidecode-local.sidecode`.
> - Native minimal shell is provisional; final visual design still needs 2–3 concepts.
> - React + TypeScript, esbuild, ESLint, Node tests, vsce. Separate extension,
>   adapter, shared protocol and webview directories. SDK stays development-only.
> - TypeScript/ESLint tooling pinned for installed Node 22.12; minimatch overridden
>   to 11.0.1 to resolve a development dependency advisory. Lint/build/package tests
>   validate this override; review/remove when upstream tools adopt the fix.
> - No Git metadata was present; no repository URL, release license or marketplace
>   identity was invented. Package is private and for local testing.
>
> ### Verification and limits
>
> - `npm run check`: strict typecheck, lint, 4 protocol/security/lifecycle tests, build pass.
> - `npm run package`: local VSIX built; package contains only manifest, README,
>   bundled host/webview and the Activity Bar icon (no SDK, tests or server runtime).
> - `npm run probe`: SDK health 1.19.4, zero sessions in project context, SSE connected.
> - `npm run test:editor`: VSCodium 1.143.17232 passes installed-VSIX activation,
>   view focus, unchanged tab groups/configuration with folder and empty window,
>   plus clean-profile install/uninstall/reinstall.
> - Same test passes in VS Code 1.145.2. All editor tests use new temporary user-data
>   and extension directories. The user's existing configuration/layout/extensions
>   were not modified by project code or test commands.
> - Editors emitted host-environment file watcher (EMFILE), GPU and built-in proposal
>   warnings; suites still passed. No machine/editor settings were changed to hide them.
> - Dependency installation audit: zero vulnerabilities after packager update and override.
> - Browser layout checks use simulated IDE theme tokens; they do not replace native
>   theme, docking, screen-reader or third-party coexistence testing.
> - Manual Secondary Side Bar movement, visual inspection in both native editors,
>   disable/re-enable and existing Codex/Claude coexistence remain unchecked in
>   `docs/verification.md`. Thus the full Phase 1 exit is not yet declared passed.
>
> ### Next milestone
>
> Finish the isolated manual Phase 1 checklist, then implement Phase 2 existing-server
> connection states and diagnostics behind the adapter boundary. Add state/event tests
> with that implementation and verify authenticated mode and bounded reconnect against
> an isolated real server. Do not proceed to conversations or managed server mode yet.
> ''';open(p,'w').write(s)
> PY``
>
> </details>
>
> Viewed 2 images
>
> <details><summary>Ran a command</summary>
>
> - Ran ``python3 - <<'PY'
p='README.md';s=open(p).read().replace('- `npm run probe`:', '- `npm run test:webview`: uses installed Chrome (`SIDECODE_CHROME` can override its path)\n  in a temporary headless profile; checks 12 simulated theme/width combinations,\n  bridge handshake and disabled controls, and saves screenshots under `/tmp`.\n- `npm run probe`:');open(p,'w').write(s)
p='PLAN.md';s=open(p).read().replace('- Browser layout checks use simulated IDE theme tokens;', '- `npm run test:webview`: 12 passing combinations (200/240/320 px; light, dark,\n  high contrast dark/light), bridge handshake, disabled controls and no overflow\n  or browser errors. Dark and high contrast light screenshots inspected.\n- Browser layout checks use simulated IDE theme tokens;');open(p,'w').write(s)
p='docs/discovery.md';s=open(p).read()+'''\n## Tooling verification\n\nThe SDK probe passes using the pinned package and requires ESM imports. The host\nremains bundled CommonJS. Unit tests, lint and packaging pass with the\n`minimatch@11.0.1` development override; npm reports zero vulnerabilities. This\noverride resolves the glob-matching advisory in lint/packaging dependencies and\nshould be reviewed when upstream packages update. No overridden package ships\nin the extension bundle. `playwright-core` uses installed Chrome for layout\nfixtures; `@vscode/test-electron` uses installed editors with temporary profiles.\n''';open(p,'w').write(s)
p='docs/verification.md';s=open(p).read()+'''\n## Automated results — 2026-11-12\n\nPassed on VSCodium 1.143.17232 and VS Code 1.145.2: packaged extension\nactivation and view focus, folder/empty window, unchanged configuration and tab\ngroups, isolated installation/uninstallation/reinstallation. These checks do not\ninspect native webview pixels.\n\nPassed in installed headless Chrome: 12 combinations of 200/240/320 px widths\nand simulated light/dark/high-contrast theme tokens; actual React bundle runs\nunder the generated CSP, mock host handshake works, placeholder controls are\ndisabled, no page overflow or browser errors. Dark and high contrast light\nscreenshots visually inspected. Native themes and manual docking remain open.\n\nAll test profiles were temporary. Host file-watcher/GPU/proposal warnings occurred\nin both editors but did not fail the suites.\n''';open(p,'w').write(s)
PY
npm run typecheck && npm run lint && npm run package``
>
> </details>
>
> All 12 browser layout cases pass, and I’ve inspected the dark and high-contrast-light screenshots. The shell fits narrow widths and clearly identifies itself as a disconnected preview.
>
> `PLAN.md` now records the completed implementation and test results. Its full exit gate remains open for native docking, accessibility, and coexistence checks with Codex/Claude; the automated tests don’t establish those.
>
> <details><summary>Ran a command</summary>
>
> - Ran `python3 - <<'PY'
p='docs/discovery.md';s=open(p).read().replace('the committed lockfile','the lockfile');open(p,'w').write(s)
PY
node --input-type=module -e 'import fs from "node:fs"; const p=JSON.parse(fs.readFileSync("package.json")); const l=JSON.parse(fs.readFileSync("package-lock.json")); if(JSON.stringify(p.dependencies)!==JSON.stringify(l.packages[""].dependencies)||JSON.stringify(p.devDependencies)!==JSON.stringify(l.packages[""].devDependencies))process.exit(1); console.log("Manifest and lockfile dependencies match")'`
>
> </details>

</details>

Implemented the Phase 1 shell in `git/sidecode`:

- Modular TypeScript host, React webview, validated message protocol, and reserved SDK adapter boundary.
- Dockable OpenCode view, themed responsive layout, placeholder conversation and composer.
- Build tooling, tests, documentation, and [installable VSIX](./git/sidecode/sidecode-0.1.0.vsix).
- Updated [PLAN.md](./git/sidecode/PLAN.md) with decisions and verification gaps.

Passed: typecheck, lint, four unit tests, 12 browser layout cases, packaging, and isolated VS Code/VSCodium activation and installation lifecycle tests. Dependency audit reports zero vulnerabilities.

Verified OpenCode 1.19.4 health, session listing, and SSE using its pinned SDK. The extension remains disconnected; no agent runtime was added.

**Phase 1’s full acceptance gate remains open:** native docking, accessibility, and Codex/Claude coexistence need manual verification. Authenticated server behavior also remains untested.

Your existing editor settings, extensions, and workspace layout were not modified. Next: finish the isolated manual checklist, then begin Phase 2 connection handling.

> proceed

<details><summary>12 previous messages</summary>

> I’ll continue with the remaining Phase 1 verification first, using isolated editor profiles. Then I’ll begin Phase 2’s server connection and diagnostics work, keeping it behind the adapter boundary.
>
> <details><summary>Ran 7 commands, searched the web</summary>
>
> - Ran `cat AGENTS.md SPEC.md PLAN.md`
> - Ran `cat package.json src/extension/activate.ts src/shared/protocol.ts src/webview/App.tsx scripts/test-editor.mjs scripts/probe.ts
cat tests/extension.test.ts tests/editor-suite.ts
cat node_modules/@opencode-ai/sdk/dist/v2/gen/core/serverSentEvents.gen.js`
> - Ran `cat > scripts/test-native.mjs <<'EOF'
import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = await mkdtemp(join(tmpdir(), 'sidecode-native-'));
await mkdir(join(root, 'extensions'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: process.env.SIDECODE_EDITOR_BINARY || '/usr/share/codium/codium', env,
  args: ['--user-data-dir', join(root, 'profile'), '--extensions-dir', join(root, 'extensions'), '--extensionDevelopmentPath=' + resolve('.'), '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry', '--disable-workspace-trust'], timeout: 30000 });
try {
  const page = await app.firstWindow();
  await page.locator('.monaco-workbench').waitFor();
  await page.keyboard.press('Control+Shift+P');
  await page.locator('.quick-input-widget input').fill('>OpenCode');
  console.log(await page.locator('.quick-input-widget').innerText());
  await page.screenshot({ path: join(root, 'commands.png') });
  console.log('Artifacts', root);
} finally { await app.close(); }
EOF`
> - Ran `node scripts/test-native.mjs`
> - Ran `rg -n 'EventServerConnected|EventServerHeartbeat' node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts
sed -n '1,45p' node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts
opencode --version
cat /home/curtis/.opencode/node_modules/opencode-ai/package.json 2>/dev/null | head -30`
>
> Searched the web for `https://opencode.ai/docs/server/`
>
> - Ran `python3 - <<'PY'
p='scripts/test-native.mjs';s=open(p).read().replace("  console.log(await page.locator('.quick-input-widget').innerText());", "  await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'OpenCode' }).first().waitFor({ timeout: 15000 });\n  console.log(await page.locator('.quick-input-widget').innerText());\n  await page.keyboard.press('Enter');\n  await page.locator('[id=\"sidecode.chat\"]').waitFor({ timeout: 15000 });\n  console.log('Frames', page.frames().map(frame => frame.url().split('?')[0]));\n  await page.keyboard.press('Control+Shift+P');\n  await page.locator('.quick-input-widget input').fill('>View: Move View');\n  await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Move View' }).first().waitFor();\n  await page.keyboard.press('Enter');\n  console.log('Move picker', await page.locator('.quick-input-widget').innerText());")
open(p,'w').write(s)
PY`
> - Ran `node scripts/test-native.mjs`
>
> </details>
>
> The native test can drive a disposable editor through its normal controls, so I’m checking docking there without touching your active workspace. For Phase 2, connection will be explicit: the host will check health, load the selected project’s sessions, then subscribe to events. Credentials will stay in SecretStorage, and diagnostics will use fixed error codes rather than raw server responses.
>
> <details><summary>Ran 8 commands, searched the web</summary>
>
> - Ran ``cat > src/shared/connection.ts <<'EOF'
>   export const phases = ['disconnected', 'health', 'sessions', 'events', 'connected', 'retrying', 'error'] as const;
>   export const errorMessages = {
>   invalidUrl: 'Enter an HTTP(S) server URL without credentials, query parameters or fragments.',
>   authRequired: 'Server authentication failed. Set the server credentials and reconnect.',
>   insecureAuth: 'Use HTTPS for authenticated servers outside loopback.',
>   incompatible: 'Unexpected API response. Check the URL points to an OpenCode server.',
>   unavailable: 'Cannot reach the server. Check its address and whether it is running.',
>   timeout: 'The server stopped responding. Check the server and reconnect.',
>   serverError: 'The server reported an error. Check the server and retry.',
>   streamClosed: 'The event stream closed. Reconnect to resume updates.',
>   untrusted: 'Trust this workspace before connecting to its OpenCode project.',
>   credentials: 'Could not read or save credentials. Check the editor secret storage.',
>   context: 'Select a local or remote filesystem folder for the OpenCode project.',
>   } as const;
>   export type ErrorCode = keyof typeof errorMessages;
>   export type ConnectionState = {
>   phase: typeof phases[number];
>   attempt: number;
>   error: ErrorCode | null;
>   };
>   export const disconnected: ConnectionState = { phase: 'disconnected', attempt: 0, error: null };
>   EOF
>   cat > src/shared/protocol.ts <<'EOF'
>   import { errorMessages, phases, type ConnectionState } from './connection';
>   export const actions = ['ready', 'connect', 'disconnect', 'configure', 'credentials', 'clearCredentials', 'diagnostics'] as const;
>   export type WebviewMessage = { version: 1; type: typeof actions[number] };
>   export type HostMessage = { version: 1; type: 'connection'; state: ConnectionState };
>
> function hasExactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
> return typeof value === 'object' && value !== null && !Array.isArray(value)
> && Object.keys(value).length === keys.length
> && keys.every((key) => Object.hasOwn(value, key));
> }
> export function isWebviewMessage(value: unknown): value is WebviewMessage {
> return hasExactKeys(value, ['version', 'type']) && value.version === 1 && actions.some((action) => action === value.type);
> }
> export function isHostMessage(value: unknown): value is HostMessage {
> if (!hasExactKeys(value, ['version', 'type', 'state']) || value.version !== 1 || value.type !== 'connection') return false;
> const state = value.state;
> return hasExactKeys(state, ['phase', 'attempt', 'error']) && phases.some((phase) => phase === state.phase)
> && typeof state.attempt === 'number' && Number.isInteger(state.attempt) && state.attempt >= 0 && state.attempt <= 3
> && (state.error === null || (typeof state.error === 'string' && Object.hasOwn(errorMessages, state.error)));
> }
> EOF
> cat > src/adapter/errors.ts <<'EOF'
> import type { ErrorCode } from '../shared/connection';
> export class ConnectionError extends Error {
> constructor(readonly code: ErrorCode) { super(code); }
> }
> export function errorCode(error: unknown): ErrorCode {
> return error instanceof ConnectionError ? error.code : 'unavailable';
> }
> export function normalizeUrl(value: string): string {
> try {
> const url = new URL(value);
> if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
> return url.toString().replace(/\/+$/, '');
> } catch { throw new ConnectionError('invalidUrl'); }
> }
> export function assertSafeAuth(baseUrl: string): void {
> const url = new URL(baseUrl);
> if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new ConnectionError('insecureAuth');
> }
> EOF
> cat > src/adapter/transport.ts <<'EOF'
> import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
> import { ConnectionError, assertSafeAuth, normalizeUrl } from './errors';
>
> export interface Credentials { username: string; password: string }
> export interface ConnectionOptions { baseUrl: string; directory: string; credentials?: Credentials }
> export interface Transport {
> health(signal: AbortSignal): Promise<void>;
> sessions(signal: AbortSignal): Promise<void>;
> events(signal: AbortSignal): AsyncIterable<unknown>;
> }
> export function validEvent(value: unknown): value is { type: string; properties: Record<string, unknown> } {
> if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
> const event = value as Record<string, unknown>;
> return typeof event.type === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(event.type)
>     && typeof event.properties === 'object' && event.properties !== null && !Array.isArray(event.properties);
> }
> /** Only client-side SDK code; never starts a server. */
> export function createTransport(options: ConnectionOptions, fetcher: typeof fetch = fetch): Transport {
>   const baseUrl = normalizeUrl(options.baseUrl);
>   const headers: Record<string, string> = {};
>   if (options.credentials) {
>     assertSafeAuth(baseUrl);
>     headers.Authorization = `Basic ${Buffer.from(`${options.credentials.username}:${options.credentials.password}`).toString('base64')}`;
>   }
>   const checkedFetch: typeof fetch = async (input, init) => {
>     const request = new Request(input, init);
>     let response: Response;
>     try { response = await fetcher(request, { redirect: 'error' }); }
>     catch { throw new ConnectionError('unavailable'); }
>     let code: 'authRequired' | 'serverError' | 'incompatible' | undefined;
>     if (response.status === 401 || response.status === 403) code = 'authRequired';
>     else if (response.status >= 500 || response.status === 429) code = 'serverError';
>     else if (!response.ok) code = 'incompatible';
>     const expected = new URL(request.url).pathname.endsWith('/event') ? 'text/event-stream' : 'application/json';
>     if (!code && response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== expected) code = 'incompatible';
>     if (code) { await response.body?.cancel(); throw new ConnectionError(code); }
>     return response;
>   };
>   const client = createOpencodeClient({ baseUrl, directory: options.directory, headers, fetch: checkedFetch, throwOnError: true });
>   return {
>     async health(signal) {
>       const { data } = await client.global.health({ signal });
>       if (data?.healthy !== true || typeof data.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(data.version)) throw new ConnectionError('incompatible');
> },
> async sessions(signal) {
> const { data } = await client.session.list({ directory: options.directory }, { signal });
> // Phase 2 does not expose session data. Phase 3 will validate every field it consumes.
> if (!Array.isArray(data) || data.some((session) => typeof session !== 'object' || !session || typeof session.id !== 'string')) throw new ConnectionError('incompatible');
> },
> async \*events(signal) {
> let failure: unknown;
> const result = await client.event.subscribe({ directory: options.directory }, {
> signal, sseMaxRetryAttempts: 1, onSseError: (error) => { failure = error; },
> });
> try {
> for await (const event of result.stream) {
> if (!validEvent(event)) throw new ConnectionError('incompatible');
> yield event;
> }
> if (failure) throw failure;
> } finally { await result.stream.return(); }
> },
> };
> }
> EOF
> cat > src/adapter/connection.ts <<'EOF'
> import { disconnected, type ConnectionState } from '../shared/connection';
> import { ConnectionError, errorCode } from './errors';
> import { validEvent, type Transport } from './transport';
>
> export interface Timing { requestMs: number; idleMs: number; backoffMs: number; stableMs: number }
> const defaults: Timing = { requestMs: 10000, idleMs: 45000, backoffMs: 500, stableMs: 60000 };
> const transient = new Set(['unavailable', 'timeout', 'serverError', 'streamClosed']);
> function delay(ms: number, signal: AbortSignal): Promise<void> {
> return new Promise((resolve) => {
> const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
> const timer = setTimeout(finish, ms);
> signal.addEventListener('abort', finish, { once: true });
> if (signal.aborted) finish();
> });
> }
> /** One owner for retries and cancellation. SDK retries are disabled in the transport. _/
> export class Connection {
> state: ConnectionState = { ...disconnected };
> private controller: AbortController | undefined;
> private listeners = new Set<(state: ConnectionState) => void>();
> constructor(private timing: Timing = defaults) {}
> subscribe(listener: (state: ConnectionState) => void): () => void {
> this.listeners.add(listener); return () => this.listeners.delete(listener);
> }
> private publish(state: ConnectionState): void {
> this.state = state;
> for (const listener of this.listeners) listener(state);
> }
> fail(code: ConnectionState['error']): void {
> this.disconnect(); this.publish({ phase: 'error', attempt: 0, error: code });
> }
> disconnect(): void {
> this.controller?.abort(); this.controller = undefined;
> this.publish({ ...disconnected });
> }
> dispose(): void { this.disconnect(); this.listeners.clear(); }
> async connect(transport: Transport): Promise<void> {
> this.controller?.abort();
> const owner = new AbortController(); this.controller = owner;
> const current = () => this.controller === owner && !owner.signal.aborted;
> let retries = 0;
> while (current()) {
> const attempt = new AbortController();
> const cancel = () => attempt.abort();
> owner.signal.addEventListener('abort', cancel, { once: true });
> let timeout = false;
> let timer: ReturnType<typeof setTimeout> | undefined;
> const arm = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => { timeout = true; attempt.abort(); }, ms); };
> const update = (phase: ConnectionState['phase'], error: ConnectionState['error'] = null) => {
> if (current()) this.publish({ phase, attempt: retries, error });
> };
> let connectedAt: number | undefined;
> try {
> update('health'); arm(this.timing.requestMs); await transport.health(attempt.signal);
> if (!current()) return;
> update('sessions'); arm(this.timing.requestMs); await transport.sessions(attempt.signal);
> if (!current()) return;
> update('events'); arm(this.timing.requestMs);
> for await (const event of transport.events(attempt.signal)) {
> if (!current()) return;
> if (timeout) throw new ConnectionError('timeout');
> if (!validEvent(event)) throw new ConnectionError('incompatible');
> if (event.type === 'server.connected') {
> connectedAt ??= Date.now(); update('connected');
> }
> if (connectedAt !== undefined) arm(this.timing.idleMs);
> // Other events stay in the adapter. No tool actions or approvals in Phase 2.
> }
> throw new ConnectionError('streamClosed');
> } catch (error) {
> if (!current()) return;
> const code = timeout ? 'timeout' : errorCode(error);
> if (connectedAt !== undefined && Date.now() - connectedAt >= this.timing.stableMs) retries = 0;
> if (!transient.has(code) || retries >= 3) { update('error', code); return; }
> retries++; update('retrying', code);
> } finally {
> clearTimeout(timer); attempt.abort(); owner.signal.removeEventListener('abort', cancel);
> }
> await delay(this.timing.backoffMs _ 2 ** (retries - 1), owner.signal);
> }
> }
> }
> EOF``
>
> - Ran `python3 - <<'PY'
p='scripts/test-native.mjs';s=open(p).read().replace("  await page.locator('[id=\"sidecode.chat\"]').waitFor({ timeout: 15000 });", "  await page.locator('.quick-input-widget').waitFor({ state: 'hidden' });\n  console.log('Sidebar', await page.locator('.part.sidebar').innerText());\n  await page.screenshot({ path: join(root, 'view.png') });")
open(p,'w').write(s)
PY`
> - Ran `node scripts/test-native.mjs`
> - Ran `cat node_modules/@opencode-ai/sdk/dist/error-interceptor.js
sed -n '6060,6085p' node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts
cat node_modules/@opencode-ai/sdk/dist/v2/gen/client/client.gen.js | head -180
opencode serve --help`
> - Ran ``cat > src/extension/controller.ts <<'EOF'
>   import { createHash } from 'node:crypto';
>   import \* as vscode from 'vscode';
>   import { Connection } from '../adapter/connection';
>   import { createTransport, type Credentials } from '../adapter/transport';
>   import { assertSafeAuth, errorCode, normalizeUrl } from '../adapter/errors';
>   import { errorMessages } from '../shared/connection';
>   import type { WebviewMessage } from '../shared/protocol';
>
> export class Controller implements vscode.Disposable {
> readonly connection = new Connection();
> private output = vscode.window.createOutputChannel('OpenCode Connection');
> private epoch = 0;
> private dialog = false;
> private subscriptions: vscode.Disposable[];
> constructor(private context: vscode.ExtensionContext) {
> const stop = this.connection.subscribe((state) => {
> // Only locally defined enumerations/numbers: never format an SDK error or payload.
> this.output.appendLine(`phase=${state.phase} retry=${state.attempt} code=${state.error ?? 'none'}`);
> });
> this.subscriptions = [
> > { dispose: stop },
> > vscode.workspace.onDidChangeConfiguration((event) => { if (event.affectsConfiguration('sidecode.serverUrl')) this.disconnect(); }),
> > vscode.workspace.onDidChangeWorkspaceFolders(() => this.disconnect()),
> > ];
> }
> private url(): string { return normalizeUrl(vscode.workspace.getConfiguration('sidecode').get<string>('serverUrl', 'http://127.0.0.1:4096')); }
> private key(url: string): string { return `server-auth:${createHash('sha256').update(url).digest('hex')}`; }
> private disconnect(): void { this.epoch++; this.connection.disconnect(); }
> async action(type: WebviewMessage['type']): Promise<void> {
> if (type === 'ready') return;
> if (type === 'disconnect') { this.disconnect(); return; }
> if (type === 'diagnostics') { this.output.show(true); return; }
> if (this.dialog) return;
> this.dialog = true;
> try {
> if (type === 'configure') {
> const value = await vscode.window.showInputBox({ title: 'OpenCode server URL', value: this.url(), ignoreFocusOut: true,
> validateInput: (value) => { try { normalizeUrl(value); return null; } catch { return errorMessages.invalidUrl; } } });
> if (value !== undefined) await vscode.workspace.getConfiguration('sidecode').update('serverUrl', normalizeUrl(value), vscode.ConfigurationTarget.Global);
> return;
> }
> const url = this.url();
> if (type === 'clearCredentials') { this.disconnect(); await this.context.secrets.delete(this.key(url)); return; }
> if (type === 'credentials') {
> assertSafeAuth(url);
> const username = await vscode.window.showInputBox({ title: 'OpenCode server username', value: 'opencode', ignoreFocusOut: true,
> validateInput: (value) => value && !/[:\r\n]/.test(value) ? null : 'Enter a username without colons or line breaks.' });
> if (username === undefined) return;
> const password = await vscode.window.showInputBox({ title: 'OpenCode server password', password: true, ignoreFocusOut: true,
> validateInput: (value) => value ? null : 'Enter the server password.' });
> if (password === undefined) return;
> this.disconnect();
> await this.context.secrets.store(this.key(url), JSON.stringify({ username, password }));
> return;
> }
> if (!vscode.workspace.isTrusted) { this.connection.fail('untrusted'); return; }
> this.disconnect();
> const epoch = this.epoch;
> const folders = vscode.workspace.workspaceFolders ?? [];
> let uri: vscode.Uri | undefined;
> if (folders.length === 1) uri = folders[0]!.uri;
> else if (folders.length > 1) uri = (await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Choose the OpenCode project folder' }))?.uri;
> else uri = (await vscode.window.showOpenDialog({ title: 'Choose the OpenCode project folder', canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Use project folder' }))?.[0];
> if (epoch !== this.epoch || !uri) return;
> if (!['file', 'vscode-remote'].includes(uri.scheme)) { this.connection.fail('context'); return; }
> let credentials: Credentials | undefined;
> try {
> const saved = await this.context.secrets.get(this.key(url));
> if (saved) {
> const value: unknown = JSON.parse(saved);
> if (!value || typeof value !== 'object' || !('username' in value) || !('password' in value)
> || typeof value.username !== 'string' || typeof value.password !== 'string' || /[:\r\n]/.test(value.username)) throw new Error();
> credentials = { username: value.username, password: [REDACTED_SECRET] };
> }
> } catch { this.connection.fail('credentials'); return; }
> if (epoch !== this.epoch) return;
> const transport = createTransport({ baseUrl: url, directory: uri.fsPath, ...(credentials ? { credentials } : {}) });
> void this.connection.connect(transport);
> } catch (error) {
> this.connection.fail(type === 'credentials' || type === 'clearCredentials' ? 'credentials' : errorCode(error));
> } finally { this.dialog = false; }
> }
> dispose(): void { this.epoch++; this.connection.dispose(); this.subscriptions.forEach((item) => item.dispose()); this.output.dispose(); }
> }
> EOF
> cat > src/extension/activate.ts <<'EOF'
> import { randomBytes } from 'node:crypto';
> import \* as vscode from 'vscode';
> import { actions, isWebviewMessage, type HostMessage } from '../shared/protocol';
> import { webviewHtml } from './html';
> import { Controller } from './controller';
>
> export function activate(context: vscode.ExtensionContext): void {
> const controller = new Controller(context);
> context.subscriptions.push(controller);
> for (const action of actions.filter((action) => action !== 'ready')) {
> context.subscriptions.push(vscode.commands.registerCommand(`sidecode.${action}`, () => controller.action(action)));
> }
> context.subscriptions.push(vscode.window.registerWebviewViewProvider('sidecode.chat', {
> resolveWebviewView(view) {
> const resources = vscode.Uri.joinPath(context.extensionUri, 'dist');
> view.webview.options = { enableScripts: true, localResourceRoots: [resources] };
> const send = () => {
> const message: HostMessage = { version: 1, type: 'connection', state: controller.connection.state };
> void view.webview.postMessage(message).then(undefined, () => { /_ View closed during delivery. _/ });
> };
> const unsubscribe = controller.connection.subscribe(send);
> const listener = view.webview.onDidReceiveMessage((message: unknown) => {
> if (!isWebviewMessage(message)) return;
> if (message.type === 'ready') send();
> else void controller.action(message.type);
> });
> const disposal = view.onDidDispose(() => { unsubscribe(); listener.dispose(); disposal.dispose(); });
> context.subscriptions.push({ dispose: unsubscribe }, listener, disposal);
> view.webview.html = webviewHtml({
> script: view.webview.asWebviewUri(vscode.Uri.joinPath(resources, 'webview.js')).toString(),
> style: view.webview.asWebviewUri(vscode.Uri.joinPath(resources, 'webview.css')).toString(),
> source: view.webview.cspSource,
> nonce: randomBytes(24).toString('base64'),
> });
> },
> }));
> }
> EOF
> python3 - <<'PY'
> p='src/webview/App.tsx';s=open(p).read().replace("import { isHostMessage, type WebviewMessage } from '../shared/protocol';", "import { isHostMessage, type WebviewMessage } from '../shared/protocol';\nimport { disconnected, errorMessages, type ConnectionState } from '../shared/connection';")
> s=s.replace(' const [ready, setReady] = useState(false);', " const [state, setState] = useState<ConnectionState>(disconnected);\n const labels = { disconnected: 'Not connected', health: 'Checking server health…', sessions: 'Loading project sessions…', events: 'Subscribing to events…', connected: 'Connected', retrying: `Reconnecting (${state.attempt}/3)…`, error: 'Connection failed' };\n const active = !['disconnected', 'error'].includes(state.phase);\n const action = (type: WebviewMessage['type']) => bridge.postMessage({ version: 1, type });")
> s=s.replace('setReady(true)', 'setState(event.data.state)')
> s=s.replace("{ready ? 'Not connected' : 'Initializing view…'}", "{labels[state.phase]}")
> s=s.replace(' </header>', ''' <div className="connection-actions">
> <button onClick={() => action(active ? 'disconnect' : 'connect')}>{active ? 'Disconnect' : 'Connect'}</button>
> <button onClick={() => action('configure')}>Server URL</button>
> <details><summary>Connection options</summary><div className="connection-actions">
> <button onClick={() => action('credentials')}>Set credentials</button>
> <button onClick={() => action('clearCredentials')}>Clear credentials</button>
> <button onClick={() => action('diagnostics')}>Diagnostics</button>
> </div></details>
> </div>
> {state.error && <p className="connection-error" role="alert">{errorMessages[state.error]}</p>}
> </header>''')
> s=s.replace('Your conversations will appear here when server connections are available.', 'Connect to your OpenCode server to check its health and receive project events.')
> s=s.replace('Phase 1 preview · Interface only', 'Connection preview · Chat is not available yet')
> s=s.replace('Connect a server to start a conversation', 'Conversations arrive in Phase 3')
> s=s.replace('Connection support is coming in Phase 2.', 'Session and message controls are coming in Phase 3.')
> open(p,'w').write(s)
> p='src/webview/style.css';s=open(p).read()+'''\n.connection-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }\n.connection-actions details { width: 100%; }\nsummary { cursor: pointer; padding: 4px 0; }\nbutton:not(:disabled), summary { cursor: pointer; }\nbutton:not(:disabled):hover { background: var(--vscode-button-secondaryHoverBackground); }\n.connection-error { color: var(--vscode-errorForeground); overflow-wrap: anywhere; margin-bottom: 0; }\n''';open(p,'w').write(s)
> import json
> p='package.json';d=json.load(open(p));d['description']='A sidebar client for an existing OpenCode server.'
> d['dependencies']['@opencode-ai/sdk']=d['devDependencies'].pop('@opencode-ai/sdk')
> d['contributes']['configuration']={'title':'OpenCode','properties':{'sidecode.serverUrl':{'type':'string','default':'http://127.0.0.1:4096','scope':'machine','description':'Existing OpenCode HTTP(S) server URL. Credentials are stored separately. Connections start only when you choose Connect.'}}}
> d['contributes']['commands']=[{'command':'sidecode.'+k,'title':'OpenCode: '+v} for k,v in [('connect','Connect'),('disconnect','Disconnect'),('configure','Set Server URL'),('credentials','Set Server Credentials'),('clearCredentials','Clear Server Credentials'),('diagnostics','Show Connection Diagnostics')]]
> d['capabilities']['untrustedWorkspaces']={'supported':'limited','description':'The view is available; server connections require a trusted workspace.'}
> d['capabilities']['virtualWorkspaces']={'supported':False,'description':'Project connections require a filesystem directory.'}
> open(p,'w').write(json.dumps(d,indent=2)+'\n')
> PY
> npm run typecheck``
>
> - Ran `python3 - <<'PY'
p='scripts/test-native.mjs';s=open(p).read();start=s.index("  await page.keyboard.press('Control+Shift+P');");end=s.index("  await page.screenshot({ path: join(root, 'commands.png') });",start)
s=s[:start]+'''  const picker = page.locator('.quick-input-widget');
  async function command(label) {
    await page.keyboard.press('Control+Shift+P');
    await picker.locator('input').fill('>' + label);
    await picker.getByText(label, { exact: true }).click();
  }
  await command('OpenCode: Focus on OpenCode View');
  await picker.waitFor({ state: 'hidden' });
  await page.screenshot({ path: join(root, 'view.png') });
  await command('View: Move View');
  await picker.getByText('OpenCode', { exact: true }).click();
  console.log('Destinations', await picker.locator('.monaco-list-row').allTextContents());
'''+s[end:];open(p,'w').write(s)
PY
npm run build`
> - Ran `node scripts/test-native.mjs`
>
> Searched the web for `https://raw.githubusercontent.com/anomalyco/opencode/v1.19.4/packages/opencode/src/config/config.ts`
>
> - Ran `python3 - <<'PY'
p='src/extension/controller.ts';s=open(p).read().replace("import { assertSafeAuth, errorCode, normalizeUrl }", "import { assertSafeAuth, ConnectionError, errorCode, normalizeUrl }")
s=s.replace("title: 'OpenCode server URL', value: this.url()", "title: 'OpenCode server URL', value: vscode.workspace.getConfiguration('sidecode').get<string>('serverUrl', 'http://127.0.0.1:4096')")
s=s.replace("this.connection.fail(type === 'credentials' || type === 'clearCredentials' ? 'credentials' : errorCode(error));", "this.connection.fail(error instanceof ConnectionError ? error.code : type === 'credentials' || type === 'clearCredentials' ? 'credentials' : errorCode(error));")
open(p,'w').write(s)
p='src/adapter/errors.ts';s=open(p).read().replace("return error instanceof ConnectionError ? error.code : 'unavailable';", "return error instanceof ConnectionError ? error.code : error instanceof SyntaxError ? 'incompatible' : 'unavailable';");open(p,'w').write(s)
p='scripts/test-webview.ts';s=open(p).read().replace("{ version: 1, type: 'shell', connection: 'disconnected' }", "{ version: 1, type: 'connection', state: { phase: 'disconnected', attempt: 0, error: null } }");open(p,'w').write(s)
PY
npm install --package-lock-only --ignore-scripts --offline --cache /tmp/sidecode-npm-cache`
>
> </details>
>
> Viewed an image
>
> <details><summary>Ran 6 commands, searched the web</summary>
>
> - Ran `python3 - <<'PY'
p='scripts/test-native.mjs';s=open(p).read().replace("  console.log('Destinations', await picker.locator('.monaco-list-row').allTextContents());", "  await picker.getByText('New Secondary Side Bar Entry', { exact: true }).click();\n  await picker.waitFor({ state: 'hidden' });\n  await page.locator('.part.auxiliarybar').getByText('OpenCode', { exact: false }).first().waitFor();\n  let content;\n  for (let count = 0; count < 60; count++) {\n    content = page.frames().find(frame => frame.url().includes('/index.html') === false && frame.url().startsWith('vscode-webview:') && frame.url().includes('fake.html') === false);\n    if (content && await content.getByRole('main', { name: 'OpenCode chat' }).count()) break;\n    for (const frame of page.frames()) if (await frame.getByRole('main', { name: 'OpenCode chat' }).count()) content = frame;\n    if (content && await content.getByRole('main', { name: 'OpenCode chat' }).count()) break;\n    await new Promise(resolve => setTimeout(resolve, 100));\n  }\n  if (!content) throw new Error('No rendered OpenCode webview');\n  await content.getByRole('status').filter({ hasText: 'Not connected' }).waitFor();\n  await content.getByRole('button', { name: 'Connect', exact: true }).focus();\n  if (!await content.getByRole('button', { name: 'Connect', exact: true }).evaluate(el => el === document.activeElement)) throw new Error('Button not focusable');\n  console.log('PASS: native React content, keyboard focus and movement to Secondary Side Bar');")
open(p,'w').write(s)
PY`
> - Ran `node scripts/test-native.mjs`
> - Ran `python3 - <<'PY'
>   p='tests/protocol.test.ts';s=open(p).read().replace("{ version: 1, type: 'shell', connection: 'disconnected' }", "{ version: 1, type: 'connection', state: { phase: 'disconnected', attempt: 0, error: null } }");open(p,'w').write(s)
>   p='tests/extension.test.ts';s=open(p).read().replace("import { randomBytes }", "import { createHash, randomBytes }")
>   s=s.replace("window: { registerWebviewViewProvider:", "window: { createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, dispose: () => {} }), registerWebviewViewProvider:")
>   s=s.replace(" Uri: {", " commands: { registerCommand: () => subscription },\n workspace: { onDidChangeConfiguration: () => subscription, onDidChangeWorkspaceFolders: () => subscription },\n Uri: {")
>   s=s.replace("{ randomBytes }", "{ randomBytes, createHash }")
>   s=s.replace(" assert.equal(subscriptions.length, 1);", " assert.ok(subscriptions.length > 1);")
>   s=s.replace("'[{\"version\":1,\"type\":\"shell\",\"connection\":\"disconnected\"}]'", "'[{\"version\":1,\"type\":\"connection\",\"state\":{\"phase\":\"disconnected\",\"attempt\":0,\"error\":null}}]'")
>   s=s.replace("['views', 'viewsContainers']", "['commands', 'configuration', 'views', 'viewsContainers']")
>   s=s.replace("manifest contributes only its own sidebar and has no layout or settings contributions", "manifest contributes only namespaced commands/configuration and its own sidebar")
>   s=s.replace(" assert.equal(manifest.contributes.views.sidecode", " assert.deepEqual(Object.keys(manifest.contributes.configuration.properties), ['sidecode.serverUrl']);\n assert.equal(manifest.contributes.configuration.properties['sidecode.serverUrl'].scope, 'machine');\n assert.equal(manifest.contributes.views.sidecode",1)
>   open(p,'w').write(s)
>   PY
>   cat > tests/connection.test.ts <<'EOF'
>   import assert from 'node:assert/strict';
>   import test from 'node:test';
>   import { Connection, type Timing } from '../src/adapter/connection';
>   import { ConnectionError, normalizeUrl, assertSafeAuth } from '../src/adapter/errors';
>   import { createTransport, validEvent, type Transport } from '../src/adapter/transport';
>   import type { ConnectionState } from '../src/shared/connection';
>   const timing: Timing = { requestMs: 30, idleMs: 30, backoffMs: 1, stableMs: 10000 };
>   const waitAbort = (signal: AbortSignal) => new Promise<void>((resolve) => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); });
>   const connected = { type: 'server.connected', properties: {} };
>   const transport = (events: Transport['events']): Transport => ({ health: async () => {}, sessions: async () => {}, events });
>
> test('explicit stages, connection event and clean disconnect', async () => {
> const connection = new Connection(timing);
> const states: ConnectionState[] = [];
> connection.subscribe((state) => { states.push(state); if (state.phase === 'connected') connection.disconnect(); });
> await connection.connect(transport(async function* (signal) { yield connected; await waitAbort(signal); }));
> assert.deepEqual(states.map(s => s.phase), ['health', 'sessions', 'events', 'connected', 'disconnected']);
> });
> test('EOF retries are bounded even when every attempt briefly connects', async () => {
> const connection = new Connection(timing);
> let calls = 0;
> const states: ConnectionState[] = [];
> connection.subscribe(state => states.push(state));
> await connection.connect(transport(async function* () { calls++; yield connected; }));
> assert.equal(calls, 4);
> assert.deepEqual(states.filter(s => s.phase === 'retrying').map(s => s.attempt), [1, 2, 3]);
> assert.equal(connection.state.error, 'streamClosed');
> });
> test('health timeout and event silence are recoverable but bounded', async () => {
> for (const source of [
> > { health: waitAbort, sessions: async () => {}, events: async function* () {} },
> > transport(async function* (signal) { yield connected; await waitAbort(signal); }),
> > ]) {
> const connection = new Connection(timing);
> await connection.connect(source);
> assert.equal(connection.state.phase, 'error');
> assert.equal(connection.state.error, 'timeout');
> }
> });
> test('auth failures do not retry and diagnostics contain no exception content', async () => {
> const connection = new Connection(timing);
> let calls = 0;
> await connection.connect({ ...transport(async function* () {}), health: async () => { calls++; throw new ConnectionError('authRequired'); } });
> assert.equal(calls, 1); assert.equal(connection.state.error, 'authRequired');
> await connection.connect({ ...transport(async function* () {}), health: async () => { throw new Error('TOKEN /private/path prompt contents'); } });
> assert.doesNotMatch(JSON.stringify(connection.state), /TOKEN|private|contents/);
> });
> test('disconnect during retry cancels pending work', async () => {
> const connection = new Connection(timing);
> let calls = 0;
> connection.subscribe(state => { if (state.phase === 'retrying') connection.disconnect(); });
> await connection.connect({ ...transport(async function* () {}), health: async () => { calls++; throw new Error(); } });
> assert.equal(calls, 1); assert.equal(connection.state.phase, 'disconnected');
> });
> test('replaced connections cannot publish stale results', async () => {
> const connection = new Connection(timing);
> let release!: () => void;
> const old = connection.connect({ ...transport(async function* () { yield connected; }), health: () => new Promise<void>(resolve => { release = resolve; }) });
> const next = connection.connect({ ...transport(async function* () {}), health: async () => { throw new ConnectionError('authRequired'); } });
> await next; release(); await old;
> assert.equal(connection.state.error, 'authRequired');
> });
> test('event shapes are validated without trusting arbitrary payloads', async () => {
> assert.equal(validEvent(connected), true);
> for (const value of [null, [], 'data', {}, { type: 'server.connected' }, { type: '<script>', properties: {} }, { type: 'x', properties: [] }]) assert.equal(validEvent(value), false);
> const connection = new Connection(timing);
> await connection.connect(transport(async function* () { yield 'malformed'; }));
> assert.equal(connection.state.error, 'incompatible');
> });
> test('URL validation and endpoint-specific credential transport policy', () => {
> assert.equal(normalizeUrl('http://127.0.0.1:4096/'), 'http://127.0.0.1:4096');
> for (const value of ['file:///tmp', 'https://u:p@host', 'http://host/?token=x', 'http://host/#x', 'broken']) assert.throws(() => normalizeUrl(value));
> assertSafeAuth('http://127.0.0.1:4096'); assertSafeAuth('https://example.com');
> assert.throws(() => assertSafeAuth('http://example.com'));
> });
> test('SDK checks status and content type for JSON and SSE, without accepting the HTML root', async () => {
> for (const [status, contentType, code] of [[200, 'text/html', 'incompatible'], [401, 'text/html', 'authRequired'], [500, 'text/plain', 'serverError']] as const) {
> const client = createTransport({ baseUrl: 'http://localhost:4096', directory: '/test' }, async () => new Response('secret response', { status, headers: { 'content-type': contentType } }));
> await assert.rejects(client.health(new AbortController().signal), (error: unknown) => error instanceof ConnectionError && error.code === code);
> await assert.rejects(async () => { for await (const event of client.events(new AbortController().signal)) void event; }, (error: unknown) => error instanceof ConnectionError && error.code === code);
> }
> });
> test('SDK uses documented routes and directory, and Basic auth only in host requests', async () => {
> const requests: Request[] = [];
> const client = createTransport({ baseUrl: 'http://127.0.0.1:4096', directory: '/project with spaces', credentials: { username: 'opencode', password: 'test' } }, async input => {
> const request = new Request(input); requests.push(request);
> const path = new URL(request.url).pathname;
> return new Response(JSON.stringify(path === '/global/health' ? { healthy: true, version: '1.19.4' } : []), { headers: { 'content-type': 'application/json; charset=utf-8' } });
> });
> const signal = new AbortController().signal;
> await client.health(signal); await client.sessions(signal);
> assert.deepEqual(requests.map(request => new URL(request.url).pathname), ['/global/health', '/session']);
> assert.equal(new URL(requests[1]!.url).searchParams.get('directory'), '/project with spaces');
> assert.match(requests[0]!.headers.get('authorization')!, /^Basic /);
> });
> EOF
> npm run check`
>
> Searched the web for `https://raw.githubusercontent.com/anomalyco/opencode/v1.19.4/packages/core/src/flag/flag.ts`
>
> Searched the web for `https://raw.githubusercontent.com/anomalyco/opencode/v1.19.4/packages/core/src/global/index.ts`
>
> - Ran `python3 - <<'PY'
p='scripts/test-native.mjs';s=open(p).read().replace("import { _electron", "import { setTimeout } from 'node:timers';\nimport { _electron").replace('el === document.activeElement','el === el.ownerDocument.activeElement');open(p,'w').write(s)
p='src/adapter/connection.ts';s=open(p).read().replace("        if (!current()) return;\n        update('sessions')", "        if (!current()) return;\n        if (timeout) throw new ConnectionError('timeout');\n        update('sessions')").replace("        if (!current()) return;\n        update('events')", "        if (!current()) return;\n        if (timeout) throw new ConnectionError('timeout');\n        update('events')");open(p,'w').write(s)
PY`
> - Ran `npm run check`
> - Ran `SIDECODE_EDITOR_BINARY=/usr/share/code/code node scripts/test-native.mjs`
>
> </details>
>
> Native rendering and movement to the Secondary Side Bar now pass in VSCodium’s test profile; the VS Code check is running. The Phase 2 connection code is in place with separate health, session-loading, and event states, cancellation, and up to three retries.
>
> Next I’m testing timeout and authentication failures, then recovery against an isolated real OpenCode server. I won’t restart or reconfigure your existing server.
>
> <details><summary>Ran 4 commands, searched the web</summary>
>
> Searched the web for `https://raw.githubusercontent.com/anomalyco/opencode/v1.19.4/packages/core/src/global.ts`
>
> - Ran ``cat > scripts/test-server.ts <<'EOF'
>   /\*_ Launches ONLY an isolated test server. Never imported by extension runtime. _/
>   import assert from 'node:assert/strict';
>   import { spawn, type ChildProcess } from 'node:child_process';
>   import { randomBytes } from 'node:crypto';
>   import { mkdtemp, mkdir } from 'node:fs/promises';
>   import { tmpdir } from 'node:os';
>   import { join } from 'node:path';
>   import { createServer } from 'node:net';
>   import { once } from 'node:events';
>   import { setTimeout as pause } from 'node:timers/promises';
>   import { Connection } from '../src/adapter/connection';
>   import { createTransport } from '../src/adapter/transport';
>   import type { ConnectionState } from '../src/shared/connection';
>
> const root = await mkdtemp(join(tmpdir(), 'sidecode-server-'));
> const project = join(root, 'project'); await mkdir(project);
> const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
> const address = socket.address(); if (!address || typeof address === 'string') throw new Error('No test port');
> const port = address.port; await new Promise<void>(resolve => socket.close(() => resolve()));
> const baseUrl = `http://127.0.0.1:${port}`;
> const password = [REDACTED_SECRET]'hex');
> // Allowlist process environment; no inherited model keys, plugins, telemetry or config overrides.
> const env = {
> PATH: process.env.PATH, HOME: process.env.HOME,
> XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'),
> XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), TMPDIR: join(root, 'tmp'),
> OPENCODE_TEST_HOME: root, OPENCODE_CONFIG_DIR: join(root, 'config'), OPENCODE_CONFIG_CONTENT: '{}',
> OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_AUTOUPDATE: '1',
> OPENCODE_SERVER_USERNAME: 'sidecode-test', OPENCODE_SERVER_PASSWORD: password,
> };
> await mkdir(env.TMPDIR);
> const headers = { Authorization: `Basic ${Buffer.from(`sidecode-test:${password}`).toString('base64')}` };
> let server: ChildProcess | undefined;
> async function start() {
>   server = spawn(process.env.SIDECODE_OPENCODE || 'opencode', ['serve', '--pure', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: project, env, stdio: 'ignore' });
>   let launchFailed = false;
>   server.on('error', () => { launchFailed = true; });
>   for (let count = 0; count < 150; count++) {
>     if (launchFailed || server.exitCode !== null) throw new Error('Isolated server failed to start');
>     try { if ((await fetch(`${baseUrl}/global/health`, { headers, signal: AbortSignal.timeout(500) })).ok) return; } catch { /* startup */ }
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
> }
> try {
>   await start();
>   const health = await (await fetch(`${baseUrl}/global/health`, { headers })).json() as { version: string };
> assert.equal(health.version, '1.19.4', 'Integration fixture targets the installed, researched version');
> await connection.connect(createTransport({ baseUrl, directory: project }));
> assert.equal(connection.state.error, 'authRequired');
> assert.equal(states.filter(state => state.phase === 'retrying').length, 0);
> const source = createTransport({ baseUrl, directory: project, credentials: { username: 'sidecode-test', password } });
> const first = states.length;
> const task = connection.connect(source);
> await waitFor('connected', first);
> // Observe heartbeat traffic long enough to catch envelope differences.
> await pause(12000);
> assert.equal(connection.state.phase, 'connected');
> const restart = states.length;
> await stop();
> await waitFor('retrying', restart);
> await start();
> await waitFor('connected', restart);
> connection.disconnect(); await task;
> assert.equal(connection.state.phase, 'disconnected');
> assert.doesNotMatch(JSON.stringify(states), new RegExp(password));
> console.log('PASS: real OpenCode 1.19.4 Basic auth rejection/success, sessions, SSE/heartbeat, stop/restart recovery and cancellation. Isolated data:', root);
> } finally { connection.dispose(); await stop(); }
> EOF
> python3 - <<'PY'
> p='tests/extension.test.ts';s=open(p).read().replace('{ module, exports: module.exports, require:', '{ Headers, Request, Response, AbortController, setTimeout, clearTimeout, module, exports: module.exports, require:');open(p,'w').write(s)
> import json
> p='package.json';d=json.load(open(p));d['scripts']['test:server']='tsx scripts/test-server.ts';d['scripts']['test:native']='node scripts/test-native.mjs';open(p,'w').write(json.dumps(d,indent=2)+'\n')
> PY``
>
> - Ran `npm run test:server`
> - Ran `npm run check && npm run test:webview`
> - Ran `python3 - <<'PY'
p='src/extension/controller.ts';s=open(p).read().replace('  private dialog = false;', '  private dialog = false;\n  private disposed = false;').replace("    if (type === 'ready') return;", "    if (this.disposed || type === 'ready') return;\n    const actionEpoch = this.epoch;")
s=s.replace('        if (value !== undefined) await', '        if (actionEpoch === this.epoch && value !== undefined) await')
s=s.replace('        if (username === undefined) return;', '        if (actionEpoch !== this.epoch || username === undefined) return;')
s=s.replace('        if (password === undefined) return;', '        if (actionEpoch !== this.epoch || password === undefined) return;')
s=s.replace("      } catch { this.connection.fail('credentials'); return; }", "      } catch { if (epoch === this.epoch) this.connection.fail('credentials'); return; }")
s=s.replace('    } catch (error) {\n      this.connection.fail', '    } catch (error) {\n      if (this.disposed) return;\n      this.connection.fail')
s=s.replace('  dispose(): void { this.epoch++;', '  dispose(): void { this.disposed = true; this.epoch++;')
open(p,'w').write(s)
PY`
>
> </details>
>
> The real-server test passed: OpenCode rejected missing credentials, accepted Basic auth, listed sessions, kept SSE connected, and recovered after the test server was stopped and restarted. Native docking also passes in VS Code.
>
> I’m now checking the host-side boundaries—credential handling, cancellation during dialogs, and settings changes—before packaging and rerunning the editor tests.
>
> <details><summary>Explored 4 files, ran 6 commands</summary>
>
> - Ran `cat > tests/controller.test.ts <<'EOF'
>   import assert from 'node:assert/strict';
>   import test from 'node:test';
>   import vm from 'node:vm';
>   import { createHash } from 'node:crypto';
>   import { build } from 'esbuild';
>   import type { Controller } from '../src/extension/controller';
>
> async function harness() {
> const bundle = await build({ entryPoints: ['src/extension/controller.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
> const logs: string[] = [];
> const secrets = new Map<string, string>();
> const prompts: Array<{ password?: boolean }> = [];
> const responses: Array<string | undefined | Promise<string | undefined>> = [];
> const requests: Request[] = [];
> let url = 'http://127.0.0.1:4096';
> let change = (\_event: { affectsConfiguration(key: string): boolean }) => {};
> const dispose = { dispose() {} };
> const workspace = {
> isTrusted: true, workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/private/project' } }],
> getConfiguration: () => ({ get: () => url, update: async (\_name: string, value: string) => { url = value; change({ affectsConfiguration: () => true }); } }),
> onDidChangeConfiguration: (listener: typeof change) => { change = listener; return dispose; },
> onDidChangeWorkspaceFolders: () => dispose,
> };
> const vscode = { workspace, ConfigurationTarget: { Global: 1 }, window: {
> createOutputChannel: () => ({ appendLine: (line: string) => logs.push(line), show() {}, dispose() {} }),
> showInputBox: async (options: { password?: boolean }) => { prompts.push(options); return await responses.shift(); },
> } };
> const module = { exports: {} as { Controller: new (context: unknown) => Controller } };
> vm.runInNewContext(bundle.outputFiles[0]!.text, {
> module, exports: module.exports, Headers, Request, Response, URL, Buffer, AbortController, TextDecoderStream,
> setTimeout, clearTimeout,
> fetch: async (request: Request) => {
> requests.push(request);
> const path = new URL(request.url).pathname;
> if (path.endsWith('/event')) return new Response(new ReadableStream({ start(controller) {
> controller.enqueue(new TextEncoder().encode('data: {"type":"server.connected","properties":{}}\n\n'));
> request.signal.addEventListener('abort', () => { try { controller.close(); } catch { /_ already cancelled _/ } }, { once: true });
> } }), { headers: { 'content-type': 'text/event-stream' } });
> return Response.json(path.endsWith('/health') ? { healthy: true, version: '1.19.4' } : []);
> },
> require: (id: string) => { if (id === 'vscode') return vscode; if (id === 'node:crypto') return { createHash }; throw new Error('unexpected dependency'); },
> });
> const controller = new module.exports.Controller({ secrets: {
> get: async (key: string) => secrets.get(key), store: async (key: string, value: string) => { secrets.set(key, value); }, delete: async (key: string) => { secrets.delete(key); },
> } });
> return { controller, secrets, responses, requests, prompts, logs, workspace, change: () => change({ affectsConfiguration: () => true }) };
> }
> test('credentials use endpoint-scoped SecretStorage and never diagnostics', async () => {
> const h = await harness();
> try {
> h.responses.push('opencode', 'private-password'); await h.controller.action('credentials');
> assert.equal(h.prompts[1]?.password, true); assert.equal(h.secrets.size, 1);
> const firstKey = [...h.secrets.keys()][0]!;
> assert.doesNotMatch(firstKey, /4096|private-password/);
> h.responses.push('http://127.0.0.1:4097'); await h.controller.action('configure');
> h.responses.push('opencode', 'other-password'); await h.controller.action('credentials');
> assert.equal(h.secrets.size, 2);
> await h.controller.action('clearCredentials');
> assert.equal(h.secrets.size, 1); assert.ok(h.secrets.has(firstKey));
> assert.doesNotMatch(h.logs.join('\n'), /private-password|other-password|127\.0\.0\.1|4096/);
> } finally { h.controller.dispose(); }
> });
> test('cancelled credential dialogs and disposed controllers do not store late values', async () => {
> const h = await harness();
> h.responses.push(undefined); await h.controller.action('credentials'); assert.equal(h.secrets.size, 0);
> let release!: (value: string) => void;
> h.responses.push(new Promise<string>(resolve => { release = resolve; }));
> const action = h.controller.action('credentials');
> h.controller.dispose(); release('late username'); await action;
> assert.equal(h.secrets.size, 0); assert.equal(h.prompts.length, 2);
> });
> test('untrusted workspaces cannot connect; trusted connection cancels on settings changes', async () => {
> const h = await harness();
> try {
> h.workspace.isTrusted = false; await h.controller.action('connect');
> assert.equal(h.controller.connection.state.error, 'untrusted'); assert.equal(h.requests.length, 0);
> h.workspace.isTrusted = true;
> const connected = new Promise<void>(resolve => h.controller.connection.subscribe(state => { if (state.phase === 'connected') resolve(); }));
> await h.controller.action('connect'); await connected;
> assert.equal(h.requests.length, 3);
> h.change(); assert.equal(h.controller.connection.state.phase, 'disconnected');
> assert.doesNotMatch(h.logs.join('\n'), /private|project/);
> } finally { h.controller.dispose(); }
> });
> EOF
> python3 - <<'PY'
> p='tests/controller.test.ts';s=open(p).read().replace('let change = (\_event: { affectsConfiguration(key: string): boolean }) => {};', 'let change: (event: { affectsConfiguration(key: string): boolean }) => void = () => {};');open(p,'w').write(s)
> p='tests/protocol.test.ts';s=open(p).read().replace(" for (const value of [null, [], {},", " for (const value of [{ version: 1, type: 'connection', state: { phase: 'connected', attempt: 4, error: null } }, { version: 1, type: 'connection', state: { phase: 'connected', attempt: 0, error: 'raw secret' } }, { version: 1, type: 'connection', state: { phase: 'connected', attempt: 0, error: null, secret: 'x' } }, null, [], {},");open(p,'w').write(s)
> PY
> npm run check`
>
> - Ran `python3 - <<'PY'
p='scripts/test-native.mjs';s=open(p).read().replace("await mkdir(join(root, 'extensions'));", "await mkdir(join(root, 'extensions'));\nawait mkdir(join(root, 'project'));\nconst connect = process.env.SIDECODE_NATIVE_CONNECT === '1';")
s=s.replace("'--disable-workspace-trust'], timeout:", "'--disable-workspace-trust', ...(connect ? [join(root, 'project')] : [])], timeout:")
start=s.index('  let content;');end=s.index("  await content.getByRole('status')",start)
s=s[:start]+'''  let content;
  for (let count = 0; count < 60; count++) {
    for (const frame of page.frames()) {
      if (await frame.getByRole('main', { name: 'OpenCode chat' }).count()) content = frame;
    }
    if (content) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!content) throw new Error('No rendered OpenCode webview');
'''+s[end:]
s=s.replace("  console.log('PASS: native React content, keyboard focus and movement to Secondary Side Bar');", "  if (connect) {\n    await content.getByRole('button', { name: 'Connect', exact: true }).click();\n    await content.getByRole('status').filter({ hasText: /^Connected$/ }).waitFor({ timeout: 15000 });\n    await content.getByRole('button', { name: 'Disconnect', exact: true }).click();\n    await content.getByRole('status').filter({ hasText: 'Not connected' }).waitFor();\n  }\n  console.log('PASS: native React content, keyboard focus and movement to Secondary Side Bar' + (connect ? '; explicit live connection/disconnection' : ''));")
open(p,'w').write(s)
PY`
> - Ran `SIDECODE_NATIVE_CONNECT=1 node scripts/test-native.mjs`
> - Ran `SIDECODE_NATIVE_CONNECT=1 SIDECODE_EDITOR_BINARY=/usr/share/code/code node scripts/test-native.mjs`
>
> <details><summary>Explored 4 files</summary>
>
> - Read `./docs/verification.md`
> - Read `./README.md`
> - Read `./src/adapter/README.md`
> - Read `./scripts/test-native.mjs`
>
> </details>
>
> - Ran ``python3 - <<'PY'
>   p='README.md';s=open(p).read();start=s.index('A VS Code/');end=s.index('\n## Development', start);s=s[:start]+'''A VS Code/VSCodium sidebar client for an **existing OpenCode server**. The
>   connection preview checks health, loads the project session list and subscribes
>   to events, with explicit connect/disconnect and recoverable errors. Conversation
>   controls are still disabled; it does not send prompts or start a server.
>
> ## Connect
>
> 1. Open the OpenCode view. Choose **Server URL** if your server is not at
>    `http://127.0.0.1:4096`. This explicit action updates only `sidecode.serverUrl`
>    in user settings; activation never writes settings.
> 2. If the server requires Basic auth, use **Connection options → Set credentials**.
>    Username and password are entered in native editor dialogs, stored together
>    in SecretStorage under an endpoint-specific key, and never sent to the webview.
>    Use **Clear credentials** to remove them for the current URL. Non-loopback
>    authenticated servers require HTTPS. Provider API keys are not server passwords.
> 3. Choose **Connect**. One open folder is used automatically; multiple folders
>    prompt for a choice; an empty window prompts for a project folder. The folder
>    must exist in the server's filesystem context. For remote development run the
>    extension host alongside the server; arbitrary local-to-remote path mapping
>    is not implemented. Untrusted and virtual workspaces cannot connect.
> 4. Use **Disconnect** to stop requests, retry timers and the event subscription.
>    Changing the URL/workspace also disconnects. Reconnect explicitly afterward.
>
> Connection stages distinguish health, session initialization and event startup.
> Requests/initial events time out after 10 seconds; event silence after 45 seconds.
> Transient failures retry three times with 0.5/1/2-second delays. A connection stable
> for at least one minute gets a fresh retry budget on the next drop. Authentication
> and incompatible API responses require correction and an explicit reconnect.
>
> **Diagnostics** opens a dedicated Output channel containing only fixed state,
> retry count and error codes—no URLs, paths, credentials, sessions or message text.
> If health passes but sessions fail, check project context. If events fail, ensure
> any reverse proxy passes SSE without buffering. An HTML response usually means
> an incorrect API base URL or incompatible server; the root HTML page is never
> used as a health check. Tested server/SDK version: **1.19.4** only.
> ''' + s[end:]
> s=s.replace('- `src/adapter`: reserved boundary for the Phase 2 SDK integration.', '- `src/adapter`: SDK-only transport, response/event validation and connection lifecycle.')
> s=s.replace('- `scripts/probe.ts`: standalone discovery; SDK is only a development dependency now.', '- `scripts/probe.ts`: standalone read-only discovery; SDK client code is now bundled into the host.')
> start=s.index('No telemetry, credential storage');s=s[:start]+'''No telemetry, session mutations, silent approvals, terminal creation or automatic
> opening of chat windows. The strict webview CSP blocks network requests and allows
> only bundled scripts/styles. React renders text; rich message rendering is later work.
>
> The visual direction is provisional. Final design still requires the roadmap's
> 2–3 concepts and selection. Conversations, permission UI, model selection and CLI
> session continuity remain Phase 3/4 work. Received tool/permission events are not
> acted on in this preview. See `docs/verification.md` for remaining accessibility,
> third-party coexistence and platform checks.
> '''
> s=s.replace('- `npm run probe`:', '''- `npm run test:native`: launches a temporary development profile, checks rendered
> React content and focus, and moves OpenCode through native controls to Secondary
> Side Bar. Set `SIDECODE_EDITOR_BINARY` for VS Code. Add `SIDECODE_NATIVE_CONNECT=1`
> to explicitly connect to the existing unauthenticated server on port 4096 using
> a temporary project; the default test makes no server requests.
>
> - `npm run test:server`: launches the installed OpenCode 1.19.4 binary with isolated
>   config/data, a temporary port and generated credentials. Tests Basic auth, SSE
>   and stop/restart recovery, then stops only its own test process. Does not run
>   models or mutate sessions. This is test tooling, not a managed-server feature.
> - `npm run probe`:''')
>   open(p,'w').write(s)
>   p='src/adapter/README.md';open(p,'w').write('''# OpenCode adapter boundary
>
> `transport.ts` uses only `@opencode-ai/sdk/v2/client`, pinned to 1.19.4. The host
> supplies a normalized base URL, explicit project directory and optional credentials.
> Custom fetch checks statuses and JSON/SSE content types and disallows redirects.
> Only the outer event envelope is consumed in Phase 2; session data and all event
> payloads stay private to the adapter. Future operations must validate consumed fields.
>
> `connection.ts` owns health/session/subscription stages, first-event and idle
> watchdogs, bounded backoff, cancellation and stale-attempt suppression. SDK internal
> retries are limited to one attempt, so there is only one retry owner. A new Connect
> cancels its predecessor; explicit Disconnect also cancels delayed retries.
>
> No SDK errors, URLs, paths, credentials or server payloads cross the UI protocol.
> No event causes tool execution, permission approval, a session mutation or an IDE
> command. Implement conversation and permission semantics separately in later phases.
> ''')
> p='PLAN.md';s=open(p).read();tasks=['Verify `/global/health`, session endpoints, event streams, and auth against a real server.','Implement configurable existing-server URL.','Add documented API health/version checks and precise error reporting.','Handle SSE subscription, reconnection, cancellation, and disposal.','Add optional supported authentication using SecretStorage.','Add redacted diagnostic output and unit tests.']
> for task in tasks:s=s.replace('- [ ] '+task,'- [x] '+task)
> s=s.replace('Phase 1 implementation is in place; **manual exit verification remains open**.\nNo Phase 2 runtime connection behavior has been implemented.', 'Historical Phase 1 record: implementation was in place with native verification open.\nSee the continuation record below for native docking and Phase 2 completion.')
> s+='''
>
> ## Continuation — Phase 2 connection milestone
>
> ### Delivered
>
> - Explicit Connect/Disconnect, machine-scoped `sidecode.serverUrl`, native URL and
>   credential dialogs, endpoint-scoped SecretStorage and fixed-code Output diagnostics.
>   No automatic connection or configuration writes; Set Server URL is an explicit
>   user action. No secrets or server content cross the host/webview bridge.
> - Pinned SDK client is now a runtime dependency, bundled into the host. No server
>   launcher, model runtime or session mutation was added to the extension.
> - Health, sessions, event startup and connected states are distinct. JSON/SSE
>   status/content types and consumed data are validated. Redirects are refused.
> - Three retries with 0.5/1/2-second backoff; 10-second startup/request and 45-second
>   event-idle watchdogs. Retry budget resets after a minute of stable connection.
>   Cancellation covers fetch, SSE, timers, replaced connections and disposal.
> - Project selection is explicit for multiple folders/empty windows. Workspace or
>   server URL changes disconnect. Trust is required; virtual workspaces are disabled.
>   Filesystem context must match the server (no arbitrary remote path mapping).
> - Authenticated remote URLs require HTTPS; loopback HTTP is supported. SecretStorage
>   stores server credentials separately for each normalized URL. Clear credentials
>   affects only that endpoint. Native OS keyring persistence remains a release check.
>
> ### Verification
>
> - 17 unit tests pass: protocol/CSP, activation safety, endpoint-scoped credentials,
>   cancelled dialogs, trust gate, config-change cancellation, connection stages,
>   timeouts, stale attempts, bounded retries, redaction, event validation and SDK routes.
> - Typecheck/lint/build pass. Browser checks pass for 12 theme/width fixtures.
> - Native Playwright/Electron checks pass in both VSCodium and VS Code: visible React
>   UI, focusable Connect control, movement via native Move View to Secondary Side Bar,
>   and real Connect/Disconnect through the webview against existing OpenCode 1.19.4.
>   Both empty-window and folder rendering were exercised in disposable profiles.
> - Isolated real-server test passes: OpenCode 1.19.4 rejects missing credentials,
>   accepts Basic auth, lists sessions, streams connection/heartbeat traffic, then
>   recovers after stopping/restarting only the test process. No prompts or session
>   mutations, no changes to the user's running server or its credentials/config.
> - Test-server isolation uses upstream-verified XDG paths, OPENCODE_TEST_HOME,
>   OPENCODE_CONFIG_DIR, project-config/model-fetch/autoupdate disable flags and --pure.
>   This launcher is test-only; it is not shipped in the VSIX.
> - Phase 2's connection/restart exit is met for tested version 1.19.4. Phase 1 native
>   docking is now verified. Broad Codex/Claude coexistence, screen reader behavior,
>   native theme matrix and disable/re-enable checks remain explicit Phase 5 gates.
>
> ### Next milestone
>
> Stop here before conversations. Phase 3 should first verify CLI-created session
> scope/continuity, then implement session selection and streaming with deduplication.
> Keep permissions visible and explicit when Phase 4 adds tool interaction.
> '''
> open(p,'w').write(s)
> PY
> cat >> docs/discovery.md <<'EOF'
>
> ## Phase 2 findings
>
> The pinned SDK SSE generator reports failures through `onSseError` and ends its
> iterator; EOF is also a normal end. The adapter must turn both into connection
> state changes and own retries itself (`sseMaxRetryAttempts: 1`). It must not rely
> on an iterator throwing or on the SDK's default retry loop. Verified with both
> unit fixtures and a real authenticated 1.19.4 server stop/restart.
>
> Test isolation flags were checked against upstream 1.19.4
> [flags](https://github.com/anomalyco/opencode/blob/v1.19.4/packages/core/src/flag/flag.ts),
> [global paths](https://github.com/anomalyco/opencode/blob/v1.19.4/packages/core/src/global.ts)
> and [config paths](https://github.com/anomalyco/opencode/blob/v1.19.4/packages/opencode/src/config/paths.ts).
> `OPENCODE_TEST_HOME` is test-only; HOME is not changed. Runtime never spawns a server.
>
> Basic auth, initial session listing, SSE/heartbeat and reconnect now pass against
> an isolated real server. Native Connect/Disconnect also passes against the existing
> server in both editors. CLI continuity, session/message mutations and permission
> response semantics remain untested and unimplemented.
> EOF``
>
> - Ran ``python3 - <<'PY'
p='src/webview/style.css';s=open(p).read().replace('.shell { height: 100%;', '.shell { overflow-y: auto; height: 100%;').replace('.header { padding:', '.header { flex-shrink: 0; padding:');open(p,'w').write(s)
p='scripts/test-webview.ts';s=open(p).read().replace("await page.addInitScript(`window.acquireVsCodeApi = () => ({ postMessage: () => {\n queueMicrotask", "await page.addInitScript(`window.sentActions = []; window.acquireVsCodeApi = () => ({ postMessage: (message) => {\n window.sentActions.push(message.type);\n if (message.type === 'ready') queueMicrotask")
>   s=s.replace(" await page.close();", """ await page.getByRole('button', { name: 'Connect', exact: true }).click();
>   assert.ok((await page.evaluate('window.sentActions')).includes('connect'));
>   await page.evaluate(() => window.postMessage({ version: 1, type: 'connection', state: { phase: 'connected', attempt: 0, error: null } }, '_'));
>   await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
>   assert.ok((await page.evaluate('window.sentActions')).includes('disconnect'));
>   await page.evaluate(() => window.postMessage({ version: 1, type: 'connection', state: { phase: 'error', attempt: 0, error: 'authRequired' } }, '_'));
>   await page.getByRole('alert').filter({ hasText: 'Server authentication failed' }).waitFor();
>   await page.getByText('Connection options', { exact: true }).click();
>   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'expanded controls overflow');
>   assert.deepEqual(errors, []);
>   await page.close();""")
>   s=s.replace('bridge handshake, disabled controls, no overflow or script errors.', 'bridge actions/status/errors, disabled chat controls, no overflow or script errors.')
>   open(p,'w').write(s)
>   p='docs/verification.md';s=open(p).read().replace('# Phase 1 verification','# Verification through Phase 2').replace('Manual acceptance matrix (mark only after observing):', 'Acceptance matrix (native automation now covers rendering and docking):')
>   s=s.replace('- [ ] VSCodium: open view with folder and empty window; visible React content.', '- [x] VSCodium: open view with folder and empty window; visible React content (native automation).').replace('- [ ] VS Code: open view with folder and empty window; visible React content.', '- [x] VS Code: open view with folder and empty window; visible React content (native automation).')
>   s=s.replace('- [ ] Move view to Secondary Side Bar through native controls, then restore it.', '- [x] Move view to Secondary Side Bar through native controls in disposable profiles (both editors).\n- [ ] Restore/reload view placement and test disable/re-enable.')
>   s=s.replace('- [ ] Readable at 200/240/320 px widths with no horizontal overflow.', '- [x] Readable at 200/240/320 px widths with no horizontal overflow (browser fixtures).')
>   s+='''
>
> ## Phase 2 continuation
>
> Native tests now inspect the real rendered webview in both editors, drive Move View
> through the UI into Secondary Side Bar, focus Connect, and exercise live Connect/
> Disconnect. Temporary profiles only. Native dark-theme screenshots inspected;
> full native theme matrix and assistive technology checks remain outstanding.
>
> The 17 unit tests now include connection lifecycle, SDK response validation,
> SecretStorage endpoint separation, cancellation and trust gating. OS keyring
> persistence is not established by mocks and remains a release check.
>
> `test:server` uses a real isolated OpenCode 1.19.4 process with generated Basic auth
> credentials, private temporary config/data paths and no plugins. Missing credentials
> fail without retries; correct credentials connect and survive a test-server restart.
> The user's server is never stopped or modified. Live SDK scope is still limited to
> health, listing, connection/heartbeat events and recovery—not conversations.
> '''
> open(p,'w').write(s)
> PY
> npm run check && npm run test:webview && npm run package``
>
> </details>
>
> The webview now connects and disconnects successfully in both editors, and the new host tests pass. The remaining packaging run includes expanded connection controls and authentication errors at narrow widths.
>
> I’ll stop at this connection milestone. The roadmap will keep conversation streaming and CLI session continuity as the next work, with OS keyring persistence and the broader accessibility/coexistence matrix still marked for release verification.
>
> <details><summary>Ran 7 commands</summary>
>
> - Ran `python3 - <<'PY'
p='scripts/test-webview.ts';s=open(p).read().replace("await page.evaluate('window.sentActions')", "await page.evaluate<string[]>('window.sentActions')");open(p,'w').write(s)
PY
npm run check && npm run test:webview && npm run package`
> - Ran `rg -n 'Phase 1|not implemented|not.*tested|reserved|development.only|No Phase 2' README.md docs PLAN.md src/adapter/README.md
node --input-type=module -e 'import fs from "node:fs"; const p=JSON.parse(fs.readFileSync("package.json")); const l=JSON.parse(fs.readFileSync("package-lock.json")); if(JSON.stringify(p.dependencies)!==JSON.stringify(l.packages[""].dependencies)||JSON.stringify(p.devDependencies)!==JSON.stringify(l.packages[""].devDependencies)) process.exit(1); console.log("Dependency lockfile matches manifest")'`
> - Ran `node --input-type=module <<'JS'
import fs from 'node:fs';
import assert from 'node:assert/strict';
const p=JSON.parse(fs.readFileSync('package.json'));
const l=JSON.parse(fs.readFileSync('package-lock.json'));
assert.deepEqual(p.dependencies,l.packages[''].dependencies);
assert.deepEqual(p.devDependencies,l.packages[''].devDependencies);
console.log('Dependency lockfile matches manifest');
JS`
> - Ran `npm run test:editor`
> - Ran `SIDECODE_EDITOR_CLI=/usr/bin/code SIDECODE_EDITOR_BINARY=/usr/share/code/code npm run test:editor`
> - Ran `python3 - <<'PY'
p='PLAN.md';s=open(p).read().replace('### Next milestone\nFinish the isolated manual Phase 1 checklist', '### Historical next milestone (superseded below)\nFinish the isolated manual Phase 1 checklist');open(p,'w').write(s)
p='docs/discovery.md';s=open(p).read().replace('# Discovery — 2026-11-12', '# Discovery — 2026-11-12\n\nThe initial findings below are historical; see **Phase 2 findings** at the end for\nverified authentication/reconnect support and the current SDK runtime boundary.');open(p,'w').write(s)
PY`
> - Ran `python3 - <<'PY'
p='PLAN.md';s=open(p).read().replace('- Typecheck/lint/build pass. Browser checks pass for 12 theme/width fixtures.', '- Typecheck/lint/build pass. Browser checks pass for 12 theme/width fixtures,\n  including Connect/Disconnect actions, status/error updates and expanded controls.\n- Final Phase 2 VSIX packaged successfully. Clean-profile install, activation in\n  empty/folder windows, unchanged configuration/tab groups, uninstall and reinstall\n  all pass again in VSCodium 1.143.17232 and VS Code 1.145.2. Host watcher warnings\n  persist; no system settings were changed to suppress them.');open(p,'w').write(s)
p='docs/verification.md';s=open(p).read()+'''\nFinal Phase 2 VSIX was rebuilt and installed/uninstalled/reinstalled successfully\nin both editors. Empty/folder activation preserves configuration and tab groups.\nThe expanded browser matrix also checks action dispatch, connected/error states\nand narrow expanded connection options.\n''';open(p,'w').write(s)
PY`
>
> </details>

</details>

Implemented Phase 2 connection support and verified native sidebar docking in both editors.

- Explicit connect/disconnect, configurable URL, SecretStorage credentials.
- Health/session/SSE states, bounded retries, cancellation, and redacted diagnostics.
- Updated [PLAN.md](./git/sidecode/PLAN.md) and rebuilt the [VSIX](./git/sidecode/sidecode-0.1.0.vsix).

Passed: 17 unit tests, typecheck/lint/build, 12 browser layout cases, native editor checks, and real OpenCode 1.19.4 authentication/restart recovery tests.

Your active editor configuration and existing server were left untouched. OS keyring persistence, accessibility, and broader extension coexistence remain release checks.

Next: Phase 3—verify CLI session continuity, then add session selection and streaming conversations.

> to clear--this is going in tthe side panel that the rest of thea c hats do right (codex, claude code, etc?)

Yes—it’s a dockable chat view in the IDE sidebar, including the **right-hand Secondary Side Bar** where you can place Codex and Claude Code.

You can group it alongside those chats using the editor’s normal view controls. It remains its own OpenCode view, rather than a tab inside Codex or Claude’s interface. It won’t move your existing chats or change your layout automatically.

> go on

<details><summary>7 previous messages</summary>

> I’ll begin Phase 3: verify how OpenCode scopes and resumes sessions, then add session selection, prompt submission, and streaming responses in the same dockable sidebar. I’ll keep permission handling and the broader agent workflow for Phase 4.
>
> <details><summary>Ran 3 commands, searched the web</summary>
>
> - Ran `cat AGENTS.md SPEC.md PLAN.md
cat package.json`
>
> Searched the web for `https://opencode.ai/docs/sdk/`
>
> - Ran `sed -n '950,1255p' node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts
cat src/adapter/transport.ts src/adapter/connection.ts src/extension/controller.ts src/shared/protocol.ts src/webview/App.tsx
opencode run --help
opencode session --help`
> - Ran `cat scripts/test-server.ts
rg -n '^export type (Session =|TextPart =|AssistantMessage =|UserMessage =|EventMessagePart|SessionStatus|PermissionRequest)' node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts
cat src/extension/controller.ts src/extension/activate.ts`
>
> Searched the web for `https://raw.githubusercontent.com/anomalyco/opencode/v1.19.4/packages/opencode/src/server/routes/instance/httpapi/session.ts`
>
> </details>
>
> The installed SDK exposes the session, message-history, asynchronous prompt, and abort operations we need. I’m checking their behavior against an isolated OpenCode 1.19.4 instance before wiring them into the UI.
>
> For streaming, I’ll use server message IDs and authoritative history snapshots to reconcile updates after a reconnect. That avoids duplicating text when events are missed or repeated. The integration tests will use a deterministic local model fixture, so they won’t spend API credits or change your provider configuration.
>
> <details><summary>Explored 3 files, a search, ran 5 commands</summary>
>
> - Ran ``mkdir -p scripts/fixtures
python3 - <<'PY'
s=open('scripts/test-server.ts').read();start=s.index('const root =');end=s.index('const connection =',start);body=s[start:end].replace("OPENCODE_CONFIG_CONTENT: '{}'", "OPENCODE_CONFIG_CONTENT: JSON.stringify(config)")
imports='''import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
'''
open('scripts/fixtures/server.ts','w').write(imports+'\n/** Test-only isolated OpenCode process; never bundled into the extension. */\nexport async function isolatedServer(config: Record<string, unknown> = {}) {\n'+body+'return { root, project, baseUrl, env, headers, credentials: { username: "sidecode-test", password }, start, stop };\n}\n')
PY
cat > scripts/fixtures/model.ts <<'EOF'
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
/** Deterministic inference fixture; the real OpenCode server still owns the agent/session loop. */
export async function modelFixture() {
  const requests: unknown[] = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw) as { stream?: boolean }; requests.push(body);
    const text = 'Fixture reply: **hello**.\n\n```ts\nconst answer = 42;\n```';
    if (!body.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'fixture', object: 'chat.completion', created: 1, model: 'fixture', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const part of text.match(/.{1,8}|\n/g) ?? []) {
      if (res.destroyed) return;
      res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { content: part }, finish_reason: null }] })}\n\n`);
      await pause(100);
    }
    res.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\ndata: [DONE]\n\n`);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No model fixture port');
  const config = { model: 'fixture/fixture', small_model: 'fixture/fixture', provider: { fixture: { npm: '@ai-sdk/openai-compatible', name: 'Test fixture', options: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: '[REDACTED_SECRET]' }, models: { fixture: { name: 'Fixture', limit: { context: 32000, output: 4096 } } } } } };
  return { config, requests, stop: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
EOF
cat > scripts/discover-conversations.ts <<'EOF'
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
EOF``
> - Ran `node --import tsx scripts/discover-conversations.ts`
>
> <details><summary>Explored 8 files, a search</summary>
>
> - Read `./node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts`
> - Read `./node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts`
> - Read `./node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts`
> - Searched for `^export declare class Permission` in `sdk.gen.d.ts`
> - Read `./node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts`
> - Read `./node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts`
> - Read `./node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts`
> - Read `./node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts`
> - Read `./tsconfig.json`
>
> </details>
>
> - Ran `npm install --save-exact react-markdown rehype-highlight --cache /tmp/sidecode-npm-cache --fetch-retries=0 --fetch-timeout=15000`
> - Ran ``cat > src/shared/chat.ts <<'EOF'
export interface SessionSummary { id: string; title: string }
export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; status: 'sent' | 'streaming' | 'complete' | 'failed' | 'stopped'; otherParts: boolean }
export const chatErrors = {
  readFailed: 'Could not refresh the conversation. Retry loading when the connection is available.',
  sendUncertain: 'Delivery is uncertain. Refresh history before sending again; resending may duplicate the prompt.',
  createUncertain: 'Session creation could not be confirmed. Refresh the session list before creating another.',
  stopFailed: 'Could not confirm Stop. Refresh the conversation and try again.',
  sessionMissing: 'This session is no longer available in the selected project.',
} as const;
export interface ChatState {
  sessions: SessionSummary[];
  selectedId: string | null;
  messages: ChatMessage[];
  busy: boolean;
  waiting: boolean;
  loading: boolean;
  operation: 'none' | 'creating' | 'sending' | 'stopping';
  error: keyof typeof chatErrors | null;
  submitted: string | null;
  hasMore: boolean;
}
export function emptyChat(): ChatState { return { sessions: [], selectedId: null, messages: [], busy: false, waiting: false, loading: false, operation: 'none', error: null, submitted: null, hasMore: false }; }
export function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function identifier(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value); }
export function isChatState(value: unknown): value is ChatState {
  if (!record(value) || Object.keys(value).length !== 11) return false;
  return Array.isArray(value.sessions) && value.sessions.length <= 100 && value.sessions.every(s => record(s) && Object.keys(s).length === 2 && identifier(s.id) && typeof s.title === 'string' && s.title.length <= 1000)
    && (value.selectedId === null || identifier(value.selectedId))
    && Array.isArray(value.messages) && value.messages.length <= 1000 && value.messages.every(m => record(m) && Object.keys(m).length === 5 && identifier(m.id) && ['user', 'assistant'].includes(String(m.role)) && typeof m.text === 'string' && m.text.length <= 1000000 && ['sent', 'streaming', 'complete', 'failed', 'stopped'].includes(String(m.status)) && typeof m.otherParts === 'boolean')
    && typeof value.busy === 'boolean' && typeof value.waiting === 'boolean' && typeof value.loading === 'boolean' && typeof value.hasMore === 'boolean'
    && ['none', 'creating', 'sending', 'stopping'].includes(String(value.operation))
    && (value.error === null || (typeof value.error === 'string' && Object.hasOwn(chatErrors, value.error)))
    && (value.submitted === null || identifier(value.submitted));
}
EOF
python3 - <<'PY'
p='src/adapter/transport.ts';s=open(p).read().replace('export function createTransport(options: ConnectionOptions, fetcher: typeof fetch = fetch): Transport {','export function createApiClient(options: ConnectionOptions, fetcher: typeof fetch = fetch) {')
s=s.replace("    if (!code && response.headers.get('content-type')", "    const emptyPromptAck = response.status === 204 && request.method === 'POST' && /\\/session\\/[^/]+\\/prompt_async$/.test(new URL(request.url).pathname);\n    if (!code && !emptyPromptAck && response.headers.get('content-type')")
s=s.replace("  const client = createOpencodeClient({ baseUrl, directory: options.directory, headers, fetch: checkedFetch, throwOnError: true });\n  return {", "  return createOpencodeClient({ baseUrl, directory: options.directory, headers, fetch: checkedFetch, throwOnError: true });\n}\nexport function createTransport(options: ConnectionOptions, fetcher: typeof fetch = fetch): Transport {\n  const client = createApiClient(options, fetcher);\n  return {")
open(p,'w').write(s)
PY
cat > src/adapter/conversations.ts <<'EOF'
import { createApiClient, type ConnectionOptions } from './transport';
import { ConnectionError } from './errors';
import { identifier, record, type ChatMessage, type SessionSummary } from '../shared/chat';
export interface ConversationSnapshot { messages: ChatMessage[]; busy: boolean; waiting: boolean; hasMore: boolean }
export interface ConversationApi {
  list(signal: AbortSignal): Promise<SessionSummary[]>;
  create(signal: AbortSignal): Promise<SessionSummary>;
  snapshot(id: string, limit: number, signal: AbortSignal): Promise<ConversationSnapshot>;
  send(id: string, messageID: string, text: string, signal: AbortSignal): Promise<void>;
  stop(id: string, signal: AbortSignal): Promise<void>;
}
function invalid(): never { throw new ConnectionError('incompatible'); }
export function sessionSummary(value: unknown, directory: string): SessionSummary {
  if (!record(value) || !identifier(value.id) || typeof value.title !== 'string' || value.directory !== directory) return invalid();
  return { id: value.id, title: value.title.slice(0, 1000) };
}
export function projectMessages(value: unknown, sessionID: string): ChatMessage[] {
  if (!Array.isArray(value) || value.length > 1000) return invalid();
  const messages = new Map<string, ChatMessage>();
  for (const item of value) {
    if (!record(item) || !record(item.info) || !Array.isArray(item.parts)) return invalid();
    const info = item.info;
    if (!identifier(info.id) || info.sessionID !== sessionID || !['user', 'assistant'].includes(String(info.role)) || !record(info.time)) return invalid();
    const parts = new Map<string, string>(); let otherParts = false;
    for (const part of item.parts) {
      if (!record(part) || !identifier(part.id) || part.messageID !== info.id || part.sessionID !== sessionID || typeof part.type !== 'string') return invalid();
      if (part.type === 'text') {
        if (typeof part.text !== 'string' || part.text.length > 1000000) return invalid();
        if (!part.ignored && !part.synthetic) parts.set(part.id, part.text);
      } else if (!['step-start', 'step-finish'].includes(part.type)) otherParts = true;
    }
    const text = [...parts.values()].join('\n\n');
    if (text.length > 1000000) return invalid();
    const error = record(info.error) ? info.error.name : undefined;
    const role = info.role as ChatMessage['role'];
    messages.set(info.id, { id: info.id, role, text, otherParts, status: role === 'user' ? 'sent' : error === 'MessageAbortedError' ? 'stopped' : info.error ? 'failed' : info.time.completed ? 'complete' : 'streaming' });
  }
  return [...messages.values()];
}
export function createConversations(options: ConnectionOptions): ConversationApi {
  const client = createApiClient(options);
  const directory = options.directory;
  return {
    async list(signal) {
      const { data } = await client.session.list({ directory, limit: 100 }, { signal });
      if (!Array.isArray(data) || data.length > 100) return invalid();
      // Directory selects the instance. Never use `path` as a synonym for directory.
>   return data.filter(session => session.directory === directory).map(session => sessionSummary(session, directory));
>   },
>   async create(signal) { return sessionSummary((await client.session.create({ directory }, { signal })).data, directory); },
>   async snapshot(sessionID, limit, signal) {
>   const [history, statuses, permissions] = await Promise.all([
>   > client.session.messages({ directory, sessionID, limit }, { signal }),
>   > client.session.status({ directory }, { signal }),
>   > client.permission.list({ directory }, { signal }),
>   > ]);
>   if (!record(statuses.data) || !Array.isArray(permissions.data)) return invalid();
>   const status = statuses.data[sessionID];
>   if (status !== undefined && (!record(status) || !['idle', 'busy', 'retry'].includes(String(status.type)))) return invalid();
>   const messages = projectMessages(history.data, sessionID);
>   return { messages, busy: status !== undefined && status.type !== 'idle', waiting: permissions.data.some(p => record(p) && p.sessionID === sessionID), hasMore: messages.length >= limit && limit < 1000 };
>   },
>   async send(sessionID, messageID, text, signal) {
>   await client.session.promptAsync({ directory, sessionID, messageID, parts: [{ type: 'text', text }] }, { signal });
>   },
>   async stop(sessionID, signal) {
>   const { data } = await client.session.abort({ directory, sessionID }, { signal });
>   if (data !== true) return invalid();
>   },
>   };
>   }
>   EOF
>   cat > src/adapter/chat.ts <<'EOF'
>   import { randomBytes } from 'node:crypto';
>   import { emptyChat, type ChatState } from '../shared/chat';
>   import type { ConversationApi } from './conversations';
>   import { validEvent } from './transport';
>
> /\*_ SSE invalidates snapshots; snapshots replace messages by ID rather than append deltas. _/
> export class Chat {
> state = emptyChat();
> private api: ConversationApi | undefined;
> private online = false;
> private generation = 0;
> private read: AbortController | undefined;
> private mutation: AbortController | undefined;
> private timer: ReturnType<typeof setTimeout> | undefined;
> private dirty = false;
> private limit = 100;
> private listeners = new Set<() => void>();
> constructor(private interval = 200) {}
> subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
> private update(patch: Partial<ChatState>): void { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
> attach(api: ConversationApi): void { this.clear(); this.api = api; }
> clear(): void {
> this.generation++; this.read?.abort(); this.read = undefined; this.mutation?.abort(); this.mutation = undefined;
> clearTimeout(this.timer); this.timer = undefined; this.api = undefined; this.online = false; this.dirty = false; this.limit = 100;
> this.update(emptyChat());
> }
> dispose(): void { this.clear(); this.listeners.clear(); }
> connection(online: boolean): void {
> if (this.online === online) return;
> this.online = online;
> if (online) this.invalidate();
> else { this.generation++; this.read?.abort(); this.read = undefined; clearTimeout(this.timer); this.timer = undefined; this.update({ loading: false }); }
> }
> event(value: unknown): void {
> if (!validEvent(value)) return;
> if (/^(session\.|message\.|permission\.|question\.)/.test(value.type)) {
> const id = value.properties.sessionID;
> if (id === this.state.selectedId || value.type.startsWith('session.')) this.invalidate();
> }
> }
> invalidate(): void {
> if (!this.online || !this.api) return;
> this.dirty = true;
> if (this.read || this.timer) return;
> this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, this.interval);
> }
> async refresh(): Promise<void> {
> if (!this.online || !this.api) return;
> if (this.read) { this.dirty = true; return; }
> clearTimeout(this.timer); this.timer = undefined; this.dirty = false;
> const api = this.api; const generation = this.generation;
> const abort = new AbortController(); this.read = abort;
> const timeout = setTimeout(() => abort.abort(), 10000);
> const current = () => generation === this.generation && this.online && this.read === abort;
> this.update({ loading: true });
> try {
> const sessions = await api.list(abort.signal);
> let selectedId = this.state.selectedId;
> if (selectedId && !sessions.some(s => s.id === selectedId)) {
> if (current()) this.update({ sessions, selectedId: null, messages: [], busy: false, waiting: false, error: 'sessionMissing', hasMore: false });
> return;
> }
> selectedId ??= sessions[0]?.id ?? null;
> const snapshot = selectedId ? await api.snapshot(selectedId, this.limit, abort.signal) : { messages: [], busy: false, waiting: false, hasMore: false };
> if (current()) this.update({ sessions, selectedId, ...snapshot, error: this.state.error === 'sendUncertain' || this.state.error === 'createUncertain' ? this.state.error : null });
> } catch { if (current()) this.update({ error: 'readFailed' }); }
> finally {
> clearTimeout(timeout);
> if (this.read === abort) { this.read = undefined; this.update({ loading: false }); if (this.dirty) this.invalidate(); }
> }
> }
> async select(id: string): Promise<void> {
> if (!this.state.sessions.some(session => session.id === id) || this.state.operation !== 'none') return;
> this.generation++; this.read?.abort(); this.read = undefined; this.limit = 100;
> this.update({ selectedId: id, messages: [], busy: false, waiting: false, error: null, submitted: null, hasMore: false });
> await this.refresh();
> }
> async older(): Promise<void> { this.limit = Math.min(1000, this.limit + 100); await this.refresh(); }
> private async mutate(operation: ChatState['operation'], work: (api: ConversationApi, signal: AbortSignal) => Promise<void>): Promise<void> {
> if (!this.online || !this.api || this.state.operation !== 'none') return;
> const abort = new AbortController(); this.mutation = abort;
> const api = this.api;
> const timeout = setTimeout(() => abort.abort(), 15000);
> this.update({ operation, error: null });
> try { await work(api, abort.signal); }
> catch {
> if (this.api === api && this.mutation === abort) this.update({ error: operation === 'sending' ? 'sendUncertain' : operation === 'creating' ? 'createUncertain' : 'stopFailed' });
> } finally {
> clearTimeout(timeout);
> if (this.mutation === abort) { this.mutation = undefined; this.update({ operation: 'none' }); this.invalidate(); }
> }
> }
> async create(): Promise<void> {
> await this.mutate('creating', async (api, signal) => {
> const session = await api.create(signal);
> if (this.api !== api || signal.aborted) return;
> this.generation++; this.read?.abort(); this.read = undefined; this.limit = 100;
> this.update({ sessions: [session, ...this.state.sessions.filter(s => s.id !== session.id)].slice(0, 100), selectedId: session.id, messages: [], busy: false, waiting: false, submitted: null });
> });
> }
> async send(id: string, text: string, requestId: string): Promise<void> {
> if (id !== this.state.selectedId || this.state.busy || this.state.waiting || this.state.loading || !text.trim() || text.length > 32000) return;
> const messageID = `msg_${Date.now().toString(16)}${randomBytes(12).toString('hex')}`;
> await this.mutate('sending', async (api, signal) => {
> await api.send(id, messageID, text, signal);
> if (this.api === api && !signal.aborted) this.update({ submitted: requestId, busy: true });
> });
> }
> async stop(id: string): Promise<void> {
> if (id !== this.state.selectedId) return;
> await this.mutate('stopping', async (api, signal) => { await api.stop(id, signal); });
> }
> }
> EOF``
>
> - Ran `python3 - <<'PY'
p='src/shared/chat.ts';s=open(p).read().replace('Object.keys(value).length !== 11','Object.keys(value).length !== 10');open(p,'w').write(s)
p='src/shared/protocol.ts';s=open(p).read();s="import { identifier, isChatState, type ChatState } from './chat';\n"+s
s=s.replace("export type WebviewMessage = { version: 1; type: typeof actions[number] };", "export type ConnectionAction = typeof actions[number];\nexport type ChatCommand = { version: 1; type: 'refresh' | 'newSession' | 'older' } | { version: 1; type: 'selectSession' | 'stop'; sessionId: string } | { version: 1; type: 'send'; sessionId: string; text: string; requestId: string };\nexport type WebviewMessage = { version: 1; type: ConnectionAction } | ChatCommand;")
s=s.replace("export type HostMessage = { version: 1; type: 'connection'; state: ConnectionState };", "export type HostMessage = { version: 1; type: 'connection'; state: ConnectionState } | { version: 1; type: 'chat'; state: ChatState };")
s=s.replace("  return hasExactKeys(value, ['version', 'type']) && value.version === 1 && actions.some((action) => action === value.type);", "  if (hasExactKeys(value, ['version', 'type'])) return value.version === 1 && [...actions, 'refresh', 'newSession', 'older'].some(action => action === value.type);\n  if (hasExactKeys(value, ['version', 'type', 'sessionId'])) return value.version === 1 && ['selectSession', 'stop'].includes(String(value.type)) && identifier(value.sessionId);\n  return hasExactKeys(value, ['version', 'type', 'sessionId', 'text', 'requestId']) && value.version === 1 && value.type === 'send' && identifier(value.sessionId) && identifier(value.requestId) && typeof value.text === 'string' && value.text.trim().length > 0 && value.text.length <= 32000;")
s=s.replace("  if (!hasExactKeys(value, ['version', 'type', 'state']) || value.version !== 1 || value.type !== 'connection') return false;", "  if (!hasExactKeys(value, ['version', 'type', 'state']) || value.version !== 1) return false;\n  if (value.type === 'chat') return isChatState(value.state);\n  if (value.type !== 'connection') return false;")
open(p,'w').write(s)
p='src/adapter/connection.ts';s=open(p).read().replace('  private listeners =', '  private eventListeners = new Set<(event: unknown) => void>();\n  onEvent(listener: (event: unknown) => void): () => void { this.eventListeners.add(listener); return () => this.eventListeners.delete(listener); }\n  private listeners =')
s=s.replace('this.listeners.clear(); }', 'this.listeners.clear(); this.eventListeners.clear(); }')
s=s.replace('          // Other events stay in the adapter. No tool actions or approvals in Phase 2.', '          if (current()) for (const listener of this.eventListeners) listener(event);')
open(p,'w').write(s)
p='src/extension/controller.ts';s=open(p).read().replace("import type { WebviewMessage }", "import type { ConnectionAction, ChatCommand }")
s=s.replace('export class Controller', "import { Chat } from '../adapter/chat';\nimport { createConversations } from '../adapter/conversations';\n\nexport class Controller")
s=s.replace('  readonly connection = new Connection();','  readonly connection = new Connection();\n  readonly chat = new Chat();')
s=s.replace('      // Only locally defined', "      this.chat.connection(state.phase === 'connected');\n      // Only locally defined")
s=s.replace('      { dispose: stop },','      { dispose: stop },\n      { dispose: this.connection.onEvent(event => this.chat.event(event)) },')
s=s.replace('private disconnect(): void { this.epoch++; this.connection.disconnect(); }', 'private disconnect(): void { this.epoch++; this.chat.clear(); this.connection.disconnect(); }')
s=s.replace("async action(type: WebviewMessage['type'])", 'async action(type: ConnectionAction)')
s=s.replace('      void this.connection.connect(transport);', "      this.chat.attach(createConversations({ baseUrl: url, directory: uri.fsPath, ...(credentials ? { credentials } : {}) }));\n      void this.connection.connect(transport);")
s=s.replace('  dispose(): void {', "  async conversation(command: ChatCommand): Promise<void> {\n    if (this.disposed || !vscode.workspace.isTrusted) return;\n    switch (command.type) {\n      case 'refresh': await this.chat.refresh(); break;\n      case 'newSession': await this.chat.create(); break;\n      case 'selectSession': await this.chat.select(command.sessionId); break;\n      case 'send': await this.chat.send(command.sessionId, command.text, command.requestId); break;\n      case 'stop': await this.chat.stop(command.sessionId); break;\n      case 'older': await this.chat.older(); break;\n    }\n  }\n  dispose(): void {")
s=s.replace('this.epoch++; this.connection.dispose();', 'this.epoch++; this.chat.dispose(); this.connection.dispose();');open(p,'w').write(s)
p='src/extension/activate.ts';s=open(p).read().replace('type HostMessage', 'type ChatCommand, type ConnectionAction, type HostMessage')
s=s.replace('      const unsubscribe = controller.connection.subscribe(send);', "      const sendChat = () => {\n        const message: HostMessage = { version: 1, type: 'chat', state: controller.chat.state };\n        void view.webview.postMessage(message).then(undefined, () => {});\n      };\n      const unsubscribeChat = controller.chat.subscribe(sendChat);\n      const unsubscribe = controller.connection.subscribe(send);")
s=s.replace("        if (message.type === 'ready') send();\n        else void controller.action(message.type);", "        if (message.type === 'ready') { send(); sendChat(); }\n        else if (actions.some(action => action === message.type)) void controller.action(message.type as ConnectionAction);\n        else void controller.conversation(message as ChatCommand);")
s=s.replace('unsubscribe(); listener.dispose();', 'unsubscribe(); unsubscribeChat(); listener.dispose();')
s=s.replace('context.subscriptions.push({ dispose: unsubscribe },', 'context.subscriptions.push({ dispose: unsubscribe }, { dispose: unsubscribeChat },');open(p,'w').write(s)
p='src/adapter/chat.ts';s=open(p).read().replace('      const sessions = await api.list(abort.signal);', '      const sessions = await api.list(abort.signal);\n      if (!current()) return;');open(p,'w').write(s)
PY
npm run typecheck`
>
> </details>
>
> The live checks found two details worth preserving: `promptAsync` returns **204 with no content type**, and the SDK’s `path` filter is not a directory filter. I’ve accounted for the empty prompt acknowledgment and will use the directory context plus validation of returned sessions.
>
> I’m now wiring session history and the composer into the sidebar. Text will update from coalesced server snapshots; prompt submissions won’t be automatically retried after an uncertain network failure.
>
> <details><summary>Ran 5 commands</summary>
>
> - Ran ``cat > src/webview/Markdown.tsx <<'EOF'
>   import { useRef, useState, type ComponentPropsWithoutRef } from 'react';
>   import ReactMarkdown from 'react-markdown';
>   import rehypeHighlight from 'rehype-highlight';
>   function CodeBlock({ children }: ComponentPropsWithoutRef<'pre'>) {
>   const ref = useRef<HTMLPreElement>(null);
>   const [label, setLabel] = useState('Copy code');
>   return <div className="code-block"><button onClick={() => {
>   void navigator.clipboard.writeText(ref.current?.textContent ?? '').then(() => setLabel('Copied'), () => setLabel('Select code to copy'));
>   }}>{label}</button><pre ref={ref}>{children}</pre></div>;
>   }
>   export function Markdown({ text }: { text: string }) {
>   return <ReactMarkdown skipHtml rehypePlugins={[rehypeHighlight]} components={{
>       pre: CodeBlock,
>       a: ({ children }) => <span>{children}</span>,
>       img: ({ alt }) => <span>[Image: {alt || 'attachment'}]</span>,
>     }}>{text}</ReactMarkdown>;
>   }
>   EOF
>   cat > src/webview/App.tsx <<'EOF'
>   import { useEffect, useRef, useState, type FormEvent } from 'react';
>   import { isHostMessage, type ConnectionAction, type WebviewMessage } from '../shared/protocol';
>   import { disconnected, errorMessages, type ConnectionState } from '../shared/connection';
>   import { chatErrors, emptyChat, type ChatState } from '../shared/chat';
>   import { Markdown } from './Markdown';
>
> export interface HostBridge { postMessage(message: WebviewMessage): void }
> export function App({ bridge }: { bridge: HostBridge }) {
> const [state, setState] = useState<ConnectionState>(disconnected);
> const [chat, setChat] = useState<ChatState>(emptyChat);
> const [drafts, setDrafts] = useState<Record<string, string>>({});
> const [pending, setPending] = useState(false);
> const submission = useRef<{ id: string; session: string; text: string } | null>(null);
> const conversation = useRef<HTMLElement>(null);
> const follow = useRef(true);
> const labels = { disconnected: 'Not connected', health: 'Checking server health…', sessions: 'Loading project sessions…', events: 'Subscribing to events…', connected: 'Connected', retrying: `Reconnecting (${state.attempt}/3)…`, error: 'Connection failed' };
> const active = !['disconnected', 'error'].includes(state.phase);
> const online = state.phase === 'connected';
> const action = (type: ConnectionAction | 'refresh' | 'newSession' | 'older') => bridge.postMessage({ version: 1, type });
> const draft = chat.selectedId ? drafts[chat.selectedId] ?? '' : '';
> const canSend = online && !!chat.selectedId && !chat.busy && !chat.waiting && !chat.loading && chat.operation === 'none' && !pending;
> useEffect(() => {
> const receive = (event: MessageEvent<unknown>) => {
> if (!isHostMessage(event.data)) return;
> if (event.data.type === 'connection') setState(event.data.state);
> else {
> const next = event.data.state;
> const sent = submission.current;
> if (sent && next.submitted === sent.id) {
> setDrafts(previous => previous[sent.session] === sent.text ? { ...previous, [sent.session]: '' } : previous);
> submission.current = null; setPending(false);
> } else if (next.operation === 'none' && (next.error || !next.selectedId)) { submission.current = null; setPending(false); }
> setChat(next);
> }
> };
> window.addEventListener('message', receive);
> bridge.postMessage({ version: 1, type: 'ready' });
> return () => window.removeEventListener('message', receive);
> }, [bridge]);
> useEffect(() => {
> if (follow.current && conversation.current) conversation.current.scrollTop = conversation.current.scrollHeight;
> }, [chat.messages]);
> function submit(event: FormEvent) {
> event.preventDefault();
> if (!canSend || !chat.selectedId || !draft.trim() || submission.current) return;
> const id = crypto.randomUUID();
> submission.current = { id, session: chat.selectedId, text: draft }; setPending(true);
> bridge.postMessage({ version: 1, type: 'send', sessionId: chat.selectedId, text: draft, requestId: id });
> }
> return <main className="shell" aria-label="OpenCode chat">
> <header className="header">
> <div className="session-row"><h1>OpenCode</h1><button disabled={!online || chat.operation !== 'none'} onClick={() => action('newSession')}>New session</button></div>
> <label className="session-label" htmlFor="session">Session</label>
> <select id="session" value={chat.selectedId ?? ''} disabled={!online || chat.operation !== 'none'} onChange={event => {
> follow.current = true; bridge.postMessage({ version: 1, type: 'selectSession', sessionId: event.target.value });
> }}><option value="" disabled>{chat.sessions.length ? 'Choose a session' : 'No sessions yet'}</option>{chat.sessions.map(session => <option key={session.id} value={session.id}>{session.title}</option>)}</select>
> <p className="status" role="status"><span className="status-dot" aria-hidden="true" />{labels[state.phase]}</p>
> <div className="connection-actions">
> <button onClick={() => action(active ? 'disconnect' : 'connect')}>{active ? 'Disconnect' : 'Connect'}</button>
> <button disabled={!online || chat.loading} onClick={() => action('refresh')}>Refresh</button>
> <details><summary>Connection options</summary><div className="connection-actions">
> <button onClick={() => action('configure')}>Server URL</button>
> <button onClick={() => action('credentials')}>Set credentials</button>
> <button onClick={() => action('clearCredentials')}>Clear credentials</button>
> <button onClick={() => action('diagnostics')}>Diagnostics</button>
> </div></details>
> </div>
> {state.error && <p className="connection-error" role="alert">{errorMessages[state.error]}</p>}
> {chat.error && <p className="connection-error" role="alert">{chatErrors[chat.error]} <button disabled={!online} onClick={() => action('refresh')}>Retry loading</button></p>}
> </header>
> <section ref={conversation} className="conversation" aria-label="Conversation" aria-busy={chat.loading} onScroll={() => {
> const element = conversation.current; if (element) follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
> }}>
> {chat.hasMore && <button disabled={!online || chat.loading} onClick={() => { follow.current = false; action('older'); }}>Load earlier messages</button>}
> {!chat.messages.length && <div className="empty-state"><span className="eyebrow">OPENCODE IN YOUR IDE</span><h2>{chat.selectedId ? 'Start a conversation' : 'Your project conversations'}</h2><p>{online ? 'Choose a session or create a new one. OpenCode runs on your existing server.' : 'Connect to OpenCode to resume your project sessions.'}</p></div>}
> <ol className="messages" aria-label="Messages">{chat.messages.map(message => <li key={message.id} className={`message ${message.role}`}>
> <div className="message-meta"><strong>{message.role === 'user' ? 'You' : 'OpenCode'}</strong><span>{message.status}</span></div>
> <Markdown text={message.text} />
> {message.otherParts && <p className="phase-note">This message includes non-text activity. Review details in OpenCode.</p>}
> </li>)}</ol>
> {chat.waiting && <p role="alert" className="permission-note">OpenCode is waiting for permission. Review the request in the CLI, or stop this response. This preview never approves requests.</p>}
> {chat.busy && <p role="status">OpenCode is working…</p>}
> </section>
> <form className="composer" onSubmit={submit}>
> <label htmlFor="prompt">Message OpenCode</label>
> <textarea id="prompt" rows={3} maxLength={32000} value={draft} disabled={!online || !chat.selectedId} placeholder="Ask about your project" aria-describedby="composer-help" onChange={event => {
> if (chat.selectedId) setDrafts(previous => ({ ...previous, [chat.selectedId!]: event.target.value }));
> }} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) submit(event); }} />
> <div className="composer-actions"><span id="composer-help">Ctrl/Cmd+Enter to send · Shift+Enter for a new line</span>
> {chat.selectedId && (chat.busy || chat.waiting) && <button type="button" disabled={!online || chat.operation !== 'none'} onClick={() => bridge.postMessage({ version: 1, type: 'stop', sessionId: chat.selectedId! })}>Stop</button>}
> <button type="submit" disabled={!canSend || !draft.trim()}>{chat.operation === 'sending' ? 'Sending…' : 'Send'}</button></div>
> </form>
>
>   </main>;
> }
> EOF
> cat >> src/webview/style.css <<'EOF'
> select { width: 100%; min-width: 0; padding: 5px; color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border)); font: inherit; }
> .session-label { margin-top: 10px; font-size: .85rem; color: var(--vscode-descriptionForeground); }
> .message { border-bottom: 1px solid var(--vscode-panel-border); padding: 12px 0; overflow-wrap: anywhere; }
> .message-meta { display: flex; gap: 8px; align-items: baseline; color: var(--vscode-descriptionForeground); font-size: .85rem; }
> .message-meta strong { color: var(--vscode-foreground); }
> .message p { margin: 8px 0; }
> .message pre { overflow-x: auto; padding: 10px; margin: 0; background: var(--vscode-textCodeBlock-background); }
> .message code { font-family: var(--vscode-editor-font-family, monospace); font-size: .95em; }
> .code-block { border: 1px solid var(--vscode-panel-border); margin: 12px 0; min-width: 0; }
> .code-block > button { margin: 4px; }
> .message blockquote { margin: 8px 0; border-left: 3px solid var(--vscode-textBlockQuote-border); padding-left: 10px; }
> .message ul, .message ol { padding-left: 20px; }
> .permission-note { border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border)); padding: 8px; }
> .hljs-keyword, .hljs-selector-tag, .hljs-built_in { color: var(--vscode-symbolIcon-keywordForeground, var(--vscode-foreground)); font-weight: bold; }
> .hljs-string, .hljs-attr { color: var(--vscode-symbolIcon-stringForeground, var(--vscode-foreground)); }
> .hljs-number, .hljs-literal { color: var(--vscode-symbolIcon-numberForeground, var(--vscode-foreground)); }
> .hljs-comment { color: var(--vscode-descriptionForeground); font-style: italic; }
> EOF
> npm run typecheck``
> - Ran ``cat > scripts/test-conversations.ts <<'EOF'
> import assert from 'node:assert/strict';
> import { spawn } from 'node:child_process';
> import { once } from 'node:events';
> import { mkdir } from 'node:fs/promises';
> import { join } from 'node:path';
> import { setTimeout as pause } from 'node:timers/promises';
> import { Chat } from '../src/adapter/chat';
> import { Connection } from '../src/adapter/connection';
> import { createConversations } from '../src/adapter/conversations';
> import { createTransport } from '../src/adapter/transport';
> import { modelFixture } from './fixtures/model';
> import { isolatedServer } from './fixtures/server';
> const model = await modelFixture();
> const server = await isolatedServer(model.config);
> const options = { baseUrl: server.baseUrl, directory: server.project, credentials: server.credentials };
> const chat = new Chat(50);
> const connection = new Connection();
> connection.subscribe(state => chat.connection(state.phase === 'connected'));
> connection.onEvent(event => chat.event(event));
> const lengths = new Set<number>();
> chat.subscribe(() => { const last = chat.state.messages.at(-1); if (last?.role === 'assistant') lengths.add(last.text.length); });
> async function waitFor(predicate: () => boolean, label: string) {
>   for (let count = 0; count < 400; count++) { if (predicate()) return; await pause(50); }
>   throw new Error(`Timed out: ${label}; connection=${connection.state.phase}; chat=${chat.state.error}; busy=${chat.state.busy}; messages=${chat.state.messages.length}`);
> }
> async function cli(args: string[]) {
>   const process = spawn('opencode', ['run', '--attach', server.baseUrl, '--dir', server.project, '--format', 'json', ...args], { env: server.env, stdio: ['ignore', 'pipe', 'pipe'] });
>   process.stdout.resume(); process.stderr.resume();
>   const timer = setTimeout(() => process.kill('SIGTERM'), 20000);
>   try { const [code] = await once(process, 'exit'); assert.equal(code, 0); } finally { clearTimeout(timer); }
> }
> try {
>   await server.start();
>   const otherDir = join(server.root, 'other'); await mkdir(otherDir);
>   const other = await createConversations({ ...options, directory: otherDir }).create(AbortSignal.timeout(10000));
>   const api = createConversations(options);
>   assert.equal((await api.list(AbortSignal.timeout(10000))).some(s => s.id === other.id), false, 'directory isolation');
>   chat.attach(api); void connection.connect(createTransport(options));
>   await waitFor(() => connection.state.phase === 'connected', 'connected');
>   await chat.create();
>   const first = chat.state.selectedId!; assert.ok(first);
>   await waitFor(() => !chat.state.loading && chat.state.operation === 'none', 'ready');
>   await chat.send(first, 'Say hello without tools.', 'req_first');
>   await waitFor(() => chat.state.messages.some(m => m.role === 'assistant' && m.status === 'complete') && !chat.state.busy && !chat.state.loading, 'first response');
>   assert.ok(lengths.size >= 2, 'multiple streamed snapshots');
>   assert.equal(chat.state.messages.length, 2);
>   assert.match(chat.state.messages[1]!.text, /Fixture reply/);
>   assert.equal(chat.state.submitted, 'req_first');
>   console.log('PASS: directory scope, create/select, prompt, incremental text snapshots');
>
> await cli(['--title', 'CLI fixture', 'Say hello without tools.']);
> await chat.refresh();
> const fromCli = chat.state.sessions.find(s => s.title === 'CLI fixture'); assert.ok(fromCli, 'CLI-created session appears in same directory');
> await chat.select(fromCli.id);
> assert.equal(chat.state.messages.length, 2, 'CLI history is resumable');
> await cli(['--session', first, 'Continue with another hello, no tools.']);
> await chat.select(first);
> assert.equal(chat.state.messages.length, 4, 'CLI continued the IDE-created session');
> console.log('PASS: CLI-created session resume and CLI continuation of IDE-created session');
>
> await waitFor(() => !chat.state.loading, 'ready for reconnect test');
> await chat.send(first, 'Say hello again, no tools.', 'req_reconnect');
> await waitFor(() => chat.state.messages.length >= 6 && chat.state.messages.at(-1)?.status === 'streaming', 'streaming before disconnect');
> connection.disconnect();
> await pause(1600);
> void connection.connect(createTransport(options));
> await waitFor(() => connection.state.phase === 'connected' && chat.state.messages.length === 6 && chat.state.messages.at(-1)?.status === 'complete' && !chat.state.loading, 'reconnect snapshot');
> assert.equal(new Set(chat.state.messages.map(m => m.id)).size, 6, 'no duplicate messages after resync');
> console.log('PASS: reconnect resynchronizes completed history without duplicated messages');
>
> await chat.send(first, 'Say hello slowly without tools.', 'req_stop');
> await waitFor(() => chat.state.messages.length >= 8 && chat.state.messages.at(-1)?.status === 'streaming', 'streaming before stop');
> await chat.stop(first);
> await waitFor(() => !chat.state.busy && !chat.state.loading, 'stop completed');
> assert.equal(chat.state.messages.at(-1)?.status, 'stopped');
> await chat.select(fromCli.id); assert.equal(chat.state.messages.length, 2);
> await chat.select(first); assert.equal(chat.state.messages.length, 8);
> console.log('PASS: stop/abort and session switching; only real OpenCode agent/session APIs used');
> } finally { connection.dispose(); chat.dispose(); await server.stop(); await model.stop(); }
> EOF
> python3 - <<'PY'
> import json
> p='package.json';d=json.load(open(p));d['scripts']['test:conversations']='tsx scripts/test-conversations.ts';open(p,'w').write(json.dumps(d,indent=2)+'\n')
> PY``
>
> - Ran `npm run test:conversations`
> - Ran `npm run check`
> - Ran ``/usr/bin/zsh -lc "python3 - <<'PY'
p='tests/extension.test.ts';s=open(p).read().replace(\"  assert.equal(JSON.stringify(sent), '[{\\\"version\\\":1,\\\"type\\\":\\\"connection\\\",\\\"state\\\":{\\\"phase\\\":\\\"disconnected\\\",\\\"attempt\\\":0,\\\"error\\\":null}}]');\", \"  assert.equal(sent.length, 2);\\n  assert.equal(JSON.stringify(sent[0]), '{\\\"version\\\":1,\\\"type\\\":\\\"connection\\\",\\\"state\\\":{\\\"phase\\\":\\\"disconnected\\\",\\\"attempt\\\":0,\\\"error\\\":null}}');\\n  assert.equal((sent[1] as { type: string }).type, 'chat');\")
open(p,'w').write(s)
p='src/adapter/chat.ts';s=open(p).read().replace(\"if (id "'!== this.state.selectedId || this.state.busy", "if (requestId === this.state.submitted || id !== this.state.selectedId || this.state.busy");open(p,'"'w').write(s)
p='src/webview/App.tsx';s=open(p).read().replace('        <Markdown text={message.text} />', '        <Markdown text={message.text} />\\n        {message.status === \\'failed\\' && <p className=\"connection-error\">OpenCode could not complete this response. Check the server/provider and send a follow-up.</p>}')
s=s.replace(\"<button onClick={() => action(active ? 'disconnect' : 'connect')}>\", \"<button title={active ? 'Disconnect updates; use Stop to cancel a running response' : 'Connect to OpenCode'} onClick={() => action(active ? 'disconnect' : 'connect')}>\");open(p,'w').write(s)
PY
cat > tests/chat.test.ts <<'EOF'
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { Chat } from '../src/adapter/chat';
import { projectMessages, sessionSummary, type ConversationApi } from '../src/adapter/conversations';
import { emptyChat, isChatState, type ChatMessage } from '../src/shared/chat';
import { isHostMessage, isWebviewMessage } from '../src/shared/protocol';
const text = (id: string, content: string): ChatMessage => ({ id, role: 'assistant', text: content, status: 'complete', otherParts: false });
function api(patch: Partial<ConversationApi> = {}): ConversationApi {
  return { list: async () => [{ id: 'ses_a', title: 'A' }, { id: 'ses_b', title: 'B' }], create: async () => ({ id: 'ses_new', title: 'New' }), snapshot: async id => ({ messages: [text("'`msg\_${id}`, id)], busy: false, waiting: false, hasMore: false }), send: async () => {}, stop: async () => {}, ...patch };
>   }
>   async function setup(source: ConversationApi) { const chat = new Chat(1); chat.attach(source); chat.connection(true); await chat.refresh(); return chat; }
>
> test('"'projection deduplicates IDs and omits server paths, tool payloads and errors', () => {
> const info = { id: 'msg*a', sessionID: 'ses_a', role: 'assistant', time: { completed: 1 }, path: '/private', error: { name: 'MessageAbortedError', data: { message: 'token' } } };
> const part = { id: 'prt_a', sessionID: 'ses_a', messageID: 'msg_a', type: 'text', text: '**Hello**' };
> const result = projectMessages([{ info, parts: [part, part, { ...part, id: 'prt_tool', type: 'tool', secret: 'token' }] }, { info, parts: [part] }], 'ses_a');
> assert.equal(result.length, 1); assert.equal(result[0]?.text, '**Hello**'); assert.equal(result[0]?.status, 'stopped');
> assert.doesNotMatch(JSON.stringify(result), /private|token/);
> assert.throws(() => projectMessages([{ info, parts: [{ ...part, sessionID: 'ses_other' }] }], 'ses_a'));
> assert.throws(() => sessionSummary({ id: 'ses_a', title: 'A', directory: '/other' }, '/project'));
> });
> test('session switching rejects stale history and unknown session IDs', async () => {
> let release"'!: (value: Awaited<ReturnType<ConversationApi['"'snapshot']>>) => void;
> let delayed = false;
> const chat = await setup(api({ snapshot: async id => delayed && id === 'ses_a' ? new Promise(resolve => { release = resolve; }) : ({ messages: [text("'`msg*${id}`, id)], busy: false, waiting: false, hasMore: false }) }));
> try {
> delayed = true;
> const old = chat.refresh(); await pause(0);
> await chat.select('"'ses_b'); release({ messages: [text('msg_stale', 'wrong session')], busy: false, waiting: false, hasMore: false }); await old;
> assert.equal(chat.state.selectedId, 'ses_b'); assert.equal(chat.state.messages[0]?.text, 'ses_b');
> await chat.select('ses_unknown'); assert.equal(chat.state.selectedId, 'ses_b');
> } finally { chat.dispose(); }
> });
> test('event bursts and reconnect replace snapshots instead of accumulating duplicates', async () => {
> let snapshots = 0;
> const chat = await setup(api({ snapshot: async () => { snapshots++; return { messages: [text('msg_a', 'latest')], busy: false, waiting: false, hasMore: false }; } }));
> try {
> for (let n = 0; n < 100; n++) chat.event({ type: 'message.part.delta', properties: { sessionID: 'ses_a', delta: 'ignored' } });
> await pause(20);
> assert.equal(snapshots, 2); assert.equal(chat.state.messages.length, 1);
> chat.connection(false); chat.connection(true); await chat.refresh();
> assert.equal(chat.state.messages.length, 1); assert.equal(chat.state.messages[0]?.text, 'latest');
> } finally { chat.dispose(); }
> });
> test('a failed mutation is not retried automatically and raw errors stay private', async () => {
> let sends = 0;
> const chat = await setup(api({ send: async () => { sends++; throw new Error('secret prompt /private/token'); } }));
> try {
> await chat.send('ses_wrong', 'test', 'request'); assert.equal(sends, 0);
> await chat.send('ses_a', 'test', 'request');
> assert.equal(sends, 1); assert.equal(chat.state.error, 'sendUncertain');
> await chat.refresh(); assert.equal(sends, 1);
> assert.doesNotMatch(JSON.stringify(chat.state), /secret|private|token/);
> } finally { chat.dispose(); }
> });
> test('busy sessions cannot submit another prompt; Stop targets the selected session', async () => {
> let sends = 0; let stopped: string | undefined;
> const chat = await setup(api({ snapshot: async () => ({ messages: [], busy: true, waiting: true, hasMore: false }), send: async () => { sends++; }, stop: async id => { stopped = id; } }));
> try {
> await chat.send('ses_a', 'test', 'request'); assert.equal(sends, 0);
> await chat.stop('ses_other'); assert.equal(stopped, undefined);
> await chat.stop('ses_a'); assert.equal(stopped, 'ses_a');
> } finally { chat.dispose(); }
> });
> test('disconnect clears project data and late mutation results cannot restore it', async () => {
> let finish"'!: () => void;
> const chat = await setup(api({ send: () => new Promise<void>(resolve => { finish = resolve; }) }));
> const sending = chat.send('"'ses_a', 'test', 'request'); chat.clear(); finish(); await sending;
> assert.deepEqual(chat.state, emptyChat()); chat.dispose();
> });
> test('protocol validates chat states and rejects arbitrary IDs, commands and oversized prompts', () => {
> assert.equal(isChatState(emptyChat()), true);
> assert.equal(isHostMessage({ version: 1, type: 'chat', state: emptyChat() }), true);
> assert.equal(isWebviewMessage({ version: 1, type: 'send', sessionId: 'ses_a', requestId: 'req_a', text: 'hello' }), true);
> for (const value of [
> > { version: 1, type: 'send', sessionId: '../other', requestId: 'req_a', text: 'hello' },
> > { version: 1, type: 'send', sessionId: 'ses_a', requestId: 'req_a', text: 'x'.repeat(32001) },
> > { version: 1, type: 'send', sessionId: 'ses_a', requestId: 'req_a', text: ' ' },
> > { version: 1, type: 'selectSession', sessionId: 'ses_a', credentials: 'bad' },
> > { version: 1, type: 'approve', sessionId: 'ses_a' },
> > ]) assert.equal(isWebviewMessage(value), false);
> assert.equal(isChatState({ ...emptyChat(), token: 'bad' }), false);
> assert.equal(isChatState({ ...emptyChat(), messages: [{ ...text('msg_a', 'hi'), path: '/private' }] }), false);
> });
> EOF
> npm run check"``
>
> </details>
>
> System error
>
> You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 5:31 PM.

</details>
