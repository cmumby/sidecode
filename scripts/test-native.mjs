import { setTimeout } from 'node:timers';
import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = await mkdtemp(join(tmpdir(), 'sidecode-native-'));
await mkdir(join(root, 'extensions'));
await mkdir(join(root, 'project'));
const connect = process.env.SIDECODE_NATIVE_CONNECT === '1';
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: process.env.SIDECODE_EDITOR_BINARY || '/usr/share/codium/codium', env,
  args: ['--user-data-dir', join(root, 'profile'), '--extensions-dir', join(root, 'extensions'), '--extensionDevelopmentPath=' + resolve('.'), '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry', '--disable-workspace-trust', ...(connect ? [join(root, 'project')] : [])], timeout: 30000 });
try {
  const page = await app.firstWindow();
  await page.locator('.monaco-workbench').waitFor();
  const picker = page.locator('.quick-input-widget');
  async function command(label) {
    await page.keyboard.press('Control+Shift+P');
    await picker.locator('input').fill('>' + label);
    await picker.getByText(label, { exact: true }).click();
  }
  await command('OpenCode: Focus on OpenCode View');
  await picker.waitFor({ state: 'hidden' });
  await page.screenshot({ path: join(root, 'view.png') });
  // Default placement: a tab in the secondary side bar.
  await page.locator('.part.auxiliarybar .composite.title').filter({ hasText: /opencode/i }).first().waitFor();
  // Users can still move it with the editor's own controls (here: to the panel).
  await command('View: Move View');
  await picker.getByText('OpenCode', { exact: true }).click();
  await picker.getByText('New Panel Entry', { exact: true }).click();
  await picker.waitFor({ state: 'hidden' });
  await page.locator('.part.panel .composite.title').filter({ hasText: /opencode/i }).first().waitFor();
  let content;
  for (let count = 0; count < 60; count++) {
    for (const frame of page.frames()) {
      if (await frame.getByRole('main', { name: 'OpenCode chat' }).count()) content = frame;
    }
    if (content) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!content) throw new Error('No rendered OpenCode webview');
  await content.getByRole('status').filter({ hasText: 'Not connected' }).waitFor();
  await content.getByRole('button', { name: 'Connect', exact: true }).focus();
  if (!await content.getByRole('button', { name: 'Connect', exact: true }).evaluate(el => el === el.ownerDocument.activeElement)) throw new Error('Button not focusable');
  if (connect) {
    await content.getByRole('button', { name: 'Connect', exact: true }).click();
    // First Connect confirms the server URL; accept the default.
    await picker.locator('.quick-input-title').filter({ hasText: 'server URL' }).waitFor();
    await picker.locator('input').press('Enter');
    await content.getByRole('status').filter({ hasText: /^Connected$/ }).waitFor({ timeout: 15000 });
    await content.getByRole('button', { name: 'Connection options', exact: true }).click();
    await content.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await content.getByRole('status').filter({ hasText: 'Not connected' }).waitFor();
  }
  console.log('PASS: native React content, keyboard focus, default Secondary Side Bar tab and user movement to the Panel' + (connect ? '; explicit live connection/disconnection' : ''));
  await page.screenshot({ path: join(root, 'commands.png') });
  console.log('Artifacts', root);
} finally { await app.close(); }
