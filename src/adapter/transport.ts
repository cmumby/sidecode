import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import { ConnectionError, assertSafeAuth, normalizeUrl } from './errors';

export interface Credentials { username: string; password: string }
export interface ConnectionOptions { baseUrl: string; directory: string; credentials?: Credentials }
export interface Transport {
  health(signal: AbortSignal): Promise<void>;
  sessions(signal: AbortSignal): Promise<void>;
  events(signal: AbortSignal): AsyncIterable<unknown>;
}
export function validEvent(value: unknown): value is { type: string; properties: Record<string, unknown> } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return typeof event.type === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(event.type)
    && typeof event.properties === 'object' && event.properties !== null && !Array.isArray(event.properties);
}
/** Only client-side SDK code; never starts a server. */
export function createApiClient(options: ConnectionOptions, fetcher: typeof fetch = fetch) {
  const baseUrl = normalizeUrl(options.baseUrl);
  const headers: Record<string, string> = {};
  if (options.credentials) {
    assertSafeAuth(baseUrl);
    headers.Authorization = `Basic ${Buffer.from(`${options.credentials.username}:${options.credentials.password}`).toString('base64')}`;
  }
  const checkedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    let response: Response;
    try { response = await fetcher(request, { redirect: 'error' }); }
    catch { throw new ConnectionError('unavailable'); }
    let code: 'authRequired' | 'serverError' | 'incompatible' | undefined;
    if (response.status === 401 || response.status === 403) code = 'authRequired';
    else if (response.status >= 500 || response.status === 429) code = 'serverError';
    else if (!response.ok) code = 'incompatible';
    const expected = new URL(request.url).pathname.endsWith('/event') ? 'text/event-stream' : 'application/json';
    const emptyPromptAck = response.status === 204 && request.method === 'POST' && /\/session\/[^/]+\/prompt_async$/.test(new URL(request.url).pathname);
    if (!code && !emptyPromptAck && response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== expected) code = 'incompatible';
    if (code) { await response.body?.cancel(); throw new ConnectionError(code); }
    return response;
  };
  return createOpencodeClient({ baseUrl, directory: options.directory, headers, fetch: checkedFetch, throwOnError: true });
}
export function createTransport(options: ConnectionOptions, fetcher: typeof fetch = fetch): Transport {
  const client = createApiClient(options, fetcher);
  return {
    async health(signal) {
      const { data } = await client.global.health({ signal });
      if (data?.healthy !== true || typeof data.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(data.version)) throw new ConnectionError('incompatible');
    },
    async sessions(signal) {
      const { data } = await client.session.list({ directory: options.directory }, { signal });
      // Phase 2 does not expose session data. Phase 3 will validate every field it consumes.
      if (!Array.isArray(data) || data.some((session) => typeof session !== 'object' || !session || typeof session.id !== 'string')) throw new ConnectionError('incompatible');
    },
    async *events(signal) {
      let failure: unknown;
      const result = await client.event.subscribe({ directory: options.directory }, {
        signal, sseMaxRetryAttempts: 1, onSseError: (error) => { failure = error; },
      });
      try {
        for await (const event of result.stream) {
          if (!validEvent(event)) throw new ConnectionError('incompatible');
          yield event;
        }
        if (failure) throw failure;
      } finally { await result.stream.return(); }
    },
  };
}
