import * as vscode from 'vscode';
import type { PreviewResult } from '../core/adapter';
import type { HostToWebview, ReleaseNotes, ResolveProgress } from '../core/messages';
import type { PanelModel } from '../core/model';
import type { PanelHandlers } from './handlers';
import { renderWebviewHtml } from './webviewHtml';
import { handleWebviewMessage } from './webviewMessages';

/** The editor panel that hosts the dependency UI. */
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
    panel.webview.html = renderWebviewHtml(panel.webview, extensionUri);
    panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        handleWebviewMessage(raw, {
          getModel: () => this.model,
          handlers: this.handlers,
          postModel: () => this.post(),
        });
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
    if (current) {
      current.model = model;
      current.progress = progress;
    }
    GmmPanel.send({
      type: 'model',
      model,
      ...(progress === undefined ? {} : { progress }),
    });
  }

  static clearSelection(): void {
    GmmPanel.send({ type: 'clear-selection' });
  }

  static postVersions(modulePath: string, versions: readonly string[]): void {
    GmmPanel.send({ type: 'versions', modulePath, versions });
  }

  static postVersionsLoading(modulePath: string): void {
    GmmPanel.send({ type: 'versions-loading', modulePath });
  }

  static postWhy(
    manifestPath: string,
    name: string,
    payload: { readonly text?: string; readonly error?: string },
  ): void {
    GmmPanel.send({ type: 'why', manifestPath, name, ...payload });
  }

  static postReleaseNotes(
    modulePath: string,
    version: string,
    notes: ReleaseNotes | undefined,
  ): void {
    GmmPanel.send({
      type: 'release-notes',
      modulePath,
      version,
      ...(notes === undefined ? {} : { notes }),
    });
  }

  static postPreview(result: PreviewResult): void {
    GmmPanel.send({ type: 'preview', result });
  }

  /** A label means work started; no label means it finished. */
  static postBusy(label?: string): void {
    GmmPanel.send(label === undefined ? { type: 'busy' } : { type: 'busy', label });
  }

  static isOpen(): boolean {
    return GmmPanel.current !== undefined;
  }

  static setOnClosed(handler: (() => void) | undefined): void {
    GmmPanel.onClosed = handler;
  }

  private static onClosed: (() => void) | undefined;

  private static send(message: HostToWebview): void {
    const current = GmmPanel.current;
    if (current !== undefined) {
      void current.panel.webview.postMessage(message);
    }
  }

  private post(): void {
    GmmPanel.send({
      type: 'model',
      model: this.model,
      ...(this.progress === undefined ? {} : { progress: this.progress }),
    });
  }

  private dispose(): void {
    GmmPanel.current = undefined;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
    GmmPanel.onClosed?.();
  }
}
