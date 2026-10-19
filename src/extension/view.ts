import * as vscode from 'vscode';
import type { PanelModel } from '../core/model';
import type { PanelHandlers } from './handlers';
import { GmmPanel } from './panel';
import { renderWebviewHtml } from './webviewHtml';
import { handleWebviewMessage } from './webviewMessages';

export interface GmmViewDeps {
  readonly extensionUri: vscode.Uri;
  readonly handlers: PanelHandlers;
  readonly getModel: () => PanelModel | undefined;
  readonly ensureWorkspace: () => Promise<void>;
  readonly onSurfaceClosed?: () => void;
}

/** The Activity Bar view: the same webview document, rendered in the sidebar. */
export class GmmViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'gmm.dependencies';

  private unsubscribe: (() => void) | undefined;

  constructor(private readonly deps: GmmViewDeps) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.deps.extensionUri, 'dist')],
    };
    view.webview.html = renderWebviewHtml(view.webview, this.deps.extensionUri);

    this.unsubscribe = GmmPanel.subscribe((message) => {
      void view.webview.postMessage(message);
    });

    view.webview.onDidReceiveMessage((raw: unknown) => {
      handleWebviewMessage(raw, {
        getModel: this.deps.getModel,
        handlers: this.deps.handlers,
        postModel: () => {
          const model = this.deps.getModel();
          if (model !== undefined) {
            void view.webview.postMessage({ type: 'model', model });
          }
          void this.deps.ensureWorkspace();
        },
      });
    });

    view.onDidDispose(() => {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.deps.onSurfaceClosed?.();
    });
  }
}
