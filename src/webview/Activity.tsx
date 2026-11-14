import type { ReactNode } from 'react';
import type { Attachment, ContextItem, FileChange, PermissionPrompt, PermissionReply, RetryStatus, ToolCall } from '../shared/chat';

/** Step states shown by shape and color (never color alone), with a text label for assistive technology. */
export type StepState = 'queued' | 'running' | 'done' | 'failed' | 'waiting' | 'unknown';
const stepLabels: Record<StepState, string> = { queued: 'Queued', running: 'Running', done: 'Done', failed: 'Failed', waiting: 'Needs you', unknown: 'Unknown' };
const glyphs: Record<StepState, string> = { queued: '', running: '', done: '✓', failed: '✕', waiting: '!', unknown: '' };

/** `label: null` when adjacent visible text already says the state. */
export function Mark({ state, label }: { state: StepState; label?: string | null }) {
  return <><span className={`mark mark-${state}`} aria-hidden="true">{glyphs[state]}</span>{label !== null && <span className="tool-status visually-hidden">{label ?? stepLabels[state]}</span>}</>;
}

function ChangeSummary({ change }: { change: FileChange }) {
  return <span className="change-summary"><span className="chip-label">{change.label}</span>
    {change.diff && <> <span className="additions" aria-label={`${change.additions} lines added`}>+{change.additions}</span> <span className="deletions" aria-label={`${change.deletions} lines removed`}>−{change.deletions}</span></>}</span>;
}

/** While disconnected the real state is unknown; a request awaiting permission keeps its tool "running". */
export function stepState(tool: ToolCall, online: boolean, waiting: boolean): StepState {
  if (tool.status === 'completed') return 'done';
  if (tool.status === 'error') return 'failed';
  if (!online) return 'unknown';
  if (tool.status === 'pending') return 'queued';
  return waiting ? 'waiting' : 'running';
}
/** Tools that act on one file: the file name comes first so narrow views never cut it off. */
export const fileTools = new Set(['read', 'edit', 'write', 'patch', 'multiedit']);
function StepTitle({ tool }: { tool: ToolCall }) {
  if (fileTools.has(tool.tool)) {
    if (!tool.title) return tool.status === 'pending' ? <span className="tool-title muted-note">file not known yet</span> : null;
    if (!tool.title.includes('\n') && !tool.title.trim().startsWith('{')) {
      const slash = tool.title.lastIndexOf('/');
      const name = slash >= 0 ? tool.title.slice(slash + 1) : tool.title;
      const folder = slash > 0 ? tool.title.slice(0, slash) : '';
      return <span className="tool-title" title={tool.title}><span className="tool-file">{name || tool.title}</span>{folder && <span className="tool-dir">{folder}/</span>}</span>;
    }
  }
  return tool.title ? <span className="tool-title" title={tool.title}>{tool.title}</span> : null;
}
function firstLine(text: string): string { return text.split('\n').find(line => line.trim())?.trim() ?? ''; }
function lastLine(text: string): string { return text.split('\n').reverse().find(line => line.trim())?.trim() ?? ''; }

/**
 * One assistant message's tool calls as a step group. Active groups are open; finished
 * groups fold to a summary line. Tool output is untrusted and rendered as plain text.
 */
/** Elapsed times come from server timestamps (`started`, else the reply's `created`), so they survive session switches and view reloads. */
export function StepGroup({ tools, online, waiting, created, now }: { tools: ToolCall[]; online: boolean; waiting: boolean; created?: number | undefined; now?: number }) {
  if (!tools.length) return null;
  // Only the latest running tool is the one held by a permission request.
  const held = waiting ? tools.map(t => t.status).lastIndexOf('running') : -1;
  const states = tools.map((tool, index) => stepState(tool, online, index === held));
  const failed = states.filter(s => s === 'failed').length;
  const active = states.some(s => s === 'running' || s === 'queued' || s === 'waiting');
  const overall: StepState = states.includes('waiting') ? 'waiting' : states.includes('unknown') ? 'unknown' : active ? 'running' : failed ? 'failed' : 'done';
  const phrase = { waiting: 'waiting for you', unknown: 'updates paused', running: 'running', queued: 'queued', failed: `${failed} failed`, done: 'done' }[overall];
  const summary = `${tools.length} ${tools.length === 1 ? 'step' : 'steps'} · ${phrase}`;
  return <details className={`steps steps-${overall}`} open={active || overall === 'unknown'}>
    <summary><Mark state={overall} label={null} /><span className="steps-summary">{summary}</span></summary>
    <ul className="tools" aria-label="Tool calls">{tools.map((tool, index) => {
      const state = states[index]!;
      return <li key={tool.id} className={`tool tool-${tool.status}`} data-status={state}>
        <details>
          <summary><Mark state={state} /><span className="tool-text"><span className="tool-name">{tool.tool}</span> <StepTitle tool={tool} /></span>
            <span className="tool-meta">{tool.change?.diff ? <><span className="additions">+{tool.change.additions}</span> <span className="deletions">−{tool.change.deletions}</span></>
              : state === 'failed' ? <span className="failure">{firstLine(tool.detail) || 'Failed'}</span> : state === 'waiting' ? 'needs approval'
              : state === 'running' && tool.detail ? <span className="live-output" title="Latest output">{lastLine(tool.detail)}</span>
              : (state === 'queued' || state === 'running') ? <span>{state === 'queued' ? 'model is writing it' : 'running'}{(tool.started ?? created) && now !== undefined ? ` · ${formatElapsed(now - (tool.started ?? created)!)}` : ''}</span> : null}</span></summary>
          {tool.detail ? <pre className="tool-detail">{tool.detail}</pre> : <p className="tool-empty">{tool.status === 'error' ? 'No error details.' : tool.status === 'completed' ? 'No output.'
            : tool.status === 'pending' ? 'The model is still writing this step. OpenCode receives its details (such as the file and the change) only when the model finishes, so nothing more can be shown yet.' : 'No output yet.'}</p>}
        </details>
      </li>;
    })}</ul>
  </details>;
}

/** Files changed in a message stay visible (with native open/diff actions) after the step group folds. */
export function FileChanges({ tools, open }: { tools: ToolCall[]; open?: ((toolId: string, view: 'file' | 'diff') => void) | undefined }) {
  const changed = tools.filter(tool => tool.change);
  if (!changed.length) return null;
  return <ul className="file-changes" aria-label="Changed files">{changed.map(tool => <li key={tool.id} className="file-row">
    <ChangeSummary change={tool.change!} />
    {open && <span className="file-actions">
      <button type="button" className="link" onClick={() => open(tool.id, 'file')} aria-label={`Open ${tool.change!.label}`}>Open</button>
      {tool.change!.diff && <button type="button" className="link" onClick={() => open(tool.id, 'diff')} aria-label={`Show changes to ${tool.change!.label}`}>Changes</button>}
    </span>}
  </li>)}</ul>;
}

/**
 * Explicit approval UI. Nothing is focused or answered automatically; the broader
 * "always" scope sits behind a disclosure and states exactly what it covers.
 */
export function PermissionCard({ request, disabled, answer, review }: { request: PermissionPrompt; disabled: boolean; answer: (reply: PermissionReply) => void; review?: (() => void) | undefined }) {
  const heading = `permission-${request.id}`;
  const showPatterns = request.patterns.length > 0 && (!request.change || request.patterns.length > 1);
  return <section className="permission" aria-labelledby={heading}>
    <div className="permission-head"><span className="mark mark-waiting" aria-hidden="true">!</span><h3 id={heading}>Permission requested</h3></div>
    <p>{request.change ? 'OpenCode wants to edit this file:' : <>OpenCode wants to use <strong>{request.permission}</strong>{showPatterns ? ' for:' : '.'}</>}</p>
    {request.change && <div className="file-row proposed"><ChangeSummary change={request.change} /></div>}
    {showPatterns && <ul className="patterns">{request.patterns.map((pattern, index) => <li key={index}><code>{pattern}</code></li>)}</ul>}
    <div className="permission-actions">
      {request.change && review && <button type="button" className="link review" onClick={review}>Review changes</button>}
      <button type="button" disabled={disabled} onClick={() => answer('reject')}>Deny</button>
      <button type="button" className="primary" disabled={disabled} onClick={() => answer('once')}>Allow once</button>
    </div>
    {request.always.length > 0 && <details className="permission-more"><summary>More options</summary>
      <p>Always allow <strong>{request.permission}</strong> for {request.always.map((pattern, index) => <code key={index}>{pattern}</code>).reduce<ReactNode[]>((all, item, index) => index ? [...all, ', ', item] : [item], [])} in every session of this project, from now on. OpenCode saves this rule on the server, so it still applies after a restart. It is not added to your configuration file.</p>
      <button type="button" disabled={disabled} onClick={() => answer('always')}>Always allow</button>
    </details>}
  </section>;
}

const kindLabels: Record<Attachment['kind'], string> = { file: 'File', folder: 'Folder', selection: 'Selection' };

/** Attachments recorded on a sent message (labels only). */
export function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  if (!attachments.length) return null;
  return <ul className="attachments" aria-label="Attached context">{attachments.map((item, index) => <li key={index} className="chip" title={kindLabels[item.kind]}>
    <span className="visually-hidden">{kindLabels[item.kind]} </span><span className="chip-label">{item.label}</span>
  </li>)}</ul>;
}

/** Context waiting for the next message. Each item is removable; nothing is added without an explicit action. */
export function PendingContext({ items, disabled, remove }: { items: ContextItem[]; disabled: boolean; remove: (id: string) => void }) {
  if (!items.length) return null;
  return <ul className="attachments pending" aria-label="Context for the next message">{items.map(item => <li key={item.id} className="chip" title={kindLabels[item.kind]}>
    <span className="visually-hidden">{kindLabels[item.kind]} </span><span className="chip-label">{item.label}</span>
    <button type="button" className="chip-remove" disabled={disabled} aria-label={`Remove ${item.label}`} title="Remove" onClick={() => remove(item.id)}>×</button>
    {item.note && <span className="chip-note">{item.note}</span>}
  </li>)}</ul>;
}

/** Clock time of a message, like Claude Code: "6:48 PM" today, "Nov 12, 6:48 PM" on another day, with the year when it differs. */
export function formatClock(ms: number, today = Date.now()): string {
  const date = new Date(ms); const now = new Date(today);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return time;
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })}, ${time}`;
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/** The model's reasoning, as plain text. Open while it streams before the reply starts; folds afterwards. */
export function Thinking({ text, streaming, answered }: { text: string; streaming: boolean; answered: boolean }) {
  if (!text) return null;
  const live = streaming && !answered;
  return <details className="thinking" open={live}>
    <summary><Mark state={live ? 'running' : 'done'} label={null} />{live ? 'Thinking…' : 'Thought process'}</summary>
    <p className="thinking-text">{text}</p>
  </details>;
}

/** OpenCode keeps retrying a failing provider with growing delays; say so instead of spinning silently. */
export function RetryNotice({ retry, now }: { retry: RetryStatus; now: number }) {
  const wait = Math.max(0, retry.next - now);
  return <div className="banner banner-warning retry" role="status">
    <p><strong>The model provider returned an error.</strong> OpenCode is retrying (attempt {retry.attempt}{wait > 0 ? `, next try in ${formatElapsed(wait)}` : ', trying now'}).</p>
    {retry.message && <p className="provider-message"><span className="visually-hidden">Provider message: </span>{retry.message}</p>}
    <p className="hint">Check that the model is loaded and the provider is running (for example LM Studio), or press Stop.</p>
  </div>;
}
