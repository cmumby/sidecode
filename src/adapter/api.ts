import { ConnectionError, assertSafeAuth, normalizeUrl } from './errors';

export interface Credentials { username: string; password: string }
export interface ConnectionOptions { baseUrl: string; directory: string; credentials?: Credentials }

/**
 * A 4xx answer the server declared, identified only by its `_tag` (for example
 * `LocationNotFoundError`). The server's message is dropped: it may contain paths.
 */
export class ApiError extends Error {
  constructor(readonly tag: string, readonly status: number) { super(tag); }
}
type Query = Record<string, string | number | boolean | undefined>;
export interface RequestOptions { query?: Query; body?: unknown; signal: AbortSignal }
export interface Api {
  get(path: string, options: RequestOptions): Promise<unknown>;
  post(path: string, options: RequestOptions): Promise<unknown>;
  patch(path: string, options: RequestOptions): Promise<unknown>;
  /** The raw event stream response (content type already checked). */
  stream(path: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}
/** Path segment from a validated identifier. */
export const segment = (value: string) => encodeURIComponent(value);
/** `location[directory]=…`, the form the official 2.x client sends for a location query. */
export const locationQuery = (directory: string): Query => ({ 'location[directory]': directory });

/**
 * Minimal OpenCode 2.x HTTP client for the endpoints Sidecode uses (paths and shapes
 * from the official `@opencode/client` 2.3.0 definitions). Never starts a server,
 * never follows redirects and never retries; the connection owns retries.
 */
export function createApi(options: ConnectionOptions, fetcher: typeof fetch = fetch): Api {
  const baseUrl = normalizeUrl(options.baseUrl);
  const headers: Record<string, string> = {};
  if (options.credentials) {
    assertSafeAuth(baseUrl);
    headers.Authorization = `Basic ${Buffer.from(`${options.credentials.username}:${options.credentials.password}`).toString('base64')}`;
  }
  async function send(method: string, path: string, request: RequestOptions, accept: 'json' | 'stream'): Promise<Response> {
    const url = new URL(baseUrl + path);
    for (const [key, value] of Object.entries(request.query ?? {})) if (value !== undefined) url.searchParams.append(key, String(value));
    let response: Response;
    try {
      response = await fetcher(new Request(url, { method, redirect: 'error', signal: request.signal,
        headers: { ...headers, accept: accept === 'json' ? 'application/json' : 'text/event-stream', ...(request.body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}) }));
    } catch { throw new ConnectionError(request.signal.aborted ? 'timeout' : 'unavailable'); }
    const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (response.status === 401 || response.status === 403) { await response.body?.cancel(); throw new ConnectionError('authRequired'); }
    if (response.status >= 500 || response.status === 429) { await response.body?.cancel(); throw new ConnectionError('serverError'); }
    if (!response.ok) {
      let tag = '';
      if (type === 'application/json') {
        try { const body: unknown = await response.json(); if (body && typeof body === 'object' && typeof (body as { _tag?: unknown })._tag === 'string') tag = (body as { _tag: string })._tag; } catch { /* no tag */ }
      } else await response.body?.cancel();
      if (/^[A-Za-z]{1,100}$/.test(tag)) throw new ApiError(tag, response.status);
      throw new ConnectionError('incompatible');
    }
    return response;
  }
  async function json(method: string, path: string, request: RequestOptions): Promise<unknown> {
    const response = await send(method, path, request, 'json');
    if (response.status === 204) { await response.body?.cancel(); return undefined; }
    // A path that is not an API route answers with the web app (HTML): not OpenCode 2.
    if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') { await response.body?.cancel(); throw new ConnectionError('incompatible'); }
    try { return await response.json(); } catch { throw new ConnectionError('incompatible'); }
  }
  return {
    get: (path, request) => json('GET', path, request),
    post: (path, request) => json('POST', path, { body: {}, ...request }),
    patch: (path, request) => json('PATCH', path, request),
    async stream(path, signal) {
      const response = await send('GET', path, { signal }, 'stream');
      if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'text/event-stream' || !response.body) { await response.body?.cancel(); throw new ConnectionError('incompatible'); }
      return response.body;
    },
  };
}

/**
 * Server-sent events: yields each `data:` payload, and `null` for a comment line
 * (OpenCode 2 sends `: heartbeat` comments). Oversized events are rejected.
 */
export async function* readEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<string | null> {
  const reader = body.getReader(); const decoder = new TextDecoder();
  let buffer = '';
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); } catch { throw new ConnectionError(signal.aborted ? 'timeout' : 'streamClosed'); }
      if (chunk.done) return;
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n?/g, '\n');
      if (buffer.length > 16 * 1024 * 1024) throw new ConnectionError('incompatible');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const lines = block.split('\n');
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (data) yield data;
        else if (lines.some(line => line.startsWith(':'))) yield null;
      }
    }
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}
