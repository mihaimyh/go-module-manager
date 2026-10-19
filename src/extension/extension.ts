import * as vscode from 'vscode';
import type { EcosystemAdapter } from '../core/adapter';
import type { PanelModel } from '../core/model';
import { resolveProjects } from '../core/updates';
import { detectAdapters } from '../ecosystems';
import { GmmPanel } from './panel';

interface LoadedWorkspace {
  readonly adapter: EcosystemAdapter;
  readonly model: PanelModel;
}

let current: LoadedWorkspace | undefined;
let refreshTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gmm.openPanel', () => openPanel(context)),
    watchManifests(context),
  );
}

export function deactivate(): void {
  // Nothing to tear down: the panel and the watcher own their disposables.
}

async function openPanel(context: vscode.ExtensionContext): Promise<void> {
  const loaded = await loadWorkspace(context);
  if (!loaded) {
    return;
  }

  current = loaded;
  GmmPanel.show(context.extensionUri, loaded.model, () => {
    void refresh(context, true);
  });

  // Declared rows are already on screen; versions and candidates follow.
  void fillUpdates(loaded, false);
}

async function refresh(context: vscode.ExtensionContext, fresh: boolean): Promise<void> {
  const loaded = await loadWorkspace(context);
  if (!loaded) {
    return;
  }

  current = loaded;
  GmmPanel.update(loaded.model);
  void fillUpdates(loaded, fresh);
}

async function fillUpdates(loaded: LoadedWorkspace, fresh: boolean): Promise<void> {
  const resolve = loaded.adapter.resolve;
  if (!resolve) {
    return;
  }

  await resolveProjects(
    loaded.model,
    (manifestPath, options) => resolve(manifestPath, options),
    (report) => {
      if (current !== loaded) {
        return;
      }
      GmmPanel.update(report.model, { done: report.done, total: report.total });
    },
    { concurrency: 4, fresh },
  );
}

/**
 * `GMM_WORKSPACE_ROOT` points at a sample workspace while developing the
 * extension itself. It is ignored in a published build.
 */
async function loadWorkspace(
  context: vscode.ExtensionContext,
): Promise<LoadedWorkspace | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage('GMM: open a folder before opening the module panel.');
    return undefined;
  }

  const developmentRoot =
    context.extensionMode === vscode.ExtensionMode.Development
      ? process.env.GMM_WORKSPACE_ROOT
      : undefined;
  const root = developmentRoot ?? folder.uri.fsPath;

  try {
    const [adapter] = detectAdapters(root);
    if (!adapter) {
      void vscode.window.showErrorMessage(`GMM: no supported manifest under ${root}.`);
      return undefined;
    }
    return { adapter, model: await adapter.read(root) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(
      `GMM: could not read the workspace at ${root}. ${message}`,
    );
    return undefined;
  }
}

function watchManifests(context: vscode.ExtensionContext): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher('**/{go.mod,go.sum}');

  const schedule = (): void => {
    if (!GmmPanel.isOpen()) {
      return;
    }
    if (refreshTimer !== undefined) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void refresh(context, false);
    }, 400);
  };

  watcher.onDidChange(schedule);
  watcher.onDidCreate(schedule);
  watcher.onDidDelete(schedule);

  return {
    dispose: () => {
      watcher.dispose();
      if (refreshTimer !== undefined) {
        clearTimeout(refreshTimer);
        refreshTimer = undefined;
      }
    },
  };
}
