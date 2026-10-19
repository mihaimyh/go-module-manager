import * as vscode from 'vscode';
import type { EcosystemAdapter, UpdateRequest, UpdateResult } from '../core/adapter';
import { planBulkUpdate } from '../core/bulk';
import type { DependencySelection, RecoveryAction } from '../core/messages';
import {
  advisoryTargets,
  mergeFailure,
  mergeRowFailure,
  withAdvisories,
  type FailureKind,
  type PanelModel,
} from '../core/model';
import { resolveProjects } from '../core/updates';
import { applyScan, markScan } from '../core/scan';
import { detectAdapters } from '../ecosystems';
import { createExecGoRunner } from '../ecosystems/go/runner';
import type { AdvisorySource } from '../ecosystems/go/advisory';
import { createLiveAdvisorySource, FETCH_TIMEOUT_MS } from '../ecosystems/go/advisorySource';
import { FileAdvisoryCache } from './advisoryCache';
import { GmmPanel } from './panel';

interface LoadedModel {
  readonly adapter: EcosystemAdapter;
  readonly model: PanelModel;
}

let current: LoadedModel | undefined;
let refreshTimer: NodeJS.Timeout | undefined;
let updating = false;
let advisorySource: AdvisorySource | undefined;
let advisorySourcePath: string | undefined;
/** Increments on every open or refresh so a stale cycle cannot paint the panel. */
let cycle = 0;

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
  const token = ++cycle;
  GmmPanel.show(context.extensionUri, loaded.model, {
    onRefresh: () => {
      void refresh(context, true);
    },
    onRecover: (manifestPath, action) => {
      recover(context, manifestPath, action);
    },
    onUpdate: (request) => {
      void updateDependency(context, request);
    },
    onBulkUpdate: (selection) => {
      void bulkUpdate(context, selection);
    },
    onTidy: (manifests) => {
      void tidyProjects(context, manifests);
    },
    onScan: (manifests) => {
      void scanProjects(manifests);
    },
    onInstallScanner: () => {
      void installScannerCli();
    },
  });

  // Declared rows are already on screen; versions and candidates follow.
  void fillUpdates(loaded, false, token);
}

async function refresh(context: vscode.ExtensionContext, fresh: boolean): Promise<void> {
  const loaded = await loadModel(context);
  if (!loaded) {
    return;
  }

  current = loaded;
  const token = ++cycle;
  GmmPanel.update(loaded.model);
  void fillUpdates(loaded, fresh, token);
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
  const model = mergeFailure(loaded.model, {
    manifestPath,
    projectName: project?.name ?? manifestPath,
    kind: failureKindOf(error),
    message: messageOf(error),
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

/**
 * One `go get` per group, sequentially; a failing group is recorded and the
 * others continue. Afterwards the workspace is re-read and failed groups are
 * marked on their rows.
 */
async function runGroups(
  context: vscode.ExtensionContext,
  adapter: EcosystemAdapter,
  groups: readonly UpdateRequest[],
): Promise<readonly UpdateResult[]> {
  const update = adapter.update;
  const results: UpdateResult[] = [];
  if (update === undefined) {
    return results;
  }

  for (const group of groups) {
    try {
      results.push(await update(group));
    } catch (error) {
      results.push({ ...group, status: 'failed', message: messageOf(error) });
    }
  }

  await refresh(context, false);

  const failed = results.filter((result) => result.status === 'failed');
  if (failed.length > 0 && current !== undefined) {
    let model = current.model;
    for (const result of failed) {
      for (const change of result.changes) {
        model = mergeRowFailure(
          model,
          result.manifestPath,
          change.name,
          result.message ?? 'go get failed',
        );
      }
    }
    current = { ...current, model };
    GmmPanel.update(model);
  }

  return results;
}

async function undoResults(
  adapter: EcosystemAdapter,
  results: readonly UpdateResult[],
): Promise<void> {
  const undo = adapter.undo;
  if (undo === undefined) {
    return;
  }

  for (const result of results) {
    try {
      const restored = await undo(result.manifestPath);
      if (!restored) {
        void vscode.window.showWarningMessage(
          `GMM: nothing to undo for ${result.manifestPath}.`,
        );
      }
    } catch (error) {
      void vscode.window.showErrorMessage(
        `GMM: undo failed for ${result.manifestPath}. ${messageOf(error)}`,
      );
    }
  }
}

async function updateDependency(
  context: vscode.ExtensionContext,
  request: UpdateRequest,
): Promise<void> {
  if (updating) {
    return;
  }
  const loaded = current;
  if (loaded === undefined || loaded.adapter.update === undefined) {
    return;
  }

  updating = true;
  try {
    const results = await runGroups(context, loaded.adapter, [request]);
    const result = results[0];
    const change = request.changes[0];
    if (result === undefined || result.status === 'failed' || change === undefined) {
      return;
    }

    const fresh = current;
    if (fresh === undefined) {
      return;
    }

    // Report what the toolchain resolved, not what was requested.
    const resolved = fresh.model.rows.find(
      (row) => row.manifestPath === request.manifestPath && row.name === change.name,
    )?.resolvedVersion;

    const choice = await vscode.window.showInformationMessage(
      resolved === undefined
        ? `GMM: ${change.name} updated`
        : `GMM: ${change.name} resolved to ${resolved}`,
      'Undo',
    );
    if (choice === 'Undo') {
      await undoResults(loaded.adapter, [result]);
      await refresh(context, false);
    }
  } finally {
    updating = false;
  }
}

async function bulkUpdate(
  context: vscode.ExtensionContext,
  selection: readonly DependencySelection[],
): Promise<void> {
  if (updating) {
    return;
  }
  const loaded = current;
  if (loaded === undefined || loaded.adapter.update === undefined) {
    return;
  }

  const rows = loaded.model.rows.filter((row) =>
    selection.some(
      (entry) => entry.manifestPath === row.manifestPath && entry.name === row.name,
    ),
  );
  const groups = planBulkUpdate(rows);
  if (groups.length === 0) {
    void vscode.window.showInformationMessage(
      'GMM: nothing in that selection has an update to move to.',
    );
    return;
  }

  updating = true;
  try {
    const planned = groups.reduce((total, group) => total + group.changes.length, 0);
    const skipped = Math.max(0, selection.length - planned);
    const confirmed = await vscode.window.showWarningMessage(
      `Update ${planned} dependencies in ${groups.length} go.mod file(s)?${
        skipped > 0 ? `\n${skipped} selected rows have no update and will be skipped.` : ''
      }\n${groups.map((group) => group.manifestPath).join('\n')}`,
      { modal: true },
      'Update',
    );
    if (confirmed !== 'Update') {
      return;
    }

    const results = await runGroups(context, loaded.adapter, groups);
    const failed = results.filter((result) => result.status === 'failed');
    const succeeded = results.filter((result) => result.status === 'updated');

    if (failed.length > 0) {
      void vscode.window.showErrorMessage(
        `GMM: ${failed.length} of ${results.length} project updates failed.`,
      );
    }
    if (succeeded.length === 0) {
      return;
    }

    GmmPanel.clearSelection();
    const moved = succeeded.reduce((total, result) => total + result.changes.length, 0);
    const choice = await vscode.window.showInformationMessage(
      `GMM: ${moved} dependencies updated in ${succeeded.length} project(s).`,
      'Undo',
    );
    if (choice === 'Undo') {
      await undoResults(loaded.adapter, succeeded);
      await refresh(context, false);
    }
  } finally {
    updating = false;
  }
}

async function tidyProjects(
  context: vscode.ExtensionContext,
  manifests: readonly string[],
): Promise<void> {
  if (updating) {
    return;
  }
  const loaded = current;
  if (loaded === undefined) {
    return;
  }

  const tidy = loaded.adapter.tidy;
  if (tidy === undefined) {
    void vscode.window.showInformationMessage(
      'GMM: tidying is not supported by this ecosystem.',
    );
    return;
  }

  const targets = [...new Set(manifests)];
  if (targets.length === 0) {
    void vscode.window.showInformationMessage('GMM: select a project to tidy.');
    return;
  }

  updating = true;
  try {
    const confirmed = await vscode.window.showWarningMessage(
      `Run go mod tidy in ${targets.length} project(s)? This removes requirements nothing imports yet.\n${targets.join(
        '\n',
      )}`,
      { modal: true },
      'Run tidy',
    );
    if (confirmed !== 'Run tidy') {
      return;
    }

    for (const manifestPath of targets) {
      try {
        await tidy(manifestPath);
      } catch (error) {
        showFailure(manifestPath, error);
      }
    }
    await refresh(context, false);
  } finally {
    updating = false;
  }
}

async function scanProjects(manifests: readonly string[]): Promise<void> {
  if (updating) {
    return;
  }
  const loaded = current;
  const scan = loaded?.adapter.scan;
  if (loaded === undefined || scan === undefined) {
    return;
  }

  const targets = [...new Set(manifests)];
  if (targets.length === 0) {
    void vscode.window.showInformationMessage('GMM: select a project to scan.');
    return;
  }

  const token = cycle;
  updating = true;
  try {
    for (const manifestPath of targets) {
      if (token !== cycle || current === undefined) {
        return;
      }
      current = {
        ...current,
        model: markScan(current.model, manifestPath, {
          status: 'running',
          at: new Date().toISOString(),
        }),
      };
      GmmPanel.update(current.model);

      try {
        const findings = await scan(manifestPath);
        if (token !== cycle || current === undefined) {
          return;
        }
        current = {
          ...current,
          model: applyScan(current.model, manifestPath, findings, new Date().toISOString()),
        };
      } catch (error) {
        if (token !== cycle || current === undefined) {
          return;
        }
        current = {
          ...current,
          model: markScan(current.model, manifestPath, {
            status: 'failed',
            at: new Date().toISOString(),
            message: messageOf(error),
          }),
        };
      }
      GmmPanel.update(current.model);
    }
  } finally {
    updating = false;
  }
}

async function installScannerCli(): Promise<void> {
  const install = current?.adapter.installScanner;
  if (install === undefined) {
    return;
  }

  try {
    await install();
    void vscode.window.showInformationMessage(
      'GMM: govulncheck installed for terminal use. Scans already run the latest version through go run.',
    );
  } catch (error) {
    void vscode.window.showErrorMessage(
      `GMM: could not install govulncheck. ${messageOf(error)}`,
    );
  }
}

async function fillUpdates(
  loaded: LoadedModel,
  fresh: boolean,
  token: number,
): Promise<void> {
  const resolve = loaded.adapter.resolve;
  if (!resolve) {
    return;
  }

  const total = loaded.model.projects.length;
  GmmPanel.update(loaded.model, { done: 0, total });

  const resolved = await resolveProjects(
    loaded.model,
    (manifestPath, options) => resolve(manifestPath, options),
    (report) => {
      if (token !== cycle) {
        return;
      }
      current = { ...loaded, model: report.model };
      GmmPanel.update(report.model, { done: report.done, total: report.total });
      if (report.failure) {
        void vscode.window.showWarningMessage(
          `GMM: could not check ${report.failure.manifestPath}. ${report.failure.message}`,
        );
      }
    },
    { concurrency: 4, fresh },
  );

  if (token !== cycle) {
    return;
  }

  const attachAdvisories = loaded.adapter.advisories;
  if (attachAdvisories === undefined) {
    return;
  }

  try {
    const report = await attachAdvisories(advisoryTargets(resolved), { fresh });
    if (token !== cycle) {
      return;
    }
    // A re-read invalidates scan results: reachability is session-only.
    const merged = withAdvisories(resolved, report);
    current = { ...loaded, model: merged };
    GmmPanel.update(merged);
  } catch (error) {
    void vscode.window.showWarningMessage(
      `GMM: advisory lookup failed. ${messageOf(error)}`,
    );
  }
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
    const [detected] = detectAdapters(root, {
      goPath,
      advisories: ensureAdvisorySource(context, goPath),
    });
    adapter = detected;
    if (!adapter) {
      void vscode.window.showErrorMessage(
        `GMM: no supported manifest under ${root}. Searched six levels deep, skipping node_modules and dot-folders.`,
      );
      return undefined;
    }
    return { adapter, model: await adapter.read(root) };
  } catch (error) {
    const message = messageOf(error);
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

function failureKindOf(error: unknown): FailureKind {
  const kind = (error as { kind?: FailureKind } | null)?.kind;
  return kind ?? 'unknown';
}

/** One source per session and toolchain path: it owns the index and the cache. */
function ensureAdvisorySource(
  context: vscode.ExtensionContext,
  goPath: string,
): AdvisorySource {
  if (advisorySource !== undefined && advisorySourcePath === goPath) {
    return advisorySource;
  }
  advisorySourcePath = goPath;
  advisorySource = createLiveAdvisorySource({
    fetchJson,
    cache: new FileAdvisoryCache(
      vscode.Uri.joinPath(context.globalStorageUri, 'advisory-db.json').fsPath,
    ),
    runner: createExecGoRunner(goPath),
  });
  return advisorySource;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
