import { disconnected, type ConnectionState } from '../shared/connection';
import { ConnectionError, errorCode } from './errors';
import { validEvent, type Transport } from './transport';

export interface Timing { requestMs: number; idleMs: number; backoffMs: number; stableMs: number }
const defaults: Timing = { requestMs: 10000, idleMs: 45000, backoffMs: 500, stableMs: 60000 };
const transient = new Set(['unavailable', 'timeout', 'serverError', 'streamClosed']);
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}
/** One owner for retries and cancellation. SDK retries are disabled in the transport. */
export class Connection {
  state: ConnectionState = { ...disconnected };
  private controller: AbortController | undefined;
  private eventListeners = new Set<(event: unknown) => void>();
  onEvent(listener: (event: unknown) => void): () => void { this.eventListeners.add(listener); return () => this.eventListeners.delete(listener); }
  private listeners = new Set<(state: ConnectionState) => void>();
  constructor(private timing: Timing = defaults) {}
  subscribe(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  private publish(state: ConnectionState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
  fail(code: ConnectionState['error']): void {
    this.disconnect(); this.publish({ phase: 'error', attempt: 0, error: code });
  }
  disconnect(): void {
    this.controller?.abort(); this.controller = undefined;
    this.publish({ ...disconnected });
  }
  dispose(): void { this.disconnect(); this.listeners.clear(); this.eventListeners.clear(); }
  async connect(transport: Transport): Promise<void> {
    this.controller?.abort();
    const owner = new AbortController(); this.controller = owner;
    const current = () => this.controller === owner && !owner.signal.aborted;
    let retries = 0;
    while (current()) {
      const attempt = new AbortController();
      const cancel = () => attempt.abort();
      owner.signal.addEventListener('abort', cancel, { once: true });
      let timeout = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const arm = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => { timeout = true; attempt.abort(); }, ms); };
      const update = (phase: ConnectionState['phase'], error: ConnectionState['error'] = null) => {
        if (current()) this.publish({ phase, attempt: retries, error });
      };
      let connectedAt: number | undefined;
      try {
        update('health'); arm(this.timing.requestMs); await transport.health(attempt.signal);
        if (!current()) return;
        if (timeout) throw new ConnectionError('timeout');
        update('sessions'); arm(this.timing.requestMs); await transport.sessions(attempt.signal);
        if (!current()) return;
        if (timeout) throw new ConnectionError('timeout');
        update('events'); arm(this.timing.requestMs);
        for await (const event of transport.events(attempt.signal)) {
          if (!current()) return;
          if (timeout) throw new ConnectionError('timeout');
          if (!validEvent(event)) throw new ConnectionError('incompatible');
          if (event.type === 'server.connected') {
            connectedAt ??= Date.now(); update('connected');
          }
          if (connectedAt !== undefined) arm(this.timing.idleMs);
          if (current()) for (const listener of this.eventListeners) listener(event);
        }
        throw new ConnectionError('streamClosed');
      } catch (error) {
        if (!current()) return;
        const code = timeout ? 'timeout' : errorCode(error);
        if (connectedAt !== undefined && Date.now() - connectedAt >= this.timing.stableMs) retries = 0;
        if (!transient.has(code) || retries >= 3) { update('error', code); return; }
        retries++; update('retrying', code);
      } finally {
        clearTimeout(timer); attempt.abort(); owner.signal.removeEventListener('abort', cancel);
      }
      await delay(this.timing.backoffMs * 2 ** (retries - 1), owner.signal);
    }
  }
}
