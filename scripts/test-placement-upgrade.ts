import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';

/**
 * Upgrade path for the view location: a profile that used the old Activity Bar build
 * (left) must show the tab in the secondary side bar (right) after the new build loads.
 * Disposable profile and copies of the built extension only.
 */
const root = await mkdtemp(join(tmpdir(), 'sidecode-placement-'));
const project = join(root, 'project'); await mkdir(project);
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
for (const [name, containers] of [['old', { activitybar: manifest.contributes.viewsContainers.secondarySidebar }], ['new', manifest.contributes.viewsContainers]] as const) {
  const dir = join(root, name); await mkdir(dir);
  for (const item of ['dist', 'media']) await cp(item, join(dir, item), { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ ...manifest, contributes: { ...manifest.contributes, viewsContainers: containers } }));
}
const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE;
async function run(build: 'old' | 'new') {
  const app = await electron.launch({ executablePath: process.env.SIDECODE_EDITOR_BINARY || '/usr/share/codium/codium', env, timeout: 30000,
    args: ['--user-data-dir', join(root, 'profile'), '--extensions-dir', join(root, 'extensions'), `--extensionDevelopmentPath=${join(root, build)}`, '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry', '--disable-workspace-trust', project] });
  try {
    const page = await app.firstWindow();
    await page.locator('.monaco-workbench').waitFor();
    await page.keyboard.press('Control+Shift+P');
    const picker = page.locator('.quick-input-widget');
    await picker.locator('input').fill('>OpenCode: Focus on OpenCode View');
    await picker.getByText('OpenCode: Focus on OpenCode View', { exact: true }).click();
    await page.waitForTimeout(1500);
    const where = async (part: string) => page.locator(`.part.${part} .composite.title`).filter({ hasText: /opencode/i }).count();
    const result = { left: await where('sidebar'), right: await where('auxiliarybar') };
    await page.screenshot({ path: join(root, `${build}.png`) });
    return result;
  } finally { await app.close(); }
}
const before = await run('old');
assert.deepEqual(before, { left: 1, right: 0 }, 'old build opens on the left');
const after = await run('new');
console.log('after upgrade', after, 'artifacts', root);
assert.deepEqual(after, { left: 0, right: 1 }, 'new build opens in the secondary side bar after upgrade');
console.log('PASS: a profile that used the left placement shows the tab on the right after upgrading');
