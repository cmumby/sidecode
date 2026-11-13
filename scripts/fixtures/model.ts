import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
/** Deterministic inference fixture; the real OpenCode server still owns the agent/session loop. */
export async function modelFixture(delay = 100) {
  const requests: unknown[] = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw) as { stream?: boolean; messages?: { role: string; content?: unknown }[]; tools?: unknown[] }; requests.push(body);
    const messages = body.messages ?? [];
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const lastText = JSON.stringify(lastUser?.content ?? '');
    // Test-only script: a prompt containing RUN_TOOL requests one harmless bash call
    // after OpenCode returns the tool result, the model answers with text.
    // RUN_WRITE creates notes.md; RUN_EDIT changes src/a.ts (both relative to the project).
    const script = lastText.includes('RUN_WRITE') ? { name: 'write', args: { filePath: 'notes.md', content: '# Notes\nsidecode-written\n' } }
      : lastText.includes('RUN_EDIT') ? { name: 'edit', args: { filePath: 'src/a.ts', oldString: 'const value = 1;', newString: 'const value = 2; // sidecode-edited' } }
      : lastText.includes('RUN_LONGWRITE') ? { name: 'write', args: {} }
      : lastText.includes('RUN_SLOW') ? { name: 'bash', args: { command: 'echo sidecode-first; sleep 2; echo sidecode-second', description: 'Slow test command' } }
      : lastText.includes('RUN_TOOL') ? { name: 'bash', args: { command: 'echo sidecode-tool-ok', description: 'Print a test marker' } } : undefined;
    if (body.stream && script && messages.at(-1)?.role !== 'tool' && body.tools?.length) {
      const args = JSON.stringify(script.args);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: finish }], ...(finish ? { usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } } : {}) })}\n\n`;
      res.write(chunk({ role: 'assistant', content: 'Running a command.' }, null));
      await pause(delay);
      // RUN_LONGWRITE: stream the arguments in pieces, as a slow model writing a large file does.
      if (lastText.includes('RUN_LONGWRITE')) {
        const long = JSON.stringify({ filePath: 'notes.md', content: Array.from({ length: 40 }, (_, n) => `line ${n + 1} of a long generated file`).join('\n') + '\n' });
        res.write(chunk({ tool_calls: [{ index: 0, id: `call_${requests.length}`, type: 'function', function: { name: 'write', arguments: '' } }] }, null));
        for (const piece of long.match(/[\s\S]{1,60}/g) ?? []) { if (res.destroyed) return; await pause(delay); res.write(chunk({ tool_calls: [{ index: 0, function: { arguments: piece } }] }, null)); }
      } else res.write(chunk({ tool_calls: [{ index: 0, id: `call_${requests.length}`, type: 'function', function: { name: script.name, arguments: args } }] }, null));
      await pause(delay);
      res.end(chunk({}, 'tool_calls') + 'data: [DONE]\n\n');
      return;
    }
    // EMPTY_LOOP: the model says it will call a tool but sends none (seen with local
    // models whose tool calling is misconfigured); OpenCode keeps asking again.
    if (lastText.includes('EMPTY_LOOP') && body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 } })}\n\ndata: [DONE]\n\n`);
      return;
    }
    // FAIL_500: the provider keeps failing (OpenCode's retry path).
    if (lastText.includes('FAIL_500')) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'fixture provider failure', type: 'server_error' } })); return; }
    const text = messages.at(-1)?.role === 'tool' ? 'Tool finished: **done**.' : 'Fixture reply: **hello**.\n\n```ts\nconst answer = 42;\n```';
    if (!body.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'fixture', object: 'chat.completion', created: 1, model: 'fixture', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    // RUN_REASON: stream `reasoning_content` first, as thinking models served by LM Studio do.
    if (lastText.includes('RUN_REASON') && messages.at(-1)?.role !== 'tool') for (const part of ['Considering ', 'the question ', 'carefully.']) {
      if (res.destroyed) return;
      res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { reasoning_content: part }, finish_reason: null }] })}\n\n`);
      await pause(delay * 3);
    }
    for (const part of text.match(/.{1,8}|\n/g) ?? []) {
      if (res.destroyed) return;
      res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { content: part }, finish_reason: null }] })}\n\n`);
      await pause(delay);
    }
    res.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\ndata: [DONE]\n\n`);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No model fixture port');
  const config = { model: 'fixture/fixture', small_model: 'fixture/fixture', provider: { fixture: { npm: '@ai-sdk/openai-compatible', name: 'Test fixture', options: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'test-only' }, models: { fixture: { name: 'Fixture', limit: { context: 32000, output: 4096 } } } } } };
  return { config, requests, stop: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
