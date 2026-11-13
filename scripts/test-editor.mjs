import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { runTests } from '@vscode/test-electron';
// The coding environment can export this for CLI processes; the test binary needs GUI mode.
delete process.env.ELECTRON_RUN_AS_NODE;
const cli = process.env.SIDECODE_EDITOR_CLI || '/usr/bin/codium';
const executable = process.env.SIDECODE_EDITOR_BINARY || '/usr/share/codium/codium';
const root = await mkdtemp(join(tmpdir(), 'sidecode-editor-'));
const extensions = join(root, 'extensions');
const user = join(root, 'profile');
const harness = join(root, 'harness');
const folder = join(root, 'workspace');
await Promise.all([mkdir(extensions), mkdir(user), mkdir(harness), mkdir(folder)]);
await writeFile(join(harness, 'package.json'), JSON.stringify({ name: 'sidecode-test-harness', publisher: 'sidecode-local', version: '0.0.0', engines: { vscode: '^1.90.0' } }));
await build({ entryPoints: ['tests/editor-suite.ts'], outfile: join(harness, 'suite.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['vscode'] });
const args = ['--user-data-dir', user, '--extensions-dir', extensions];
const install = () => execFileSync(cli, [...args, '--install-extension', resolve('sidecode-0.1.0.vsix')], { stdio: 'inherit' });
install();
for (const workspace of [[], [folder]]) {
  await runTests({ vscodeExecutablePath: executable, extensionDevelopmentPath: harness, extensionTestsPath: join(harness, 'suite.cjs'),
    launchArgs: [...args, '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry', '--disable-workspace-trust', ...workspace] });
}
// Lifecycle verification applies only to this disposable test profile.
const settingsPath = join(user, 'User', 'settings.json');
const settings = await readFile(settingsPath, 'utf8').catch(() => undefined);
execFileSync(cli, [...args, '--uninstall-extension', 'sidecode-local.sidecode'], { stdio: 'inherit' });
install();
if (await readFile(settingsPath, 'utf8').catch(() => undefined) !== settings) throw new Error('Settings changed during install/uninstall');
console.log('PASS: clean-profile install/uninstall/reinstall; profile retained at', root);
