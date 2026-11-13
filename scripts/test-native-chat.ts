import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { _electron as electron, type Frame } from 'playwright-core';
import { modelFixture } from './fixtures/model';
import { isolatedServer } from './fixtures/server';

/**
 * Native end-to-end chat: real editor webview → extension host → isolated OpenCode
 * 2.3.0 → deterministic local model. Disposable editor profile; the user's server,
 * settings and provider credentials are never used. The system clipboard is restored.
 */
const model = await modelFixture(400);
const fixture = model.config.provider.fixture;
const server = await isolatedServer({ ...model.config, permissions: [{ action: 'shell', resource: '*', effect: 'ask' }, { action: 'edit', resource: '*', effect: 'ask' }],
  provider: { fixture: { ...fixture, models: { ...fixture.models, second: { name: 'Second fixture', limit: { context: 32000, output: 4096 } } } } } });
const root = await mkdtemp(join(tmpdir(), 'sidecode-native-chat-'));
await mkdir(join(root, 'extensions'));
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
delete env.ELECTRON_RUN_AS_NODE;
await mkdir(join(server.project, 'src'));
await writeFile(join(server.project, 'src', 'context.ts'), 'export const MARK_SAVED_FILE = 1;\nexport const two = 2;\n');
await writeFile(join(server.project, 'src', 'a.ts'), 'export const value = 1;\nexport const other = 0;\n');
await writeFile(join(server.project, 'src', 'b.ts'), 'export const MARK_PICKED_FILE = 3;\n');
await server.start();
const app = await electron.launch({ executablePath: process.env.SIDECODE_EDITOR_BINARY || '/usr/share/codium/codium', env,
  args: ['--user-data-dir', join(root, 'profile'), '--extensions-dir', join(root, 'extensions'), '--extensionDevelopmentPath=' + resolve('.'),
    '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry', '--disable-workspace-trust', server.project], timeout: 30000 });
const savedClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
try {
  const page = await app.firstWindow();
  await page.locator('.monaco-workbench').waitFor();
  const picker = page.locator('.quick-input-widget');
  await page.keyboard.press('Control+Shift+P');
  await picker.locator('input').fill('>OpenCode: Focus on OpenCode View');
  await picker.getByText('OpenCode: Focus on OpenCode View', { exact: true }).click();
  await picker.waitFor({ state: 'hidden' });
  let content: Frame | undefined;
  for (let count = 0; count < 100 && !content; count++) {
    for (const frame of page.frames()) if (await frame.getByRole('main', { name: 'OpenCode chat' }).count()) content = frame;
    if (!content) await pause(100);
  }
  if (!content) throw new Error('No rendered OpenCode webview');
  // The view is a tab in the secondary side bar (right), next to other chat extensions.
  const auxiliary = page.locator('.part.auxiliarybar');
  // Webview iframes are hosted outside the part, so check the container's title instead.
  await auxiliary.locator('.composite.title').filter({ hasText: /opencode/i }).first().waitFor({ timeout: 10000 });
  assert.equal(await page.locator('.part.sidebar .composite.title').filter({ hasText: /opencode/i }).count(), 0, 'not in the primary side bar');
  await page.screenshot({ path: join(root, 'placement.png') });
  const ui = content;
  const button = (name: string) => ui.getByRole('button', { name, exact: true });
  async function answer(title: string, value: string) {
    await picker.locator('.quick-input-title').filter({ hasText: title }).waitFor();
    const input = picker.locator('input');
    await input.fill(value);
    await input.press('Enter');
  }

  // Explicit user actions through native dialogs: URL, then endpoint-scoped credentials.
  // The frame can be found before React has mounted; retry the menu until it opens.
  const menuAction = async (name: string) => {
    await assertEnabled(async () => {
      if (await button(name).isVisible()) return true;
      await button('Connection options').click().catch(() => {});
      return button(name).isVisible();
    }, `menu item ${name}`);
    await button(name).click();
  };
  await menuAction('Server URL');
  await answer('OpenCode server URL', server.baseUrl);
  await picker.waitFor({ state: 'hidden' });
  await menuAction('Set credentials');
  await answer('OpenCode server username', server.credentials.username);
  await answer('OpenCode server password', server.credentials.password);
  await picker.waitFor({ state: 'hidden' });
  await button('Connect').click();
  await ui.getByRole('status').filter({ hasText: /^Connected$/ }).waitFor({ timeout: 20000 });

  await button('New session').click();
  const prompt = ui.getByLabel('Message OpenCode', { exact: true });
  await assertEnabled(() => prompt.isEnabled(), 'composer enabled for new session');
  const assistant = ui.locator('.message.assistant');
  const status = async () => await assistant.last().getAttribute('data-status') ?? '';

  await prompt.fill('Say hello without tools.');
  await assertEnabled(() => button('Send').isEnabled(), 'ready to send');
  await prompt.press('Enter'); // Enter sends (Shift+Enter adds a line).
  await assistant.first().waitFor({ timeout: 20000 });
  const seen = new Set<string>(); const lengths = new Set<number>();
  for (let count = 0; count < 200; count++) {
    seen.add(await status()); lengths.add((await assistant.last().innerText()).length);
    if (seen.has('complete')) break;
    await pause(100);
  }
  assert.ok(seen.has('streaming') && seen.has('complete'), `statuses ${[...seen]}`);
  assert.ok(lengths.size >= 3, 'incremental streaming visible in webview');
  assert.equal(await prompt.inputValue(), '', 'draft cleared after confirmed send');
  assert.equal(await ui.locator('.message').count(), 2);
  assert.match(await assistant.last().innerText(), /Fixture reply: hello/);
  assert.equal(await assistant.last().locator('p strong').innerText(), 'hello', 'Markdown rendered');
  console.log('PASS: native URL/credential dialogs, connect, new session, send, visible streaming, Markdown');

  // The system clipboard is shared with the desktop: if something else copies at the same
  // moment (for example the person using this machine), copy again rather than fail.
  const copyAndRead = async () => {
    await assistant.last().locator('.code-block').getByRole('button', { name: /Copy code|Copied/ }).click();
    await assistant.last().getByRole('button', { name: 'Copied' }).waitFor();
    let text = '';
    for (let count = 0; count < 30 && !/const answer = 42;/.test(text); count++) { text = await app.evaluate(({ clipboard }) => clipboard.readText()); if (!/const answer = 42;/.test(text)) await pause(100); }
    return text;
  };
  let copied = '';
  for (let attempt = 0; attempt < 3 && !/const answer = 42;/.test(copied); attempt++) copied = await copyAndRead();
  assert.match(copied, /const answer = 42;/, 'clipboard after Copy (3 attempts)');
  console.log('PASS: code-block copy in native webview');

  await prompt.fill('Say hello slowly without tools.');
  await button('Send').click();
  for (let count = 0; count < 200 && !(await ui.locator('.message').count() === 4 && await status() === 'streaming'); count++) await pause(50);
  await button('Stop').click();
  for (let count = 0; count < 200 && await status() !== 'stopped'; count++) await pause(100);
  assert.equal(await status(), 'stopped');
  await button('Stop').waitFor({ state: 'detached' });
  assert.equal(await ui.locator('.message').count(), 4, 'no duplicate messages');
  console.log('PASS: Stop aborts the running response; no duplicates');

  await menuAction('Disconnect');
  await ui.getByRole('status').filter({ hasText: 'Not connected' }).waitFor();
  await button('Connect').click();
  await ui.getByRole('status').filter({ hasText: /^Connected$/ }).waitFor({ timeout: 20000 });
  for (let count = 0; count < 100 && await ui.locator('.message').count() !== 4; count++) await pause(100);
  assert.equal(await ui.locator('.message').count(), 4, 'reconnect resumes history without duplicates');
  console.log('PASS: reconnect resumes the session history without duplicates');

  // Tool call + explicit permission through the real webview.
  for (const [choice, outcome] of [['Allow once', 'done'], ['Deny', 'failed']] as const) {
    const previous = await ui.getByLabel('Session', { exact: true }).inputValue();
    await button('New session').click();
    // Drafts are per session: wait until the new session is selected before typing.
    await assertEnabled(async () => await ui.getByLabel('Session', { exact: true }).inputValue() !== previous && await ui.locator('.message').count() === 0 && await prompt.isEnabled(), `new session selected for ${choice}`);
    await prompt.fill('RUN_TOOL please');
    await button('Send').click();
    const card = ui.getByRole('region', { name: 'Permission requested' });
    await card.waitFor({ timeout: 20000 });
    assert.match(await card.innerText(), /shell[\s\S]*echo sidecode-tool-ok/);
    assert.equal(await ui.locator('.tool').first().getAttribute('data-status'), 'waiting', 'held step shows it needs you');
    await pause(1000);
    assert.equal(await card.count(), 1, 'request held until answered');
    if (choice === 'Allow once') await page.screenshot({ path: join(root, 'permission.png') });
    await card.getByRole('button', { name: choice, exact: true }).click();
    await card.waitFor({ state: 'detached', timeout: 20000 });
    const tool = ui.locator('.tool').first();
    for (let count = 0; count < 100 && await tool.getAttribute('data-status') !== outcome; count++) await pause(100);
    assert.equal(await tool.getAttribute('data-status'), outcome);
    // Finished groups fold; open the group, then the step, to read its output.
    const group = ui.locator('.steps').first();
    for (let count = 0; count < 50 && await group.getAttribute('open') !== null; count++) await pause(100);
    assert.match(await group.locator('.steps-summary').innerText(), outcome === 'done' ? /^1 step · done$/ : /^1 step · 1 failed$/);
    await group.locator('> summary').click();
    await tool.locator('summary').click();
    assert.match(await tool.locator('.tool-detail').innerText(), choice === 'Deny' ? /declined/ : /sidecode-tool-ok/);
  }
  console.log('PASS: native permission card held until answered; Allow once runs the tool, Deny fails it; tool rows expand');

  // Agent/model selectors: server-listed choices, sent explicitly, remembered per session.
  const previous = await ui.getByLabel('Session', { exact: true }).inputValue();
  await button('New session').click();
  await assertEnabled(async () => await ui.getByLabel('Session', { exact: true }).inputValue() !== previous && await prompt.isEnabled(), 'session for selectors');
  const agentSelect = ui.getByLabel('Agent', { exact: true }); const modelSelect = ui.getByLabel('Model', { exact: true });
  assert.equal(await agentSelect.inputValue(), '', 'new session starts on the OpenCode default');
  const agentNames = await agentSelect.locator('option').allTextContents();
  assert.ok(agentNames.includes('plan') && !agentNames.includes('explore') && !agentNames.includes('title'), `agents ${agentNames}`);
  await agentSelect.selectOption('plan');
  await modelSelect.selectOption({ label: 'Second fixture' });
  const before = model.requests.length;
  await prompt.fill('Say hello with the second model.');
  await button('Send').click();
  for (let count = 0; count < 200 && !(await ui.locator('.message').count() === 2 && await status() === 'complete'); count++) await pause(100);
  assert.equal(await status(), 'complete');
  assert.ok(model.requests.slice(before).some(r => (r as { model?: string }).model === 'second'), 'selected model used');
  await menuAction('Refresh'); await pause(500);
  assert.equal(await agentSelect.inputValue(), 'plan'); assert.equal(await modelSelect.locator('option:checked').textContent(), 'Second fixture');
  console.log('PASS: native agent/model selectors list server options, send the choice and keep it');

  // Explicit context from the real editor: current file (saved content), selection
  // (unsaved editor text) and a workspace quick pick; labels only in the webview.
  const prior = await ui.getByLabel('Session', { exact: true }).inputValue();
  await button('New session').click();
  await assertEnabled(async () => await ui.getByLabel('Session', { exact: true }).inputValue() !== prior && await prompt.isEnabled(), 'session for context');
  await page.keyboard.press('Control+P');
  await picker.locator('input').fill('src/context.ts');
  await picker.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'context.ts' }).first().waitFor();
  await page.keyboard.press('Enter');
  await picker.waitFor({ state: 'hidden' });
  const editor = page.locator('.editor-instance .monaco-editor').first();
  await editor.waitFor();
  await editor.locator('.view-lines').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('// MARK_UNSAVED_SELECTION');
  await page.keyboard.press('Home'); await page.keyboard.press('Shift+End');
  // The + menu closes after each choice.
  const addContext = async (name: string) => { await button('Add context').click(); await ui.getByRole('group', { name: 'Add context' }).getByRole('button', { name, exact: true }).click(); };
  const pendingList = ui.getByRole('list', { name: 'Context for the next message' });
  await addContext('Current file');
  await pendingList.getByText('src/context.ts', { exact: true }).waitFor();
  await pendingList.getByText('Unsaved changes are not included', { exact: false }).waitFor();
  await addContext('Selection');
  await pendingList.getByText('src/context.ts:1', { exact: true }).waitFor();
  await addContext('Workspace…');
  await picker.locator('.quick-input-title').filter({ hasText: 'Attach to the next OpenCode message' }).waitFor();
  await picker.locator('input').first().fill('b.ts');
  const row = picker.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'src/b.ts' }).first();
  await row.waitFor(); await row.click();
  assert.equal(await row.getAttribute('aria-checked'), 'true', 'workspace item checked');
  await page.keyboard.press('Enter');
  await picker.waitFor({ state: 'hidden' });
  await pendingList.getByText('src/b.ts', { exact: true }).waitFor();
  assert.equal(await pendingList.getByRole('listitem').count(), 3);
  const sentBefore = model.requests.length;
  await prompt.fill('Explain the attached context.');
  await button('Send').click();
  for (let count = 0; count < 200 && !(await ui.locator('.message').count() === 2 && await status() === 'complete'); count++) await pause(100);
  assert.equal(await status(), 'complete');
  const seenByModel = JSON.stringify(model.requests.slice(sentBefore));
  assert.match(seenByModel, /MARK_SAVED_FILE/); assert.match(seenByModel, /MARK_UNSAVED_SELECTION/); assert.match(seenByModel, /MARK_PICKED_FILE/);
  assert.deepEqual(await ui.locator('.message.user .chip-label').allTextContents(), ['src/context.ts', 'src/context.ts:1', 'src/b.ts']);
  assert.equal(await pendingList.count(), 0, 'context cleared after send');
  console.log('PASS: native context: current file, unsaved selection and workspace pick reach OpenCode; chips show labels only');

  // Review an edit in the native diff editor before approving, then inspect the result.
  const lastSession = await ui.getByLabel('Session', { exact: true }).inputValue();
  await button('New session').click();
  await assertEnabled(async () => await ui.getByLabel('Session', { exact: true }).inputValue() !== lastSession && await prompt.isEnabled(), 'session for edit review');
  await ui.getByLabel('Agent', { exact: true }).selectOption('build');
  // This server's configuration requires approval for edits: the toggle shows it and is locked.
  const modeToggle = ui.locator('button.mode-toggle');
  await modeToggle.filter({ hasText: /^Edits: ask$/ }).waitFor({ timeout: 10000 });
  assert.equal(await modeToggle.isDisabled(), true, 'configuration-required approval cannot be turned off here');
  await prompt.fill('RUN_EDIT please');
  await button('Send').click();
  const editCard = ui.getByRole('region', { name: 'Permission requested' });
  await editCard.waitFor({ timeout: 20000 });
  assert.match(await editCard.innerText(), /wants to edit this file:[\s\S]*src\/a\.ts[\s\S]*\+1[\s\S]*−1/);
  await editCard.getByRole('button', { name: 'Review changes', exact: true }).click();
  const tab = (title: string) => page.locator('.tabs-container .tab').filter({ hasText: title });
  await tab('Proposed by OpenCode').waitFor({ timeout: 10000 });
  const diffEditor = page.locator('.monaco-diff-editor').last();
  await diffEditor.locator('.editor.modified .view-lines').filter({ hasText: 'sidecode-edited' }).waitFor();
  await diffEditor.locator('.editor.original .view-lines').filter({ hasText: 'value = 1;' }).waitFor();
  assert.equal(await readFile(join(server.project, 'src', 'a.ts'), 'utf8'), 'export const value = 1;\nexport const other = 0;\n', 'review does not write');
  assert.equal(await editCard.count(), 1, 'review does not answer the request');
  await page.screenshot({ path: join(root, 'review.png') });
  await editCard.getByRole('button', { name: 'Allow once', exact: true }).click();
  await editCard.waitFor({ state: 'detached', timeout: 20000 });
  const showChanges = ui.getByRole('button', { name: 'Show changes to src/a.ts', exact: true });
  await showChanges.waitFor({ timeout: 20000 });
  assert.match(await readFile(join(server.project, 'src', 'a.ts'), 'utf8'), /sidecode-edited/);
  await showChanges.click();
  await tab('changes by OpenCode').waitFor({ timeout: 10000 });
  const changesEditor = page.locator('.monaco-diff-editor').last();
  await changesEditor.locator('.editor.original .view-lines').filter({ hasText: 'value = 1;' }).waitFor();
  await changesEditor.locator('.editor.modified .view-lines').filter({ hasText: 'sidecode-edited' }).waitFor();
  await ui.getByRole('button', { name: 'Open src/a.ts', exact: true }).click();
  await page.locator('.tabs-container .tab.active').filter({ hasText: 'a.ts' }).waitFor();
  console.log('PASS: native edit review: proposed diff before approval (nothing written), then before ↔ after and Open file');

  // Notification when a reply finishes while the view is hidden; Show brings the view back.
  const beforeNotify = await ui.getByLabel('Session', { exact: true }).inputValue();
  await button('New session').click();
  await assertEnabled(async () => await ui.getByLabel('Session', { exact: true }).inputValue() !== beforeNotify && await button('Send').isEnabled().catch(() => false) === false && await prompt.isEnabled(), 'session for notification');
  await prompt.fill('Say hello slowly while I look away.');
  await assertEnabled(() => button('Send').isEnabled(), 'ready to send');
  await prompt.press('Enter');
  await ui.locator('.message.assistant').first().waitFor({ timeout: 20000 });
  await page.keyboard.press('Control+Shift+P');
  await picker.locator('input').fill('>View: Toggle Secondary Side Bar Visibility');
  await picker.locator('.monaco-list-row').filter({ hasText: 'Toggle Secondary Side Bar Visibility' }).first().click();
  const toast = page.locator('.notification-toast').filter({ hasText: 'OpenCode finished replying' });
  await toast.waitFor({ timeout: 30000 });
  await toast.getByRole('button', { name: 'Show' }).click();
  await page.locator('.part.auxiliarybar').waitFor({ state: 'visible', timeout: 10000 });
  console.log('PASS: native notification when a reply finishes while the view is hidden; Show reopens it');
  await page.screenshot({ path: join(root, 'chat.png') });
  console.log('Artifacts', root);
} catch (error) {
  const page = await app.firstWindow();
  await page.screenshot({ path: join(root, 'failure.png') }).catch(() => {});
  for (const frame of page.frames()) if (await frame.getByRole('main', { name: 'OpenCode chat' }).count().catch(() => 0)) console.error('Webview text:\n' + await frame.locator('main').innerText());
  console.error('Model requests', model.requests.length, 'artifacts', root);
  throw error;
} finally {
  await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), savedClipboard).catch(() => {});
  await app.close();
  await server.stop();
  await model.stop();
}

async function assertEnabled(check: () => Promise<boolean>, label: string) {
  for (let count = 0; count < 100; count++) { if (await check()) return; await pause(100); }
  throw new Error(`Timed out: ${label}`);
}
