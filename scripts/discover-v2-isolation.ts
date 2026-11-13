/** Check: the isolated test server lists no models from a local LM Studio. */
import assert from 'node:assert/strict';
import { modelFixture } from './fixtures/model';
import { isolatedServer } from './fixtures/server';
const model = await modelFixture();
const s = await isolatedServer(model.config);
await s.start();
const list = await (await fetch(`${s.baseUrl}/api/model?location%5Bdirectory%5D=${encodeURIComponent(s.project)}`, { headers: s.headers })).json() as { data: { providerID: string; id: string; limit: { context: number } }[] };
const local = list.data.filter(m => m.providerID === 'lmstudio');
console.log('lmstudio models listed:', local.length, local.slice(0, 3).map(m => `${m.id}:${m.limit.context}`));
assert.ok(!local.some(m => m.id === 'qwen3-coder-30b-a3b-instruct' && m.limit.context === 65536), 'the developer machine\'s loaded model is not listed');
console.log('fixture models:', list.data.filter(m => m.providerID === 'fixture').map(m => m.id));
await s.stop(); await model.stop();
