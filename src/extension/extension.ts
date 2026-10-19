import * as vscode from 'vscode';
import type { PanelModel } from '../core/model';
import { detectAdapters } from '../ecosystems';
import { GmmPanel } from './panel';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gmm.openPanel', async () => {
      const model = await loadModel();
      if (!model) {
        return;
      }
      GmmPanel.show(context.extensionUri, model);
    }),
  );
}

export function deactivate(): void {
  // Nothing to tear down: the panel owns its own disposables.
}

/**
 * Until the execution layer lands, the model comes from recorded `go` output.
 * `GMM_FIXTURE_DIR` lets the launch configuration point at the fixture workspace.
 */
async function loadModel(): Promise<PanelModel | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage('GMM: open a folder before opening the module panel.');
    return undefined;
  }

  const root =
    process.env.GMM_FIXTURE_DIR ??
    vscode.Uri.joinPath(folder.uri, 'test', 'fixtures', 'workspace').fsPath;

  try {
    const [adapter] = detectAdapters(root);
    if (!adapter) {
      void vscode.window.showErrorMessage(`GMM: no supported manifest under ${root}.`);
      return undefined;
    }
    return await adapter.read(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(
      `GMM: could not read the workspace at ${root}. ${message}`,
    );
    return undefined;
  }
}
