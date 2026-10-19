import * as vscode from 'vscode';
import type { EcosystemAdapter, UpdateRequest } from '../core/adapter';
import type { RecoveryAction } from '../core/messages';
import { mergeFailure, mergeRowError, type FailureKind, type PanelModel } from '../core/model';
import { resolveProjects } from '../core/updates';
import { detectAdapters } from '../ecosystems';
import { GmmPanel } from './panel';

interface LoadedModel {
  readonly adapter: EcosystemAdapter;
  readonly model: PanelModel;
}

let current: LoadedModel | undefined;
let refreshTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gmm.openPanel', () => openPanel(context)),
    watchManifests(context),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('gmm.goPath') && GmmPanel.isOpen()) {
        void refresh(context, true);
      }
    }),
  );
}

export function deactivate(): void {
  // Nothing to tear down: the panel and the watcher own their disposables.
}

async function openPanel(context: vscode.ExtensionContext): Promise<void> {
  const loaded = await loadModel(context);
  if (!loaded) {
    return;
  }

  current = loaded;
  GmmPanel.show(
    context.extensionUri,
    loaded.model,
    {
      onRefresh: () => {
        void refresh(context, true);
      },
      onRecover: (manifestPath, action) => {
        recover(context, manifestPath, action);
      },
      onUpdate: (request) => {
        void updateDependency(context, request);
      },
    },
  );

  // Declared rows are already on screen; versions and candidates follow.
  void fillUpdates(loaded, false);
}

async function refresh(context: vscode.ExtensionContext, fresh: boolean): Promise<void> {
  const loaded = await loadModel(context);
  if (!loaded) {
    return;
  }

  current = loaded;
  GmmPanel.update(loaded.model);
  void fillUpdates(loaded, fresh);
}

function recover(
  context: vscode.ExtensionContext,
  manifestPath: string,
  action: RecoveryAction,
): void {
  const adapter = current?.adapter;
  if (!adapter) {
    return;
  }

  if (action === 'install') {
    openToolchainPage(adapter);
    return;
  }

  if (action === 'repair') {
    const repair = adapter.repair;
    if (!repair) {
      void vscode.window.showErrorMessage(
        'GMM: this project cannot be repaired automatically.',
      );
      return;
    }
    void repair(manifestPath).then(
      () => refresh(context, false),
      (error: unknown) => {
        showFailure(manifestPath, error);
      },
    );
    return;
  }

  void refresh(context, true);
}

/** A failed recovery is a project failure like any other, not a transient toast. */
function showFailure(manifestPath: string, error: unknown): void {
  const loaded = current;
  if (!loaded) {
    return;
  }

  const project = loaded.model.projects.find(
    (candidate) => candidate.manifestPath === manifestPath,
  );
  const kind = (error as { kind?: FailureKind } | null)?.kind ?? 'unknown';
  const model = mergeFailure(loaded.model, {
    manifestPath,
    projectName: project?.name ?? manifestPath,
    kind,
    message: error instanceof Error ? error.message : String(error),
  });

  current = { ...loaded, model };
  GmmPanel.update(model);
}

function openToolchainPage(adapter: EcosystemAdapter): void {
  if (adapter.toolchainUrl === undefined) {
    return;
  }
  void vscode.env.openExternal(vscode.Uri.parse(adapter.toolchainUrl));
}

async function updateDependency(
  context: vscode.ExtensionContext,
  request: UpdateRequest,
): Promise<void> {
  const loaded = current;
  const update = loaded?.adapter.update;
  if (loaded === undefined || update === undefined) {
    return;
  }

  const outcome = await update(request);

  if (outcome.status === 'failed') {
    if (current !== loaded) {
      return;
    }
    current = {
      ...loaded,
      model: mergeRowError(
        loaded.model,
        request.manifestPath,
        request.name,
        outcome.message ?? 'go get failed',
      ),
    };
    GmmPanel.update(current.model);
    return;
  }

  await refresh(context, false);

  const undo = loaded.adapter.undo;
  if (undo === undefined) {
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    `GMM: ${request.name} updated to ${request.version}`,
    'Undo',
  );
  if (choice === 'Undo' && (await undo(request.manifestPath))) {
    await refresh(context, false);
  }
}

async function fillUpdates(loaded: LoadedModel, fresh: boolean): Promise<void> {
  const resolve = loaded.adapter.resolve;
  if (!resolve) {
    return;
  }

  const total = loaded.model.projects.length;
  GmmPanel.update(loaded.model, { done: 0, total });

  await resolveProjects(
    loaded.model,
    (manifestPath, options) => resolve(manifestPath, options),
    (report) => {
      if (current !== loaded) {
        return;
      }
      GmmPanel.update(report.model, { done: report.done, total: report.total });
      if (report.failure) {
        void vscode.window.showWarningMessage(
          `GMM: could not check ${report.failure.manifestPath}. ${report.failure.message}`,
        );
      }
    },
    { concurrency: 4, fresh },
  );
}

/**
 * `GMM_WORKSPACE_ROOT` points at a sample workspace while developing the
 * extension itself. It is ignored in a published build.
 */
async function loadModel(
  context: vscode.ExtensionContext,
): Promise<LoadedModel | undefined> {
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

  let adapter: EcosystemAdapter | undefined;

  try {
    const goPath = vscode.workspace.getConfiguration('gmm').get<string>('goPath') ?? 'go';
    const [detected] = detectAdapters(root, { goPath });
    adapter = detected;
    if (!adapter) {
      void vscode.window.showErrorMessage(`GMM: no supported manifest under ${root}.`);
      return undefined;
    }
    return { adapter, model: await adapter.read(root) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind = (error as { kind?: FailureKind } | null)?.kind;

    if (kind === 'toolchain-missing') {
      void offerToolchainHelp(message, adapter);
      return undefined;
    }

    void vscode.window.showErrorMessage(
      `GMM: could not read the workspace at ${root}. ${message}`,
    );
    return undefined;
  }
}

async function offerToolchainHelp(
  message: string,
  adapter: EcosystemAdapter | undefined,
): Promise<void> {
  const choice = await vscode.window.showErrorMessage(
    `GMM: ${message}`,
    'Install Go',
    'Open Settings',
  );

  if (choice === 'Install Go' && adapter !== undefined) {
    openToolchainPage(adapter);
  }
  if (choice === 'Open Settings') {
    void vscode.commands.executeCommand('workbench.action.openSettings', 'gmm.goPath');
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
