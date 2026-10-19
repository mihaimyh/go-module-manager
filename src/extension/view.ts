import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

export interface GmmViewDeps {
  readonly openPanel: () => void;
}

/**
 * Activity Bar entry point. VS Code requires a side-bar view for the icon; this
 * view only launches the editor panel and shows a short stub if the side bar
 * stays open.
 */
export class GmmViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'gmm.dependencies';

  constructor(private readonly deps: GmmViewDeps) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true };
    view.webview.html = renderLauncherHtml();

    const open = (): void => {
      this.deps.openPanel();
    };

    if (view.visible) {
      open();
    }
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        open();
      }
    });

    view.webview.onDidReceiveMessage((raw: unknown) => {
      if (
        typeof raw === 'object' &&
        raw !== null &&
        (raw as { type?: string }).type === 'open'
      ) {
        open();
      }
    });
  }
}

function renderLauncherHtml(): string {
  const nonce = randomBytes(16).toString('base64');
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      body {
        margin: 0;
        padding: 16px;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        line-height: 1.45;
      }
      p {
        margin: 0 0 12px;
      }
      button {
        display: inline-flex;
        align-items: center;
        padding: 4px 12px;
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: 2px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        font: inherit;
        cursor: pointer;
      }
      button:hover {
        background: var(--vscode-button-hoverBackground);
      }
    </style>
    <title>Go Module Manager</title>
  </head>
  <body>
    <p>Go Module Manager opens in the editor.</p>
    <button type="button" id="open">Open panel</button>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      document.getElementById('open').addEventListener('click', () => {
        vscode.postMessage({ type: 'open' });
      });
    </script>
  </body>
</html>`;
}
