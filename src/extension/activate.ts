import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { actions, isWebviewMessage, type ChatCommand, type ConnectionAction, type HostMessage } from '../shared/protocol';
import { webviewHtml } from './html';
import { Controller } from './controller';

export function activate(context: vscode.ExtensionContext): void {
  const controller = new Controller(context);
  context.subscriptions.push(controller);
  for (const action of actions.filter((action) => action !== 'ready')) {
    context.subscriptions.push(vscode.commands.registerCommand(`sidecode.${action}`, () => controller.action(action)));
  }
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('sidecode.chat', {
    resolveWebviewView(view) {
      const resources = vscode.Uri.joinPath(context.extensionUri, 'dist');
      view.webview.options = { enableScripts: true, localResourceRoots: [resources] };
      const send = () => {
        const message: HostMessage = { version: 1, type: 'connection', state: controller.connection.state };
        void view.webview.postMessage(message).then(undefined, () => { /* View closed during delivery. */ });
      };
      const sendChat = () => {
        const message: HostMessage = { version: 1, type: 'chat', state: controller.chat.state };
        void view.webview.postMessage(message).then(undefined, () => {});
      };
      const unsubscribeChat = controller.chat.subscribe(sendChat);
      const unsubscribe = controller.connection.subscribe(send);
      const listener = view.webview.onDidReceiveMessage((message: unknown) => {
        if (!isWebviewMessage(message)) return;
        if (message.type === 'ready') { send(); sendChat(); }
        else if (actions.some(action => action === message.type)) void controller.action(message.type as ConnectionAction);
        else void controller.conversation(message as ChatCommand);
      });
      controller.viewVisible = view.visible;
      const visibility = view.onDidChangeVisibility(() => { controller.viewVisible = view.visible; });
      const disposal = view.onDidDispose(() => { controller.viewVisible = false; visibility.dispose(); unsubscribe(); unsubscribeChat(); listener.dispose(); disposal.dispose(); });
      context.subscriptions.push({ dispose: unsubscribe }, { dispose: unsubscribeChat }, listener, disposal);
      view.webview.html = webviewHtml({
        script: view.webview.asWebviewUri(vscode.Uri.joinPath(resources, 'webview.js')).toString(),
        style: view.webview.asWebviewUri(vscode.Uri.joinPath(resources, 'webview.css')).toString(),
        source: view.webview.cspSource,
        nonce: randomBytes(24).toString('base64'),
      });
    },
  }));
}
