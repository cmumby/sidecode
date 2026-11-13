import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectLabel, selectionLabel } from '../src/extension/context';

test('only real paths strictly inside the project are attachable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sidecode-context-'));
  const project = join(root, 'project'); const sibling = join(root, 'project-evil');
  await mkdir(join(project, 'src'), { recursive: true }); await mkdir(sibling);
  await writeFile(join(project, 'src', 'a b.ts'), 'a'); await writeFile(join(sibling, 'x.ts'), 'x'); await writeFile(join(root, 'secret.txt'), 's');
  await symlink(join(root, 'secret.txt'), join(project, 'escape.txt'));
  await symlink(join(project, 'src'), join(project, 'alias'));
  assert.equal(await projectLabel(project, join(project, 'src', 'a b.ts')), 'src/a b.ts');
  assert.equal(await projectLabel(project, join(project, 'src')), 'src');
  assert.equal(await projectLabel(project, join(project, 'alias', 'a b.ts')), 'alias/a b.ts', 'symlink that stays inside');
  for (const outside of [join(project, 'escape.txt'), join(sibling, 'x.ts'), join(root, 'secret.txt'), project, join(project, '..', 'secret.txt'), join(project, 'missing.ts'), '/']) {
    assert.equal(await projectLabel(project, outside), undefined, outside);
  }
});
test('selection labels use 1-based inclusive lines', () => {
  assert.equal(selectionLabel('a.ts', { line: 4 }, { line: 6, character: 3 }), 'a.ts:5-7');
  assert.equal(selectionLabel('a.ts', { line: 4 }, { line: 7, character: 0 }), 'a.ts:5-7');
  assert.equal(selectionLabel('a.ts', { line: 4 }, { line: 4, character: 9 }), 'a.ts:5');
});
