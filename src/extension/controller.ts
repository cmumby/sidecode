import { createHash, randomBytes } from 'node:crypto';
import { basename, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as vscode from 'vscode';
import { Connection } from '../adapter/connection';
import { createTransport, type Credentials } from '../adapter/transport';
import { assertSafeAuth, ConnectionError, errorCode, normalizeUrl } from '../adapter/errors';
import { errorMessages } from '../shared/connection';
import type { ConnectionAction, ChatCommand, contextSources } from '../shared/protocol';

import { Chat, type PendingContext } from '../adapter/chat';
import { limits } from '../shared/chat';
import { projectLabel, projectTarget, selectionLabel } from './context';
import { notice } from './notify';
import { applyPatch } from '../adapter/patch';
import type { ChangeSource } from '../adapter/conversations';
import { createConversations } from '../adapter/conversations';

export class Controller implements vscode.Disposable {
  readonly connection = new Connection();
  readonly chat = new Chat();
  private output = vscode.window.createOutputChannel('OpenCode Connection');
  private epoch = 0;
  /** The workspace quick pick is open (prevents stacking pickers). */
  private picking = false;
  /** Project directory of the current connection; context is limited to it. */
  private project: string | undefined;
  /** Read-only preview documents (proposed / before versions), registered on first use. */
  private previews = new Map<string, string>();
  private previewProvider: vscode.Disposable | undefined;
  private disposed = false;
  private subscriptions: vscode.Disposable[];
  constructor(private context: vscode.ExtensionContext) {
    this.chat.askNewSessions = context.globalState?.get<boolean>('askBeforeEdits', false) ?? false;
    let previous = this.chat.state;
    const watchChat = this.chat.subscribe(() => {
      const next = this.chat.state;
      const found = notice(previous, next, this.viewVisible && (vscode.window.state?.focused ?? true));
      previous = next;
      if (found && vscode.workspace.getConfiguration('sidecode').get<boolean>('notifications', true)) void this.notify(found.kind, found.title);
    });
    const stop = this.connection.subscribe((state) => {
      this.chat.connection(state.phase === 'connected');
      // Only locally defined enumerations/numbers: never format an SDK error or payload.
      this.output.appendLine(`phase=${state.phase} retry=${state.attempt} code=${state.error ?? 'none'}`);
    });
    this.subscriptions = [
      { dispose: stop }, { dispose: watchChat },
      { dispose: this.connection.onEvent(event => this.chat.event(event)) },
      vscode.workspace.onDidChangeConfiguration((event) => { if (event.affectsConfiguration('sidecode.serverUrl')) this.disconnect(); }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.disconnect()),
    ];
  }
  private url(): string { return normalizeUrl(vscode.workspace.getConfiguration('sidecode').get<string>('serverUrl', 'http://127.0.0.1:4096')); }
  private key(url: string): string { return `server-auth:${createHash('sha256').update(url).digest('hex')}`; }
  private disconnect(): void { this.project = undefined; this.epoch++; this.chat.clear(); this.connection.disconnect(); }
  async action(type: ConnectionAction): Promise<void> {
    if (this.disposed || type === 'ready') return;
    const actionEpoch = this.epoch;
    // Action names only; never values, URLs or credentials.
    this.output.appendLine(`action=${type}`);
    if (type === 'disconnect') { this.disconnect(); return; }
    if (type === 'diagnostics') { this.output.show(true); return; }
    // No shared lock: a new input box cancels an open one (its flow sees `undefined` and
    // stops), and the epoch discards stale Connect attempts. A lock held across slow
    // keyring calls used to make every later button click silently do nothing.
    try {
      if (type === 'configure') { await this.askUrl(actionEpoch); return; }
      const url = this.url();
      if (type === 'clearCredentials') { this.disconnect(); await this.context.secrets.delete(this.key(url)); return; }
      if (type === 'credentials') {
        assertSafeAuth(url);
        const username = await vscode.window.showInputBox({ title: 'OpenCode server username', value: 'opencode', ignoreFocusOut: true,
          validateInput: (value) => value && !/[:\r\n]/.test(value) ? null : 'Enter a username without colons or line breaks.' });
        if (actionEpoch !== this.epoch || username === undefined) return;
        const password = await vscode.window.showInputBox({ title: 'OpenCode server password', password: true, ignoreFocusOut: true,
          validateInput: (value) => value ? null : 'Enter the server password.' });
        if (actionEpoch !== this.epoch || password === undefined) return;
        this.disconnect();
        await this.withTimeout(this.context.secrets.store(this.key(url), JSON.stringify({ username, password })), 'store');
        return;
      }
      if (!vscode.workspace.isTrusted) { this.connection.fail('untrusted'); return; }
      // First use: nothing saved yet, so confirm the address instead of silently trying the default.
      const saved = vscode.workspace.getConfiguration('sidecode').inspect<string>('serverUrl');
      if (saved?.globalValue === undefined && saved?.workspaceValue === undefined && saved?.workspaceFolderValue === undefined) {
        if (!await this.askUrl(actionEpoch, 'Connect to OpenCode: server URL')) return;
        return await this.action('connect'); // Now saved: connect to the confirmed address.
      }
      this.disconnect();
      const epoch = this.epoch;
      const folders = vscode.workspace.workspaceFolders ?? [];
      let uri: vscode.Uri | undefined;
      if (folders.length === 1) uri = folders[0]!.uri;
      else if (folders.length > 1) uri = (await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Choose the OpenCode project folder' }))?.uri;
      else uri = (await vscode.window.showOpenDialog({ title: 'Choose the OpenCode project folder', canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Use project folder' }))?.[0];
      if (epoch !== this.epoch || !uri) return;
      if (!['file', 'vscode-remote'].includes(uri.scheme)) { this.connection.fail('context'); return; }
      let credentials: Credentials | undefined;
      try {
        const saved = await this.withTimeout(this.context.secrets.get(this.key(url)), 'read');
        if (saved) {
          const value: unknown = JSON.parse(saved);
          if (!value || typeof value !== 'object' || !('username' in value) || !('password' in value)
            || typeof value.username !== 'string' || typeof value.password !== 'string' || /[:\r\n]/.test(value.username)) throw new Error();
          credentials = { username: value.username, password: value.password };
        }
      } catch { if (epoch === this.epoch) this.connection.fail('credentials'); return; }
      if (epoch !== this.epoch) return;
      const transport = createTransport({ baseUrl: url, directory: uri.fsPath, ...(credentials ? { credentials } : {}) });
      this.project = uri.fsPath;
      this.chat.attach(createConversations({ baseUrl: url, directory: uri.fsPath, ...(credentials ? { credentials } : {}) }));
      void this.connection.connect(transport);
    } catch (error) {
      if (this.disposed) return;
      this.connection.fail(error instanceof ConnectionError ? error.code : type === 'credentials' || type === 'clearCredentials' ? 'credentials' : errorCode(error));
    }
  }
  /**
   * Explicit URL prompt; saves only on confirmation. Returns false when cancelled. Saving
   * fires the configuration listener, which disconnects any current connection.
   */
  private async askUrl(epoch: number, title = 'OpenCode server URL'): Promise<boolean> {
    const value = await vscode.window.showInputBox({ title, prompt: 'Address of a running `opencode serve` (for example http://127.0.0.1:4096).',
      value: vscode.workspace.getConfiguration('sidecode').get<string>('serverUrl', 'http://127.0.0.1:4096'), ignoreFocusOut: true,
      validateInput: (value) => { try { normalizeUrl(value); return null; } catch { return errorMessages.invalidUrl; } } });
    if (epoch !== this.epoch || value === undefined) return false;
    await vscode.workspace.getConfiguration('sidecode').update('serverUrl', normalizeUrl(value), vscode.ConfigurationTarget.Global);
    return true;
  }
  /** Set by the view provider; notifications are only for when the view cannot be seen. */
  viewVisible = false;
  private async notify(kind: 'finished' | 'failed' | 'approval', title: string): Promise<void> {
    const where = title ? ` in “${title}”` : '';
    const text = kind === 'approval' ? `OpenCode is waiting for your approval${where}.` : kind === 'failed' ? `OpenCode could not complete the reply${where}.` : `OpenCode finished replying${where}.`;
    const show = kind === 'finished' ? vscode.window.showInformationMessage : vscode.window.showWarningMessage;
    // A notification only; the view opens only if you choose Show.
    if (await show(text, 'Show') === 'Show' && !this.disposed) await vscode.commands.executeCommand('sidecode.chat.focus');
  }
  /** Secret storage can wait on the system keyring; bound it so failures are visible. */
  secretTimeout = 10000;
  private withTimeout<T>(work: Thenable<T>, operation: 'read' | 'store'): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => { timer = setTimeout(() => {
      this.output.appendLine(`credentials=${operation}-timeout`);
      reject(new ConnectionError('credentials'));
    }, this.secretTimeout); })]).finally(() => clearTimeout(timer));
  }
  async conversation(command: ChatCommand): Promise<void> {
    if (this.disposed || !vscode.workspace.isTrusted) return;
    switch (command.type) {
      case 'refresh': await Promise.all([this.chat.refresh(), this.chat.loadOptions()]); break;
      case 'newSession': await this.chat.create(); break;
      case 'selectSession': await this.chat.select(command.sessionId); break;
      case 'send': await this.chat.send(command.sessionId, command.text, command.requestId, { agent: command.agent, model: command.model }); break;
      case 'stop': await this.chat.stop(command.sessionId); break;
      case 'compact': await this.chat.compact(command.sessionId); break;
      case 'editApproval':
        // Remember the choice for new sessions (extension storage, not user settings).
        this.chat.askNewSessions = command.ask; void this.context.globalState?.update('askBeforeEdits', command.ask);
        await this.chat.setEditApproval(command.sessionId, command.ask); break;
      case 'older': await this.chat.older(); break;
      case 'permission': await this.chat.reply(command.sessionId, command.requestId, command.reply); break;
      case 'addContext': await this.addContext(command.sessionId, command.source); break;
      case 'removeContext': this.chat.removeContext(command.sessionId, command.contextId); break;
      case 'reviewPermission': await this.reviewPermission(command.sessionId, command.requestId); break;
      case 'openChange': await this.openChange(command.sessionId, command.toolId, command.view); break;
    }
  }
  private async inProject(path: string): Promise<string | undefined> { return this.project ? projectLabel(this.project, path) : undefined; }
  private entry(kind: 'file' | 'folder', label: string, path: string, note = ''): PendingContext {
    return { item: { id: `ctx_${randomBytes(8).toString('hex')}`, kind, label: kind === 'folder' ? label + '/' : label, note },
      part: { type: 'file', mime: kind === 'folder' ? 'application/x-directory' : 'text/plain', filename: label, url: pathToFileURL(path).href } };
  }
  private async addContext(sessionId: string, source: typeof contextSources[number]): Promise<void> {
    if (!this.project || sessionId !== this.chat.state.selectedId || this.picking) return;
    const epoch = this.epoch;
    const tell = (message: string) => { void vscode.window.showInformationMessage(message); };
    const editor = vscode.window.activeTextEditor;
    if (source === 'activeFile') {
      if (!editor || editor.document.uri.scheme !== 'file') { tell('Open a saved project file in the editor first, or attach a selection.'); return; }
      const label = await this.inProject(editor.document.uri.fsPath);
      if (!label) { tell('Only files inside the connected project folder can be attached.'); return; }
      if (epoch === this.epoch) this.chat.addContext(sessionId, [this.entry('file', label, editor.document.uri.fsPath, editor.document.isDirty ? 'Unsaved changes are not included; OpenCode reads the saved file.' : '')]);
      return;
    }
    if (source === 'selection') {
      if (!editor || editor.selection.isEmpty) { tell('Select text in the editor first.'); return; }
      const text = editor.document.getText(editor.selection);
      if (text.length > limits.selection) { tell('The selection is too large to attach. Attach the file instead.'); return; }
      const name = (editor.document.uri.scheme === 'file' && await this.inProject(editor.document.uri.fsPath)) || basename(editor.document.fileName) || 'Untitled';
      const label = selectionLabel(name, editor.selection.start, editor.selection.end).slice(0, limits.contextLabel);
      // Exactly the text shown in the editor (unsaved edits included), sent as data.
      if (epoch === this.epoch) this.chat.addContext(sessionId, [{ item: { id: `ctx_${randomBytes(8).toString('hex')}`, kind: 'selection', label, note: '' },
        part: { type: 'file', mime: 'text/plain', filename: label, url: `data:text/plain;base64,${Buffer.from(text).toString('base64')}` } }]);
      return;
    }
    this.picking = true;
    try {
      const project = this.project;
      const files = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file(project), '**/*'), '{**/node_modules/**,**/.git/**}', 5000);
      if (epoch !== this.epoch) return;
      const paths = files.filter(uri => uri.scheme === 'file').map(uri => relative(project, uri.fsPath).split(sep).join('/')).filter(path => path && !path.startsWith('../')).sort();
      const folders = [...new Set(paths.flatMap(path => path.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/'))))].sort();
      const items = [...folders.map(label => ({ label: label + '/', description: 'Folder', path: label, type: 'folder' as const })), ...paths.map(label => ({ label, description: '', path: label, type: 'file' as const }))];
      const picked = await vscode.window.showQuickPick(items, { title: 'Attach to the next OpenCode message', placeHolder: 'Choose project files or folders', canPickMany: true, matchOnDescription: true, ignoreFocusOut: true });
      if (!picked?.length || epoch !== this.epoch) return;
      const dirty = new Set(vscode.workspace.textDocuments.filter(doc => doc.isDirty && doc.uri.scheme === 'file').map(doc => doc.uri.fsPath));
      const entries: PendingContext[] = [];
      for (const choice of picked.slice(0, limits.context)) {
        const path = join(project, ...choice.path.split('/'));
        const label = await this.inProject(path);
        if (label) entries.push(this.entry(choice.type, label, path, dirty.has(path) ? 'Unsaved changes are not included; OpenCode reads the saved file.' : ''));
      }
      if (epoch === this.epoch && entries.length) this.chat.addContext(sessionId, entries);
    } finally { this.picking = false; }
  }
  private preview(name: string, content: string): vscode.Uri {
    this.previewProvider ??= vscode.workspace.registerTextDocumentContentProvider('sidecode-preview', { provideTextDocumentContent: uri => this.previews.get(uri.path.split('/')[1] ?? '') ?? '' });
    const id = randomBytes(8).toString('hex');
    this.previews.set(id, content);
    while (this.previews.size > 20) this.previews.delete(this.previews.keys().next().value!);
    return vscode.Uri.from({ scheme: 'sidecode-preview', path: `/${id}/${name}` });
  }
  private async readDisk(path: string): Promise<string | undefined> {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(await vscode.workspace.fs.readFile(vscode.Uri.file(path))); } catch { return undefined; }
  }
  private async target(source: ChangeSource) {
    const target = this.project ? await projectTarget(this.project, source.path) : undefined;
    if (!target) void vscode.window.showInformationMessage('This change is outside the connected project folder, so it is not opened.');
    return target;
  }
  private async showPatch(name: string, patch: string, reason: string): Promise<void> {
    void vscode.window.showInformationMessage(reason);
    await vscode.window.showTextDocument(this.preview(`${name}.diff`, patch), { preview: true });
  }
  /** Proposed edit of a pending permission: current file ↔ patched copy. Opens views only; never answers the request. */
  private async reviewPermission(sessionId: string, requestId: string): Promise<void> {
    const source = this.chat.reviewSource(sessionId, requestId);
    if (!source?.patch) return;
    const target = await this.target(source);
    if (!target) return;
    const current = target.exists ? await this.readDisk(target.path) : '';
    const name = basename(target.path);
    const proposed = current === undefined ? undefined : applyPatch(current, source.patch);
    if (proposed === undefined) { await this.showPatch(name, source.patch, 'The proposed change does not match the file on disk, so the patch is shown instead.'); return; }
    const left = target.exists ? vscode.Uri.file(target.path) : this.preview(name, '');
    await vscode.commands.executeCommand('vscode.diff', left, this.preview(name, proposed), `${target.label} ↔ Proposed by OpenCode`, { preview: true });
  }
  /** A completed edit/write: open the file, or show before ↔ current (the patch reversed against the file). */
  private async openChange(sessionId: string, toolId: string, view: 'file' | 'diff'): Promise<void> {
    const source = this.chat.changeSource(sessionId, toolId);
    if (!source) return;
    const target = await this.target(source);
    if (!target) return;
    if (!target.exists) { void vscode.window.showInformationMessage('The file no longer exists.'); return; }
    const file = vscode.Uri.file(target.path);
    if (view === 'file') { await vscode.window.showTextDocument(file, { preview: true }); return; }
    const name = basename(target.path);
    const title = `${target.label} (changes by OpenCode)`;
    if (source.created) { await vscode.commands.executeCommand('vscode.diff', this.preview(name, ''), file, title, { preview: true }); return; }
    if (!source.patch) return;
    const current = await this.readDisk(target.path);
    const before = current === undefined ? undefined : applyPatch(current, source.patch, true);
    if (before === undefined) { await this.showPatch(name, source.patch, 'The file has changed since this edit, so the original patch is shown instead.'); return; }
    await vscode.commands.executeCommand('vscode.diff', this.preview(name, before), file, title, { preview: true });
  }
  dispose(): void { this.previewProvider?.dispose(); this.previews.clear(); this.disposed = true; this.epoch++; this.chat.dispose(); this.connection.dispose(); this.subscriptions.forEach((item) => item.dispose()); this.output.dispose(); }
}
