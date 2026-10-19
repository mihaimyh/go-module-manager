import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { HostToWebview, RecoveryAction, ResolveProgress } from '../core/messages';
import type { PanelModel } from '../core/model';

/**
 * One panel, reused. The webview is a rendering of a model the host owns:
 * it never decides anything about versions, files or writes.
 */
export interface PanelHandlers {
  readonly onRefresh: () => void;
  readonly onRecover: (manifestPath: string, action: RecoveryAction) => void;
}

export class GmmPanel {
  private static current: GmmPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private progress: ResolveProgress | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private model: PanelModel,
    private handlers: PanelHandlers,
  ) {
    panel.webview.html = renderHtml(panel.webview, extensionUri);
    panel.webview.onDidReceiveMessage(
      (message: { type?: string; manifestPath?: string; action?: string }) => {
        if (message.type === 'ready') {
          this.post();
        }
        if (message.type === 'refresh') {
          this.handlers.onRefresh();
        }
        if (
          message.type === 'recover' &&
          typeof message.manifestPath === 'string' &&
          (message.action === 'repair' ||
            message.action === 'retry' ||
            message.action === 'install')
        ) {
          this.handlers.onRecover(message.manifestPath, message.action);
        }
      },
      undefined,
      this.disposables,
    );
    panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  static show(
    extensionUri: vscode.Uri,
    model: PanelModel,
    handlers: PanelHandlers,
  ): void {
    const existing = GmmPanel.current;
    if (existing) {
      existing.model = model;
      existing.progress = undefined;
      existing.handlers = handlers;
      existing.panel.reveal();
      existing.post();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'gmm.panel',
      'Go Module Manager',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
      },
    );

    GmmPanel.current = new GmmPanel(panel, extensionUri, model, handlers);
  }

  static update(model: PanelModel, progress?: ResolveProgress): void {
    const current = GmmPanel.current;
    if (!current) {
      return;
    }
    current.model = model;
    current.progress = progress;
    current.post();
  }

  static isOpen(): boolean {
    return GmmPanel.current !== undefined;
  }

  private post(): void {
    const message: HostToWebview = {
      type: 'model',
      model: this.model,
      ...(this.progress === undefined ? {} : { progress: this.progress }),
    };
    void this.panel.webview.postMessage(message);
  }

  private dispose(): void {
    GmmPanel.current = undefined;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }
}

function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = randomBytes(16).toString('base64');
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview.css'),
  );

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Go Module Manager</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}
