/** Discovery only: which custom-agent configuration OpenCode 2.3.0 lists. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isolatedServer } from './fixtures/server';
const agent = { description: 'Test-only reviewer', mode: 'primary' };
const cases: [string, (dir: string) => Promise<void>][] = [
  ['opencode.json in config dir', dir => writeFile(join(dir, 'opencode.json'), JSON.stringify({ agents: { reviewer: agent } }))],
  ['agents/reviewer.md', async dir => { await mkdir(join(dir, 'agents'), { recursive: true }); await writeFile(join(dir, 'agents', 'reviewer.md'), '---\ndescription: Test-only reviewer\nmode: primary\n---\nYou review.\n'); }],
  ['agent/reviewer.md', async dir => { await mkdir(join(dir, 'agent'), { recursive: true }); await writeFile(join(dir, 'agent', 'reviewer.md'), '---\ndescription: Test-only reviewer\nmode: primary\n---\nYou review.\n'); }],
];
for (const [label, setup] of cases) {
  const s = await isolatedServer({});
  await mkdir(join(s.root, 'config'), { recursive: true });
  await setup(join(s.root, 'config'));
  await s.start();
  const q = `location%5Bdirectory%5D=${encodeURIComponent(s.project)}`;
  const a = await (await fetch(`${s.baseUrl}/api/agent?${q}`, { headers: s.headers })).json() as { data: { id: string; mode: string }[] };
  console.log(label, '=>', a.data.map(x => `${x.id}:${x.mode}`).join(','));
  await s.stop();
}
