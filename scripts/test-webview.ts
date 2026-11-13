import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { webviewHtml } from '../src/extension/html';

const output = await mkdtemp(join(tmpdir(), 'sidecode-webview-'));
const browser = await chromium.launch({ executablePath: process.env.SIDECODE_CHROME || '/usr/bin/google-chrome', headless: true });
const themes = [
  { name: 'vscode-dark', background: '#181818', foreground: '#cccccc', input: '#313131', border: '#454545' },
  { name: 'vscode-light', background: '#f8f8f8', foreground: '#3b3b3b', input: '#ffffff', border: '#cecece' },
  { name: 'vscode-high-contrast', background: '#000000', foreground: '#ffffff', input: '#000000', border: '#ffffff' },
  { name: 'vscode-high-contrast-light', background: '#ffffff', foreground: '#292929', input: '#ffffff', border: '#292929' },
];
try {
  for (const theme of themes) for (const width of [200, 240, 320, 480]) {
    const page = await browser.newPage({ viewport: { width, height: 600 }, reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    const css = await readFile('dist/webview.css', 'utf8');
    const tokens = `:root { --vscode-font-family: sans-serif; --vscode-sideBar-background: ${theme.background}; --vscode-foreground: ${theme.foreground}; --vscode-descriptionForeground: ${theme.foreground}; --vscode-input-background: ${theme.input}; --vscode-input-foreground: ${theme.foreground}; --vscode-input-placeholderForeground: ${theme.foreground}; --vscode-panel-border: ${theme.border}; --vscode-contrastBorder: ${theme.border}; --vscode-button-secondaryBackground: ${theme.input}; --vscode-button-background: #0e639c; --vscode-button-foreground: #ffffff; --vscode-disabledForeground: ${theme.foreground}; }`;
    const html = webviewHtml({ script: 'https://sidecode.test/webview.js', style: 'https://sidecode.test/webview.css', source: 'https://sidecode.test', nonce: 'test-nonce' }).replace('<body>', `<body class="${theme.name}">`);
    await page.route('**/*', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/') await route.fulfill({ contentType: 'text/html', body: html });
      else if (path === '/webview.js') await route.fulfill({ contentType: 'text/javascript', body: await readFile('dist/webview.js', 'utf8') });
      else if (path === '/webview.css') await route.fulfill({ contentType: 'text/css', body: tokens + css });
      else { errors.push('Unexpected resource request'); await route.abort(); }
    });
    await page.addInitScript(`window.sentActions = []; window.sentMessages = []; window.acquireVsCodeApi = () => ({ postMessage: (message) => {
      window.sentActions.push(message.type); window.sentMessages.push(message);
      if (message.type === 'ready') queueMicrotask(() => window.postMessage({ version: 1, type: 'connection', state: { phase: 'disconnected', attempt: 0, error: null } }, '*'));
    } });`);
    await page.goto('https://sidecode.test/');
    await page.getByRole('status').filter({ hasText: 'Not connected' }).waitFor({ timeout: 5000 }).catch(async (error) => { console.error(errors, await page.locator('body').innerText()); throw error; });
    assert.equal(await page.getByLabel('Message OpenCode', { exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${theme.name} ${width}: horizontal overflow`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight), true, 'page should fit viewport');
    assert.deepEqual(errors, []);
    if (width === 320) await page.screenshot({ path: join(output, `${theme.name}.png`) });
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    assert.ok((await page.evaluate<string[]>('window.sentActions')).includes('connect'));
    await page.evaluate(() => window.postMessage({ version: 1, type: 'connection', state: { phase: 'connected', attempt: 0, error: null } }, '*'));
    // Populated conversation: untrusted Markdown, long lines, busy + permission-waiting session.
    const untrusted = 'Reply with <script>window.injected = 1</script><img src="https://evil.test/x.png" onerror="window.injected = 2"> [link](https://evil.test) ![pic](https://evil.test/p.png) ' + 'unbroken'.repeat(40) + '\n\n```ts\nconst line = "' + 'x'.repeat(300) + '";\n```';
    const chatState = (busy: boolean) => ({ sessions: [{ id: 'ses_a', title: 'A very long session title '.repeat(6), edit: null }], selectedId: 'ses_a', messages: [
      { id: 'msg_u', role: 'user', text: 'Hello', status: 'sent', otherParts: false, reasoning: '', time: { created: 1794537780961, completed: 1794537782961 }, tokens: null, kind: 'message', tools: [], attachments: [{ kind: 'file', label: 'src/' + 'deeply/nested/'.repeat(12) + 'file.ts' }, { kind: 'selection', label: '<img src=x onerror="window.injected=4">:1-3' }] },
      { id: 'msg_a', role: 'assistant', text: untrusted, status: busy ? 'streaming' : 'complete', otherParts: true, attachments: [], reasoning: 'Planning: <b>check</b> the build first. ' + 'thinking '.repeat(40), time: { created: 1794537780961, completed: 1794537782961 }, tokens: null, kind: 'message', tools: [
        { id: 'prt_t1', tool: 'bash', status: 'completed', title: 'cat ' + 'very/long/path/'.repeat(20), detail: '<img src=x onerror="window.injected=3">\n' + 'y'.repeat(3000), change: null, started: null },
        { id: 'prt_t3', tool: 'edit', status: 'completed', title: 'src/app.ts', detail: 'Edit applied successfully.', change: { label: 'src/app.ts', additions: 1, deletions: 1, diff: true }, started: null },
        { id: 'prt_t4', tool: 'write', status: 'completed', title: 'notes.md', detail: '', change: { label: '<b>notes</b>.md', additions: 0, deletions: 0, diff: false }, started: null },
        { id: 'prt_t2', tool: 'bash', status: busy ? 'running' : 'error', title: 'rm -rf build', detail: busy ? '' : 'The user rejected permission', change: null, started: null },
      ] },
    ], permissions: busy ? [{ id: 'per_a', permission: 'bash', patterns: ['rm -rf build ' + 'z'.repeat(200)], always: ['rm *'], change: null }, { id: 'per_e', permission: 'edit', patterns: ['src/app.ts'], always: ['*'], change: { label: 'src/' + 'long/'.repeat(20) + 'app.ts', additions: 12, deletions: 3, diff: true } }] : [],
      context: busy ? [] : [{ id: 'ctx_a', kind: 'file', label: 'src/components/' + 'VeryLongComponentName'.repeat(4) + '.tsx', note: 'Unsaved changes are not included; OpenCode reads the saved file.' }, { id: 'ctx_b', kind: 'folder', label: 'src/', note: '' }],
      agents: [{ name: 'build', description: 'Default agent' }, { name: 'plan', description: '' }, { name: 'a-very-long-custom-agent-name-'.repeat(3), description: '<b>untrusted</b>' }],
      models: [{ providerID: 'local', modelID: 'small', name: 'Small local model', provider: 'Local', context: 8192 }, { providerID: 'local', modelID: 'second', name: 'Second model with a very long display name '.repeat(2), provider: 'Local', context: 32768 }, { providerID: 'remote', modelID: 'vendor/m:free', name: 'Remote free', provider: 'Remote <b>provider</b>', context: null }],
      used: { agent: 'plan', model: { providerID: 'local', modelID: 'second' } }, retry: null, editPolicy: null, busy, waiting: busy, loading: false, operation: 'none', error: null, submitted: null, hasMore: true });
    await page.evaluate((state) => window.postMessage({ version: 1, type: 'chat', state }, '*'), chatState(true));
    await page.locator('.code-block').waitFor({ timeout: 5000 }).catch(async (error) => { console.error('page errors:', errors, '\nBODY:', (await page.locator('body').innerText()).slice(0, 600)); throw error; });
    assert.equal(await page.locator('.messages a, .messages img, .messages script, .messages [onerror]').count(), 0, 'untrusted links/images/HTML rendered');
    assert.equal(await page.evaluate('window.injected'), undefined);
    await page.getByRole('region', { name: 'Permission requested' }).first().waitFor();
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.permission')), false, 'focus never moved into the permission card (no accidental Enter approval)');
    // Edit permission: proposed change summary and a Review button that only opens views.
    const editCard = page.locator('.permission').filter({ hasText: 'wants to edit' });
    assert.match(await editCard.innerText(), /\+12[\s\S]*−3/);
    await editCard.getByRole('button', { name: 'Review changes', exact: true }).click();
    const reviewMessage = (await page.evaluate<{ type: string; requestId?: string }[]>('window.sentMessages')).at(-1);
    assert.deepEqual([reviewMessage?.type, reviewMessage?.requestId], ['reviewPermission', 'per_e']);
    assert.equal(await page.locator('.permission').filter({ hasText: 'bash' }).getByRole('button', { name: 'Review changes' }).count(), 0, 'no review for non-edit requests');
    assert.equal(await page.locator('.tool').count(), 4);
    // Step group: each step shows its own state; the held tool is "waiting", the group stays open.
    await page.locator('.steps-summary').filter({ hasText: /^4 steps · waiting for you$/ }).waitFor({ timeout: 2000 });
    assert.deepEqual(await page.locator('.tool').evaluateAll(items => items.map(item => item.getAttribute('data-status'))), ['done', 'done', 'done', 'waiting']);
    assert.equal(await page.locator('.steps').getAttribute('open'), '', 'active group open');
    // While disconnected a running step is unknown, not "running".
    await page.evaluate(() => window.postMessage({ version: 1, type: 'connection', state: { phase: 'retrying', attempt: 2, error: null } }, '*'));
    await page.getByText('Updates are paused', { exact: false }).waitFor();
    await page.locator('.steps-summary').filter({ hasText: /^4 steps · updates paused$/ }).waitFor({ timeout: 2000 });
    await page.evaluate(() => window.postMessage({ version: 1, type: 'connection', state: { phase: 'connected', attempt: 0, error: null } }, '*'));
    // Completed edit/write rows: label + counts; Show changes only when a diff can be built.
    await page.getByRole('button', { name: 'Show changes to src/app.ts', exact: true }).click();
    await page.getByRole('button', { name: 'Open <b>notes</b>.md', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Show changes to <b>notes</b>.md' }).count(), 0);
    assert.equal(await page.locator('.tool b').count(), 0, 'labels stay text');
    const opened = (await page.evaluate<{ type: string; toolId?: string; view?: string }[]>('window.sentMessages')).filter(m => m.type === 'openChange').map(m => `${m.toolId}:${m.view}`);
    assert.deepEqual(opened, ['prt_t3:diff', 'prt_t4:file']);
    await page.locator('.tool summary').first().click();
    assert.equal(await page.locator('.tool img, .tool [onerror]').count(), 0, 'tool output rendered as text');
    await page.locator('.permission').filter({ hasText: 'bash' }).getByText('More options', { exact: true }).click();
    await page.getByText('still applies after a restart', { exact: false }).first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${theme.name} ${width}: permission/tool overflow`);
    await page.locator('.permission').filter({ hasText: 'bash' }).getByRole('button', { name: 'Allow once', exact: true }).click();
    assert.ok((await page.evaluate<string[]>('window.sentActions')).includes('permission'));
    assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).isEnabled(), true);
    await page.getByLabel('Message OpenCode', { exact: true }).fill('Next question');
    assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).count(), 0, 'Stop replaces Send while busy');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${theme.name} ${width}: conversation overflow`);
    if (width === 240) await page.screenshot({ path: join(output, `${theme.name}-chat.png`) });
    await page.evaluate((state) => window.postMessage({ version: 1, type: 'chat', state }, '*'), chatState(false));
    // Screen readers hear that the run ended (busy → idle), not the whole reply.
    await page.locator('[data-testid="announcement"]').filter({ hasText: /^OpenCode finished replying\.$/ }).waitFor({ timeout: 2000 });
    // Finished run folds to a summary that counts failures; changed files stay visible outside it.
    await page.locator('.steps-summary').filter({ hasText: /^4 steps · 1 failed$/ }).waitFor({ timeout: 2000 });
    assert.equal(await page.locator('.steps').getAttribute('open'), null, 'finished group folded');
    assert.equal(await page.locator('.tool').last().getAttribute('data-status'), 'failed');
    await page.getByRole('button', { name: 'Show changes to src/app.ts', exact: true }).waitFor();
    if (width === 320) await page.screenshot({ path: join(output, `${theme.name}-done.png`) });
    // Keyboard only: every control is reachable with Tab, in a sensible order, and shows a focus indicator.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const visited: { name: string; ring: boolean }[] = [];
    for (let count = 0; count < 120; count++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        const name = el.getAttribute('aria-label') || (el.id && ['SELECT', 'TEXTAREA'].includes(el.tagName) ? `#${el.id}` : (el.textContent ?? '').trim().slice(0, 40));
        // The message box shows focus on its rounded container.
        const ring = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || (el.tagName === 'TEXTAREA' && el.closest('.box')!.matches(':focus-within'));
        return { name, ring };
      });
      if (!info || (visited.length && info.name === visited[0]!.name)) break;
      visited.push(info);
    }
    const names = visited.map(v => v.name);
    const order = ['Session', 'New session', 'Connection options', '#prompt', 'Add context', 'Agent', 'Model', 'Send'];
    let cursor = -1;
    for (const name of order) { const at = names.indexOf(name, cursor + 1); assert.ok(at > cursor, `${theme.name} ${width}: Tab reaches ${name} in order; got ${names.join(' | ')}`); cursor = at; }
    for (const name of ['Show changes to src/app.ts', 'Remove src/']) assert.ok(names.includes(name), `Tab reaches ${name}`);
    assert.deepEqual(visited.filter(v => !v.ring).map(v => v.name), [], `${theme.name} ${width}: every focused control shows a focus indicator`);
    // Escape closes menus from their button or contents and returns focus to the button.
    const menuToggle = page.getByRole('button', { name: 'Connection options', exact: true });
    await menuToggle.focus(); await page.keyboard.press('Enter');
    assert.equal(await menuToggle.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('#connection-menu')), true, 'Tab moves into the open menu');
    await page.keyboard.press('Escape');
    assert.equal(await menuToggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Connection options', 'focus returns to the menu button');
    const plus = page.getByRole('button', { name: 'Add context', exact: true });
    await plus.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
    assert.equal(await plus.getAttribute('aria-expanded'), 'false'); assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Add context');
    // Reduced motion (this page emulates it): no spinner or cursor animation.
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.mark, .caret')].every(el => getComputedStyle(el).animationName === 'none' && getComputedStyle(el, '::after').animationName === 'none')), true);
    // High contrast: no shadows; contrast borders on cards and bubbles.
    if (theme.name.includes('high-contrast')) assert.equal(await page.evaluate(() => [...document.querySelectorAll('.permission, .message.user, .steps')].every(el => getComputedStyle(el).boxShadow === 'none' && getComputedStyle(el).borderStyle !== 'none')), true, 'high-contrast borders');
    // Selectors start from the session's last-used agent/model and send explicit choices.
    const agentSelect = page.getByLabel('Agent', { exact: true }); const modelSelect = page.getByLabel('Model', { exact: true });
    assert.equal(await agentSelect.inputValue(), 'plan');
    assert.equal(await modelSelect.locator('option:checked').textContent(), 'Second model with a very long display name '.repeat(2));
    assert.equal(await modelSelect.locator('optgroup').count(), 2); assert.equal(await page.locator('.toolbar b').count(), 0);
    await agentSelect.selectOption('build');
    // Context: explicit buttons, removable chips with labels only, attachment chips on history.
    assert.equal(await page.locator('.message.user .chip').count(), 2); assert.equal(await page.evaluate('window.injected'), undefined);
    const pendingList = page.getByRole('list', { name: 'Context for the next message' });
    assert.equal(await pendingList.getByRole('listitem').count(), 2);
    await pendingList.getByText('Unsaved changes are not included', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Add context', exact: true }).click();
    await page.getByRole('group', { name: 'Add context' }).getByRole('button', { name: 'Selection', exact: true }).click();
    assert.equal(await page.getByRole('group', { name: 'Add context' }).count(), 0, 'context menu closes after a choice');
    await page.getByRole('button', { name: 'Remove src/', exact: true }).click();
    const contextMessages = (await page.evaluate<{ type: string; source?: string; contextId?: string }[]>('window.sentMessages')).filter(m => m.type === 'addContext' || m.type === 'removeContext');
    assert.deepEqual(contextMessages.slice(-2).map(m => m.source ?? m.contextId), ['selection', 'ctx_b']);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${theme.name} ${width}: selector overflow`);
    // Enter sends; Shift+Enter adds a line and does not send. The send button is primary-colored.
    const promptBox = page.getByLabel('Message OpenCode', { exact: true });
    const sends = async () => (await page.evaluate<{ type: string }[]>('window.sentMessages')).filter(m => m.type === 'send').length;
    const beforeSend = await sends();
    await promptBox.press('Shift+Enter');
    assert.equal(await sends(), beforeSend, 'Shift+Enter does not send');
    assert.match(await promptBox.inputValue(), /\n$/);
    const sendColors = await page.getByRole('button', { name: 'Send', exact: true }).evaluate(el => [getComputedStyle(el).backgroundColor, getComputedStyle(document.body).backgroundColor]);
    assert.notEqual(sendColors[0], 'rgba(0, 0, 0, 0)', 'send button has a fill');
    await promptBox.press('Enter');
    assert.equal(await sends(), beforeSend + 1, 'Enter sends');
    // Reasoning is shown as plain text and folds once the reply exists.
    const thinking = page.locator('.thinking');
    assert.match(await thinking.locator('summary').innerText(), /Thought process$/);
    assert.equal(await thinking.getAttribute('open'), null);
    assert.equal(await page.locator('.thinking b').count(), 0, 'reasoning stays text');
    const sent = (await page.evaluate<{ type: string; agent?: unknown; model?: unknown }[]>('window.sentMessages')).filter(m => m.type === 'send').at(-1);
    assert.deepEqual([sent?.agent, sent?.model], ['build', { providerID: 'local', modelID: 'second' }]);
    await modelSelect.selectOption({ label: 'Default model' });
    assert.equal(await agentSelect.inputValue(), 'build', 'choices are kept together per session');
    // Pinned question: the exchange you are reading keeps its question visible at the top.
    const long = (n: number) => Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1} of reply ${n}.`).join('\n\n');
    const turn = (n: number) => [
      { id: `msg_q${n}`, role: 'user', text: `Question number ${n}: ` + 'why does this happen? '.repeat(8), status: 'sent', otherParts: false, tools: [], attachments: [], reasoning: '', time: { created: 1794537780961, completed: 1794537782961 }, tokens: null, kind: 'message' },
      { id: `msg_r${n}`, role: 'assistant', text: long(n), status: 'complete', otherParts: false, tools: [], attachments: [], reasoning: '', time: { created: 1794537780961, completed: 1794537782961 }, tokens: null, kind: 'message' },
    ];
    await page.evaluate((state) => window.postMessage({ version: 1, type: 'chat', state }, '*'), { ...chatState(false), messages: [1, 2, 3].flatMap(turn), hasMore: false, context: [] });
    const area = page.locator('.conversation');
    const pinnedText = async () => (await page.locator('.pinned-question').count()) ? await page.locator('.pinned-text').innerText() : null;
    const scrollTo = async (target: (el: HTMLElement) => number) => { await area.evaluate((el, fn) => { el.scrollTop = new Function('el', `return (${fn})(el)`)(el); el.dispatchEvent(new Event('scroll')); }, target.toString()); await page.waitForTimeout(50); };
    await scrollTo(el => el.scrollHeight);
    assert.match(await pinnedText() ?? '', /^Question number 3:/, 'latest question pinned while reading its reply');
    await scrollTo(el => (el.querySelector('[data-id="msg_r1"]') as HTMLElement).offsetTop + 200);
    assert.match(await pinnedText() ?? '', /^Question number 1:/, 'earlier exchange pins its own question');
    await scrollTo(() => 0);
    assert.equal(await pinnedText(), null, 'no pin while the question itself is visible');
    await scrollTo(el => (el.querySelector('[data-id="msg_r2"]') as HTMLElement).offsetTop + 300);
    await page.locator('.pinned-question').click();
    await page.waitForTimeout(50);
    assert.equal(await pinnedText(), null, 'clicking the pin scrolls back to the question');
    assert.ok(await page.locator('[data-id="msg_q2"]').evaluate(el => { const box = el.getBoundingClientRect(); const view = el.closest('.conversation')!.getBoundingClientRect(); return box.top >= view.top - 1 && box.top < view.bottom; }), 'question 2 in view');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${theme.name} ${width}: pinned overflow`);
    if (width === 320) { await scrollTo(el => el.scrollHeight); await page.screenshot({ path: join(output, `${theme.name}-pinned.png`) }); }
    // Edit approval toggle: off by default (OpenCode default), on per session, locked when the configuration requires it.
    const toggle = page.locator('button.mode-toggle');
    assert.equal(await toggle.innerText(), 'Edits: auto'); assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    await toggle.click();
    assert.deepEqual((await page.evaluate<{ type: string; ask?: boolean }[]>('window.sentMessages')).filter(m => m.type === 'editApproval').at(-1), { version: 1, type: 'editApproval', sessionId: 'ses_a', ask: true });
    const withRule = (edit: string | null, editPolicy: string | null) => ({ ...chatState(false), sessions: [{ id: 'ses_a', title: 'Session', edit }], editPolicy });
    await page.evaluate((state) => window.postMessage({ version: 1, type: 'chat', state }, '*'), withRule('ask', null));
    await toggle.filter({ hasText: /^Edits: ask$/ }).waitFor({ timeout: 2000 });
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true'); assert.equal(await toggle.isEnabled(), true, 'can be turned off');
    await page.evaluate((state) => window.postMessage({ version: 1, type: 'chat', state }, '*'), withRule(null, 'ask'));
    await toggle.filter({ hasText: /^Edits: ask$/ }).waitFor({ timeout: 2000 });
    assert.equal(await toggle.isDisabled(), true, 'configuration that asks cannot be relaxed here');
    assert.match(await toggle.getAttribute('title') ?? '', /configuration requires this/);
    await page.evaluate((state) => window.postMessage({ version: 1, type: 'chat', state }, '*'), withRule(null, 'deny'));
    await toggle.filter({ hasText: /^Edits: blocked$/ }).waitFor({ timeout: 2000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${theme.name} ${width}: toolbar overflow`);
    if (width === 240) await page.screenshot({ path: join(output, `${theme.name}-toggle.png`) });
    // Rename: pencil or F2 turns the title into a field; Enter saves, Escape and unchanged names send nothing.
    await page.evaluate((state) => window.postMessage({ version: 1, type: 'chat', state }, '*'), { ...chatState(false), sessions: [{ id: 'ses_a', title: 'Session', edit: null }] });
    const renames = async () => (await page.evaluate<{ type: string }[]>('window.sentMessages')).filter(m => m.type === 'rename');
    const before = (await renames()).length;
    await page.getByRole('button', { name: 'Rename session' }).click();
    const field = page.getByRole('textbox', { name: 'Session name' });
    assert.equal(await field.inputValue(), 'Session'); assert.equal(await field.evaluate(el => el === document.activeElement), true, 'field focused');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${theme.name} ${width}: rename overflow`);
    if (width === 240) await page.screenshot({ path: join(output, `${theme.name}-rename.png`) });
    await field.fill('Discarded'); await field.press('Escape');
    assert.equal(await field.count(), 0, 'Escape closes the field'); assert.equal((await renames()).length, before, 'Escape sends nothing');
    await page.locator('#session').focus(); await page.keyboard.press('F2');
    await field.fill('  Parser refactor  '); await field.press('Enter');
    assert.deepEqual((await renames()).at(-1), { version: 1, type: 'rename', sessionId: 'ses_a', title: 'Parser refactor' });
    assert.equal(await page.locator('#session').evaluate(el => el === document.activeElement), true, 'focus returns to the session picker');
    await page.getByRole('button', { name: 'Rename session' }).click(); await field.fill('Session'); await field.blur();
    assert.equal((await renames()).length, before + 1, 'unchanged name sends nothing');
    await page.getByRole('button', { name: 'Rename session' }).click(); await field.fill(''); await field.blur();
    assert.equal((await renames()).length, before + 1, 'empty name sends nothing');
    // Local-model experience: reply stats, context meter, near-limit warning with Compact, compaction rows.
    const message = (id: string, role: string, extra: Record<string, unknown> = {}) => ({ id, role, text: role === 'user' ? 'Refactor the parser' : 'Done.', status: role === 'user' ? 'sent' : 'complete', otherParts: false, tools: [], attachments: [], reasoning: '', time: { created: 1794537780000, completed: role === 'user' ? null : 1794537840000 }, tokens: null, kind: 'message', ...extra });
    const usage = { ...chatState(false), hasMore: false, context: [], messages: [message('msg_u1', 'user'), message('msg_a1', 'assistant', { tokens: { context: 29200, output: 450 } })] };
    await page.evaluate((state) => window.postMessage({ version: 1, type: 'chat', state }, '*'), usage);
    await page.locator('.reply-stats').filter({ hasText: /^1m 00s · 450 tokens$/ }).waitFor({ timeout: 2000 });
    const meter = page.locator('.context-meter');
    assert.equal(await meter.innerText(), '89%'); assert.match(await meter.getAttribute('class') ?? '', /high/);
    assert.equal(await meter.getAttribute('aria-label'), 'Context 89% full: 29,200 of 32,768 tokens');
    const warning = page.locator('.context-warning');
    assert.match(await warning.innerText(), /using 89% of the model's context[\s\S]*29\.2k of 32\.8k tokens/);
    await warning.getByRole('button', { name: 'Compact conversation', exact: true }).click();
    assert.equal((await page.evaluate<{ type: string }[]>('window.sentMessages')).at(-1)?.type, 'compact');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${theme.name} ${width}: meter/warning overflow`);
    if (width === 240) await page.screenshot({ path: join(output, `${theme.name}-context.png`) });
    // After compaction: a divider, the summary folded, and the meter reflects the small summary.
    const compacted = { ...usage, messages: [...usage.messages, message('msg_c', 'user', { text: '', kind: 'compaction' }), message('msg_s', 'assistant', { text: 'Summary: <b>parser</b> refactored.', kind: 'summary', tokens: { context: 30000, output: 600 } })] };
    await page.evaluate((state) => window.postMessage({ version: 1, type: 'chat', state }, '*'), compacted);
    await page.locator('.compaction-divider').filter({ hasText: 'Conversation compacted' }).waitFor({ timeout: 2000 });
    assert.equal(await page.locator('.message.summary details').getAttribute('open'), null, 'summary folded');
    assert.equal(await page.locator('.message.summary b').count(), 0, 'summary Markdown stays safe');
    assert.equal(await meter.innerText(), '2%', 'context after compaction is the summary');
    assert.equal(await page.locator('.context-warning').count(), 0);
    // Compacting: phase text and Stop stays available.
    await page.evaluate((state) => window.postMessage({ version: 1, type: 'chat', state }, '*'), { ...usage, busy: true, operation: 'compacting' });
    await page.locator('.working .phase').filter({ hasText: /^Compacting the conversation$/ }).waitFor({ timeout: 2000 });
    assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).isEnabled(), true, 'Stop works during compaction');
    // An older extension host (installed without reloading) sends states this view rejects: say so.
    await page.evaluate(() => window.postMessage({ version: 1, type: 'chat', state: { sessions: [], selectedId: null, messages: [], old: true } }, '*'));
    await page.getByRole('alert').filter({ hasText: 'Sidecode was updated.' }).waitFor({ timeout: 2000 });
    assert.match(await page.getByRole('alert').filter({ hasText: 'Sidecode was updated.' }).innerText(), /Developer: Reload Window/);
    await page.evaluate((state) => window.postMessage({ version: 1, type: 'chat', state }, '*'), chatState(false));
    await page.getByRole('alert').filter({ hasText: 'Sidecode was updated.' }).waitFor({ state: 'detached', timeout: 2000 });
    // Working line names the phase and elapsed time; a provider retry explains itself.
    const running = { ...chatState(false), messages: [{ ...chatState(false).messages[0], time: { created: Date.now(), completed: null } }], busy: true, waiting: false, context: [] };
    await page.evaluate((state) => window.postMessage({ version: 1, type: 'chat', state }, '*'), running);
    await page.locator('.working .phase').filter({ hasText: /^Waiting for the model$/ }).waitFor({ timeout: 2000 });
    await page.locator('.working .elapsed').filter({ hasText: /^\d+s$/ }).waitFor();
    // Empty-response loop (user report): one counted line, not a growing column of blank space.
    const empty = (n: number, status = 'complete') => ({ id: `msg_e${n}`, role: 'assistant', text: '', status, otherParts: false, tools: [], attachments: [], reasoning: '', time: { created: 1794537780961, completed: 1794537782961 }, tokens: null, kind: 'message' });
    const loop = { ...running, messages: [running.messages[0], ...Array.from({ length: 12 }, (_, n) => empty(n)), empty(99, 'streaming')] };
    await page.evaluate((state) => window.postMessage({ version: 1, type: 'chat', state }, '*'), loop);
    const run = page.locator('.empty-run');
    await run.getByText('The model keeps returning empty responses', { exact: false }).waitFor({ timeout: 2000 });
    assert.match(await run.innerText(), /\(12 in a row\)[\s\S]*tool calls[\s\S]*Stop/);
    assert.equal(await page.locator('.message.assistant').count(), 0, 'no blank reply rows');
    assert.equal(await page.locator('.working').count(), 0, 'the warning replaces the spinner');
    assert.equal(await page.locator('.caret').count(), 0);
    await page.evaluate((state) => window.postMessage({ version: 1, type: 'chat', state }, '*'), { ...loop, busy: false, messages: loop.messages.slice(0, 13) });
    await run.filter({ hasText: /^12 empty responses from the model\.$/ }).waitFor({ timeout: 2000 });
    if (width === 240) { await page.evaluate((state) => window.postMessage({ version: 1, type: 'chat', state }, '*'), loop); await run.getByText('keeps returning', { exact: false }).waitFor(); await page.screenshot({ path: join(output, `${theme.name}-loop.png`) }); }
    // Elapsed times come from server timestamps: right after (re)loading or switching back, a run that
    // started 90 s ago reads ~1m 30s, and a step that started 65 s ago reads ~1m 05s (not 0s).
    const startedAgo = (seconds: number) => Date.now() - seconds * 1000;
    const longRun = { ...running, messages: [{ ...running.messages[0], time: { created: startedAgo(90), completed: null } },
      { id: 'msg_long', role: 'assistant', text: 'Working on it', status: 'streaming', otherParts: false, attachments: [], reasoning: '', time: { created: startedAgo(80), completed: null }, tokens: null, kind: 'message',
        tools: [{ id: 'prt_long', tool: 'bash', status: 'running', title: 'npm test', detail: '', change: null, started: startedAgo(65) }] }] };
    const other = { ...longRun, sessions: [...longRun.sessions, { id: 'ses_b', title: 'Other', edit: null }], selectedId: 'ses_b', messages: [], busy: false };
    for (const state of [longRun, other, longRun]) await page.evaluate((s) => window.postMessage({ version: 1, type: 'chat', state: s }, '*'), state);
    await page.locator('.working .elapsed').filter({ hasText: /^1m 3\ds$/ }).waitFor({ timeout: 2000 });
    assert.match(await page.locator('.tool[data-status="running"] .tool-meta').innerText(), /^running · 1m 0\ds$/);
    // File steps: the file name comes first and stays visible even with a deep path in a narrow view.
    const fileStep = { ...longRun, messages: [longRun.messages[0], { ...longRun.messages[1], tools: [
      { id: 'prt_f1', tool: 'edit', status: 'running', title: 'server/' + 'deeply/nested/'.repeat(6) + 'routes.js', detail: '', change: null, started: startedAgo(5) },
      { id: 'prt_f2', tool: 'write', status: 'pending', title: '', detail: '', change: null, started: null }] }] };
    await page.evaluate((state) => window.postMessage({ version: 1, type: 'chat', state }, '*'), fileStep);
    const fileName = page.locator('.tool').first().locator('.tool-file');
    await fileName.filter({ hasText: /^routes\.js$/ }).waitFor({ timeout: 2000 });
    assert.ok(await fileName.evaluate(el => { const box = el.getBoundingClientRect(); const row = el.closest('.tool-text')!.getBoundingClientRect(); return box.width > 0 && box.right <= row.right + 1; }), `${theme.name} ${width}: file name visible`);
    assert.equal(await page.locator('.tool').nth(1).locator('.tool-title').innerText(), 'file not known yet');
    await page.locator('.working .phase').filter({ hasText: /^Running edit · routes\.js$/ }).waitFor({ timeout: 2000 });
    if (width === 240) await page.screenshot({ path: join(output, `${theme.name}-files.png`) });
    // A queued step (model still writing its arguments) says so instead of showing `{}`.
    const pendingEdit = { ...running, messages: [...running.messages, { id: 'msg_p', role: 'assistant', text: 'Updating the database file:', status: 'streaming', otherParts: false, attachments: [], reasoning: '', time: { created: Date.now(), completed: null }, tokens: null, kind: 'message', tools: [{ id: 'prt_p', tool: 'edit', status: 'pending', title: '', detail: '', change: null, started: null }] }] };
    await page.evaluate((state) => window.postMessage({ version: 1, type: 'chat', state }, '*'), pendingEdit);
    await page.locator('.working .phase').filter({ hasText: /^Model is writing the edit step$/ }).waitFor({ timeout: 2000 });
    assert.match(await page.locator('.tool[data-status="queued"] .tool-meta').innerText(), /^model is writing it · \d+s$/);
    assert.equal(await page.locator('.caret').count(), 0, 'no stray cursor under an unfinished step');
    await page.locator('.tool[data-status="queued"] summary').click();
    await page.getByText('OpenCode receives its details', { exact: false }).waitFor();
    await page.evaluate((state) => window.postMessage({ version: 1, type: 'chat', state }, '*'), { ...running, retry: { attempt: 2, message: 'Model "qwen" is not loaded <b>x</b>', next: Date.now() + 8000 } });
    const retry = page.locator('.retry');
    await retry.getByText('The model provider returned an error.', { exact: false }).waitFor({ timeout: 2000 });
    assert.match(await retry.innerText(), /attempt 2, next try in \d+s[\s\S]*Model "qwen" is not loaded <b>x<\/b>[\s\S]*LM Studio/);
    assert.equal(await page.locator('.working').count(), 0, 'retry replaces the spinner');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${theme.name} ${width}: retry overflow`);
    if (width === 240) await page.screenshot({ path: join(output, `${theme.name}-retry.png`) });
    await page.getByRole('button', { name: 'Connection options', exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    assert.equal(await page.getByRole('group', { name: 'Connection options' }).count(), 0, 'menu closes after an action');
    assert.ok((await page.evaluate<string[]>('window.sentActions')).includes('disconnect'));
    await page.evaluate(() => window.postMessage({ version: 1, type: 'connection', state: { phase: 'error', attempt: 0, error: 'authRequired' } }, '*'));
    await page.getByRole('alert').filter({ hasText: 'Server authentication failed' }).waitFor();
    await page.getByRole('button', { name: 'Connection options', exact: true }).click();
    await page.getByRole('button', { name: 'Server URL', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'expanded controls overflow');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: 16 theme/width cases (200–480 px), keyboard order/focus rings/Escape, reduced motion, high-contrast borders, run-end announcement, bridge actions/status/errors, populated untrusted chat, tool calls, permission card, agent/model selectors, context chips, file changes and edit review, step states, Enter to send, thinking, working line and retry, pinned question, empty-response loop, context meter/compaction/reply stats, edit-approval toggle, outdated-host notice, busy/permission/send states, disabled chat controls, no overflow or script errors. Screenshots:', output);
} finally { await browser.close(); }
