import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';

/**
 * Installed-VSIX lifecycle in a disposable profile: hide/show the secondary side bar,
 * editor zoom, window reload, launching with the extension disabled, and re-enabled.
 * The view must come back rendered each time, with no horizontal overflow when zoomed.
 */
const root = await mkdtemp(join(tmpdir(), 'sidecode-lifecycle-'));
const project = join(root, 'project'); await mkdir(project);
const cli = process.env.SIDECODE_EDITOR_CLI || '/usr/bin/codium';
const binary = process.env.SIDECODE_EDITOR_BINARY || '/usr/share/codium/codium';
const dirs = ['--user-data-dir', join(root, 'profile'), '--extensions-dir', join(root, 'extensions')];
const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)); delete env.ELECTRON_RUN_AS_NODE;
execFileSync(cli, [...dirs, '--install-extension', resolve('sidecode-0.1.0.vsix')], { env, stdio: 'ignore' });
const fail = (message) => { throw new Error(message); };

async function session(extra, work) {
  const app = await electron.launch({ executablePath: binary, env, timeout: 30000, args: [...dirs, '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry', '--disable-workspace-trust', ...extra, project] });
  try {
    const page = await app.firstWindow();
    await page.locator('.monaco-workbench').waitFor();
    const picker = page.locator('.quick-input-widget');
    const run = async (label) => {
      await page.keyboard.press('Control+Shift+P');
      await picker.locator('input').fill('>' + label);
      const row = picker.locator('.monaco-list-row').filter({ hasText: label }).first();
      await row.waitFor({ timeout: 5000 });
      await row.click();
      await page.waitForTimeout(1000);
    };
    const view = async (expect = true) => {
      for (let count = 0; count < 80; count++) {
        for (const frame of page.frames()) {
          const main = frame.getByRole('main', { name: 'OpenCode chat' });
          if (await main.count().catch(() => 0) && await frame.getByRole('status').filter({ hasText: 'Not connected' }).count().catch(() => 0)) return frame;
        }
        if (!expect && count > 20) return undefined;
        await page.waitForTimeout(100);
      }
      return undefined;
    };
    const tab = () => page.locator('.part.auxiliarybar .composite.title').filter({ hasText: /opencode/i }).count();
    return await work({ page, run, view, tab });
  } finally { await app.close(); }
}

await session([], async ({ page, run, view, tab }) => {
  await run('OpenCode: Focus on OpenCode View');
  if (!await view()) fail('view did not render');
  await run('View: Toggle Secondary Side Bar Visibility');
  if (await page.locator('.part.auxiliarybar').isVisible()) fail('secondary side bar still visible after hide');
  await run('View: Toggle Secondary Side Bar Visibility');
  if (!await tab() || !await view()) fail('view did not come back after show');
  console.log('PASS: hide/show the secondary side bar restores the rendered view');
  await run('View: Zoom In'); await run('View: Zoom In');
  const zoomed = await view();
  if (!zoomed) fail('view missing at zoom');
  if (!await zoomed.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)) fail('horizontal overflow when zoomed');
  await run('View: Reset Zoom');
  console.log('PASS: editor zoom keeps the view readable without horizontal overflow');
  await run('Developer: Reload Window');
  await page.locator('.monaco-workbench').waitFor();
  await page.waitForTimeout(2000);
  if (!await tab()) fail('tab missing after reload');
  if (!await view()) { await run('OpenCode: Focus on OpenCode View'); if (!await view()) fail('view did not render after reload'); }
  console.log('PASS: window reload restores the tab and view');
});
await session(['--disable-extension', 'sidecode-local.sidecode'], async ({ page, tab }) => {
  await page.waitForTimeout(3000);
  if (await tab()) fail('OpenCode tab shown while the extension is disabled');
  console.log('PASS: disabled extension shows no tab');
});
await session([], async ({ run, view, tab }) => {
  await run('OpenCode: Focus on OpenCode View');
  if (!await tab() || !await view()) fail('view did not return after re-enabling');
  console.log('PASS: re-enabled extension shows its tab and view again');
});
console.log('Artifacts', root);
