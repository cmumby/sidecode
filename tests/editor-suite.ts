import assert from 'node:assert/strict';
import * as vscode from 'vscode';
export async function run(): Promise<void> {
  const before = vscode.window.tabGroups.all.map((group) => ({ active: group.isActive, count: group.tabs.length }));
  const config = JSON.stringify(vscode.workspace.getConfiguration());
  const extension = vscode.extensions.getExtension('sidecode-local.sidecode');
  assert.ok(extension, 'packaged extension is installed');
  await extension.activate();
  await vscode.commands.executeCommand('sidecode.chat.focus');
  assert.equal(extension.isActive, true);
  assert.deepEqual(vscode.window.tabGroups.all.map((group) => ({ active: group.isActive, count: group.tabs.length })), before);
  const after = JSON.stringify(vscode.workspace.getConfiguration());
  if (after !== config) {
    // Report which settings changed (paths only) so a failure is diagnosable.
    const flat = (value: unknown, prefix = '', out = new Map<string, string>()) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) for (const [key, inner] of Object.entries(value)) flat(inner, prefix ? `${prefix}.${key}` : key, out);
      else out.set(prefix, JSON.stringify(value));
      return out;
    };
    const [a, b] = [flat(JSON.parse(config)), flat(JSON.parse(after))];
    // Built-in components (e.g. the external terminal) can register settings with their
    // defaults while the test runs; those keys are new, not modified. A write by this
    // extension would change an existing value, remove one, or add a `sidecode.*` key.
    const changed = [...a.keys()].filter(key => a.get(key) !== b.get(key));
    const ours = [...b.keys()].filter(key => !a.has(key) && key.startsWith('sidecode.'));
    assert.deepEqual([...changed, ...ours], [], `configuration changed: ${[...changed, ...ours].slice(0, 20).join(', ')}`);
    console.log(`note: ${[...b.keys()].filter(key => !a.has(key)).length} settings were registered by other components during the test`);
  }
  console.log('PASS: activation and view focus preserve editor groups and configuration', vscode.workspace.workspaceFolders ? 'folder' : 'empty window');
}
