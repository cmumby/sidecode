import type { ErrorCode } from '../shared/connection';
export class ConnectionError extends Error {
  constructor(readonly code: ErrorCode) { super(code); }
}
export function errorCode(error: unknown): ErrorCode {
  return error instanceof ConnectionError ? error.code : error instanceof SyntaxError ? 'incompatible' : 'unavailable';
}
export function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return url.toString().replace(/\/+$/, '');
  } catch { throw new ConnectionError('invalidUrl'); }
}
export function assertSafeAuth(baseUrl: string): void {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new ConnectionError('insecureAuth');
}
