import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { UpdateRequest } from '../core/adapter';
import type {
  DependencySelection,
  HostToWebview,
  RecoveryAction,
  ResolveProgress,
} from '../core/messages';
import type { PanelModel } from '../core/model';

/**
 * One panel, reused. The webview is a rendering of a model the host owns:
 * it never decides anything about versions, files or writes.
 */
export interface PanelHandlers {
  readonly onRefresh: () => void;
  readonly onRecover: (manifestPath: string, action: RecoveryAction) => void;
  readonly onUpdate: (request: UpdateRequest) => void;
  readonly onBulkUpdate: (selection: readonly DependencySelection[]) => void;
  readonly onTidy: (manifests: readonly string[]) => void;
  readonly onScan: (manifests: readonly string[]) => void;
  readonly onInstallScanner: () => void;
  readonly onVersions: (modulePath: string) => void;
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
      (message: {
        type?: string;
        manifestPath?: string;
        action?: string;
        name?: string;
        version?: string;
        modulePath?: string;
        selection?: unknown;
        manifests?: unknown;
      }) => {
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
            message.action === 'install' ||
            message.action === 'clean-checksum-cache')
        ) {
          this.handlers.onRecover(message.manifestPath, message.action);
        }
        if (
          message.type === 'update' &&
          typeof message.manifestPath === 'string' &&
          typeof message.name === 'string' &&
          typeof message.version === 'string'
        ) {
          // Only rows the host already knows about may be written.
          const known = this.model.rows.some(
            (row) => row.manifestPath === message.manifestPath && row.name === message.name,
          );
          if (known) {
            this.handlers.onUpdate({
              manifestPath: message.manifestPath,
              changes: [{ name: message.name, version: message.version }],
            });
          }
        }
        if (message.type === 'bulk-update') {
          const selection = toSelection(message.selection, this.model);
          if (selection.length > 0) {
            this.handlers.onBulkUpdate(selection);
          }
        }
        if (message.type === 'tidy') {
          this.handlers.onTidy(toManifests(message.manifests, this.model));
        }
        if (message.type === 'scan') {
          this.handlers.onScan(toManifests(message.manifests, this.model));
        }
        if (message.type === 'install-scanner') {
          this.handlers.onInstallScanner();
        }
        if (message.type === 'versions' && typeof message.modulePath === 'string') {
          const known = this.model.rows.some((row) => row.name === message.modulePath);
          if (known) {
            this.handlers.onVersions(message.modulePath);
          }
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

  static clearSelection(): void {
    const current = GmmPanel.current;
    if (current === undefined) {
      return;
    }
    const message: HostToWebview = { type: 'clear-selection' };
    void current.panel.webview.postMessage(message);
  }

  static postVersions(modulePath: string, versions: readonly string[]): void {
    const current = GmmPanel.current;
    if (current === undefined) {
      return;
    }
    const message: HostToWebview = { type: 'versions', modulePath, versions };
    void current.panel.webview.postMessage(message);
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

function toSelection(value: unknown, model: PanelModel): DependencySelection[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const selection: DependencySelection[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const { manifestPath, name } = entry as { manifestPath?: unknown; name?: unknown };
    if (typeof manifestPath !== 'string' || typeof name !== 'string') {
      continue;
    }
    const key = `${manifestPath}#${name}`;
    if (seen.has(key)) {
      continue;
    }
    const known = model.rows.some(
      (row) => row.manifestPath === manifestPath && row.name === name,
    );
    if (known) {
      seen.add(key);
      selection.push({ manifestPath, name });
    }
  }
  return selection;
}

function toManifests(value: unknown, model: PanelModel): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is string =>
      typeof entry === 'string' &&
      model.projects.some((project) => project.manifestPath === entry),
  );
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
      content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; worker-src ${webview.cspSource};"
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
