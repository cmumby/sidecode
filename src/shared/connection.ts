export const phases = ['disconnected', 'health', 'sessions', 'events', 'connected', 'retrying', 'error'] as const;
export const errorMessages = {
  invalidUrl: 'Enter an HTTP(S) server URL without credentials, query parameters or fragments.',
  authRequired: 'Server authentication failed. Set the server credentials and reconnect.',
  insecureAuth: 'Use HTTPS for authenticated servers outside loopback.',
  incompatible: 'Unexpected API response. Check the URL points to an OpenCode server.',
  unavailable: 'Cannot reach the server. Check its address and whether it is running.',
  timeout: 'The server stopped responding. Check the server and reconnect.',
  serverError: 'The server reported an error. Check the server and retry.',
  streamClosed: 'The event stream closed. Reconnect to resume updates.',
  untrusted: 'Trust this workspace before connecting to its OpenCode project.',
  credentials: 'Could not read or save credentials. Check the editor secret storage.',
  context: 'Select a local or remote filesystem folder for the OpenCode project.',
} as const;
export type ErrorCode = keyof typeof errorMessages;
export type ConnectionState = {
  phase: typeof phases[number];
  attempt: number;
  error: ErrorCode | null;
};
export const disconnected: ConnectionState = { phase: 'disconnected', attempt: 0, error: null };
