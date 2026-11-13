import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type Frame } from 'playwright-core';

/**
 * Sidecode next to the real Codex and Claude Code extensions (copied, never linked, into
 * a disposable profile): launch without Sidecode, with it (open view, use its menu), and
 * without it again. Container placement, settings, saved layout state and the other
 * extensions' files must be identical before and after. The user's installs are only read.
 */
const source = process.env.SIDECODE_PEER_EXTENSIONS || join(homedir(), '.vscode-oss', 'extensions');
// Newest installed version of each (older versions can linger in the folder).
const newest = new Map<string, string>();
for (const name of (await readdir(source)).filter(name => /^(anthropic\.claude-code|openai\.chatgpt)-[\d.]+-linux-x64$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) newest.set(name.replace(/-[\d.]+-linux-x64$/, ''), name);
const peers = [...newest.values()];
if (peers.length < 2) { console.log('SKIP: Codex and Claude Code extensions not found in', source); process.exit(0); }
const root = await mkdtemp(join(tmpdir(), 'sidecode-coexist-'));
const project = join(root, 'project'); await mkdir(project);
const copies = join(root, 'peers'); await mkdir(copies);
for (const name of peers) await cp(join(source, name), join(copies, name), { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE;
const profile = join(root, 'profile');

async function fingerprint(dir: string): Promise<string> {
  const hash = createHash('sha256');
  async function walk(path: string) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) await walk(full);
      else { const info = await stat(full); hash.update(`${full.slice(dir.length)}:${info.size}:${info.mtimeMs}\n`); }
    }
  }
  await walk(dir);
  return hash.digest('hex');
}
const state = (key: string) => { try { return execFileSync('sqlite3', [`file:${join(profile, 'User', 'globalStorage', 'state.vscdb')}?mode=ro`, `select value from ItemTable where key='${key}'`], { encoding: 'utf8' }).trim(); } catch { return ''; } };
const settings = async () => readFile(join(profile, 'User', 'settings.json'), 'utf8').catch(() => '');

async function launch(withSidecode: boolean) {
  const dev = [...peers.map(name => join(copies, name)), ...(withSidecode ? [resolve('.')] : [])];
  const app = await electron.launch({ executablePath: process.env.SIDECODE_EDITOR_BINARY || '/usr/share/codium/codium', env, timeout: 30000,
    args: ['--user-data-dir', profile, '--extensions-dir', join(root, 'extensions'), ...dev.map(path => `--extensionDevelopmentPath=${path}`),
      '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry', '--disable-workspace-trust', project] });
  try {
    const page = await app.firstWindow();
    await page.locator('.monaco-workbench').waitFor();
    await page.waitForTimeout(4000); // let the peers activate (onStartupFinished)
    const run = async (command: string) => {
      await page.keyboard.press('Control+Shift+P');
      await page.locator('.quick-input-widget input').fill('>' + command);
      await page.locator('.quick-input-widget .monaco-list-row').filter({ hasText: command }).first().click();
      await page.waitForTimeout(800);
    };
    await run('Focus into Secondary Side Bar');
    const containers = async () => {
      const read = (part: string) => page.locator(`.part.${part}`).evaluate(el => [...el.querySelectorAll<HTMLElement>('.composite-bar .action-item [aria-label], .composite-bar .action-label')].map(item => item.getAttribute('aria-label') || item.textContent || '').filter(Boolean)).catch(() => [] as string[]);
      // Tabs that do not fit sit behind "Additional Views" (…); read that menu too.
      const right = (await read('auxiliarybar')).filter(name => name !== 'Additional Views');
      const more = page.locator('.part.auxiliarybar [aria-label="Additional Views"]');
      if (await more.count()) {
        const openBefore = await page.locator('.context-view .monaco-menu').count();
        await more.first().click();
        const menu = page.locator('.context-view .monaco-menu').nth(openBefore);
        await menu.waitFor();
        // Entries of the overflow menu are toggles for view containers.
        right.push(...(await menu.locator('[role="menuitemcheckbox"] .action-label, [role="menuitem"][aria-checked] .action-label').allTextContents()).map(text => text.trim()).filter(Boolean));
        await page.keyboard.press('Escape');
      }
      return { right: [...new Set(right)].sort(), left: [...new Set(await read('activitybar'))].sort() };
    };
    let during: Awaited<ReturnType<typeof containers>> | undefined;
    if (withSidecode) {
      await run('OpenCode: Focus on OpenCode View');
      let ui: Frame | undefined;
      for (let i = 0; i < 100 && !ui; i++) { for (const frame of page.frames()) if (await frame.getByRole('main', { name: 'OpenCode chat' }).count().catch(() => 0)) ui = frame; if (!ui) await page.waitForTimeout(100); }
      assert.ok(ui, 'Sidecode view rendered');
      // Use the connection menu and cancel the URL prompt: an explicit action that must not write settings.
      await ui.getByRole('button', { name: 'Connection options' }).click();
      await ui.getByRole('button', { name: 'Server URL', exact: true }).click();
      await page.locator('.quick-input-widget .quick-input-title').filter({ hasText: 'OpenCode server URL' }).waitFor();
      await page.keyboard.press('Escape');
      during = await containers();
      await page.screenshot({ path: join(root, 'with-sidecode.png') });
    }
    const groups = await page.locator('.editor-group-container').count();
    return { containers: await containers(), during, groups };
  } finally { await app.close(); }
}

try {
  const filesBefore = await Promise.all(peers.map(name => fingerprint(join(copies, name))));
  const baseline = await launch(false);
  const snapshot = async () => ({ settings: await settings(), customizations: state('views.customizations'), placeholders: state('workbench.auxiliarybar.placeholderPanels') });
  const before = await snapshot();
  const withSidecode = await launch(true);
  const after = await launch(false);
  const filesAfter = await Promise.all(peers.map(name => fingerprint(join(copies, name))));
  console.log('right side bar (baseline):', baseline.containers.right.join(', '));
  console.log('right side bar (with Sidecode):', withSidecode.during?.right.join(', '));
  assert.ok(baseline.containers.right.length >= 2, `peers found in the secondary side bar: ${baseline.containers.right}`);
  for (const peer of baseline.containers.right) assert.ok(withSidecode.during!.right.includes(peer), `${peer} still in the secondary side bar with Sidecode`);
  assert.ok(withSidecode.during!.right.some(name => /opencode/i.test(name)), 'OpenCode is a tab beside them');
  assert.deepEqual(after.containers, baseline.containers, 'container placement unchanged after Sidecode ran');
  assert.equal(after.groups, baseline.groups, 'editor groups unchanged');
  const afterState = await snapshot();
  assert.equal(afterState.settings, before.settings, 'user settings file unchanged');
  assert.equal(afterState.customizations, before.customizations, 'saved view locations unchanged');
  assert.deepEqual(filesAfter, filesBefore, 'Codex and Claude Code files untouched');
  console.log('PASS: Codex and Claude Code keep their placement, settings, saved layout and files; OpenCode is a tab beside them');
} finally { await rm(copies, { recursive: true, force: true }); console.log('Artifacts', root); }
