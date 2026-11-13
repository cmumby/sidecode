import { record } from '../shared/chat';
import { ApiError, createApi, locationQuery, readEvents, type ConnectionOptions } from './api';
import { ConnectionError } from './errors';

export type { ConnectionOptions, Credentials } from './api';
export interface Transport {
  health(signal: AbortSignal): Promise<void>;
  sessions(signal: AbortSignal): Promise<void>;
  events(signal: AbortSignal): AsyncIterable<unknown>;
}
/** Internal event shape: OpenCode 2's `{ type, data }` with `data` as `properties`. */
export function validEvent(value: unknown): value is { type: string; properties: Record<string, unknown> } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return typeof event.type === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(event.type)
    && typeof event.properties === 'object' && event.properties !== null && !Array.isArray(event.properties);
}
/** Synthetic event for an SSE keepalive comment, so an idle but healthy stream is not timed out. */
export const heartbeat = { type: 'server.heartbeat', properties: {} } as const;
const semver = /^v?(\d+)\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/;

export function createTransport(options: ConnectionOptions, fetcher: typeof fetch = fetch): Transport {
  const api = createApi(options, fetcher);
  return {
    async health(signal) {
      let info: unknown;
      try { info = await api.get('/api/info', { signal }); }
      catch (error) {
        // OpenCode 1.x has no /api/info (it answers with its web app); it still has /global/health.
        if (!(error instanceof ConnectionError && error.code === 'incompatible') && !(error instanceof ApiError)) throw error;
        let old: unknown;
        try { old = await api.get('/global/health', { signal }); } catch { throw new ConnectionError('incompatible'); }
        if (record(old) && old.healthy === true && typeof old.version === 'string' && semver.exec(old.version)?.[1] === '1') throw new ConnectionError('oldServer');
        throw new ConnectionError('incompatible');
      }
      const major = record(info) && typeof info.version === 'string' ? semver.exec(info.version)?.[1] : undefined;
      if (major === undefined) throw new ConnectionError('incompatible');
      if (major !== '2') throw new ConnectionError(Number(major) < 2 ? 'oldServer' : 'incompatible');
    },
    async sessions(signal) {
      // OpenCode works on the server machine's files: a folder it does not have (for
      // example a Mac path sent to a Linux server) is reported as LocationNotFoundError.
      try {
        const location = await api.get('/api/location', { query: locationQuery(options.directory), signal });
        if (!record(location) || typeof location.directory !== 'string') throw new ConnectionError('incompatible');
      } catch (error) {
        if (error instanceof ApiError) throw new ConnectionError(error.tag === 'LocationNotFoundError' ? 'folderMissing' : 'incompatible');
        throw error;
      }
      const list = await api.get('/api/session', { query: { directory: options.directory, limit: 1 }, signal });
      if (!record(list) || !Array.isArray(list.data)) throw new ConnectionError('incompatible');
    },
    async *events(signal) {
      const body = await api.stream('/api/event', signal);
      for await (const data of readEvents(body, signal)) {
        if (data === null) { yield heartbeat; continue; }
        let event: unknown;
        try { event = JSON.parse(data); } catch { throw new ConnectionError('incompatible'); }
        if (!record(event) || typeof event.type !== 'string') throw new ConnectionError('incompatible');
        // The stream carries every project on the server; drop events for other folders.
        if (record(event.location) && typeof event.location.directory === 'string' && event.location.directory !== options.directory) continue;
        const properties = event.data === undefined ? {} : event.data;
        const normalized = { type: event.type, properties };
        if (!validEvent(normalized)) throw new ConnectionError('incompatible');
        yield normalized;
      }
      if (signal.aborted) throw new ConnectionError('timeout');
      throw new ConnectionError('streamClosed');
    },
  };
}
