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
import { createExecGoRunner, setGoInvocationSink, type GoInvocation } from '../ecosystems/go/runner';
import type { AdvisorySource } from '../ecosystems/go/advisory';
import { createLiveAdvisorySource, FETCH_TIMEOUT_MS } from '../ecosystems/go/advisorySource';
import { FileAdvisoryCache } from './advisoryCache';
import type { PanelHandlers } from './handlers';
import { GmmPanel } from './panel';
import { GmmViewProvider } from './view';

interface LoadedModel {
  readonly adapter: EcosystemAdapter;
  readonly model: PanelModel;
}

let current: LoadedModel | undefined;
let refreshTimer: NodeJS.Timeout | undefined;
let updating = false;
let advisorySource: AdvisorySource | undefined;
let advisorySourcePath: string | undefined;
let handlers: PanelHandlers | undefined;
let output: vscode.OutputChannel | undefined;
let environmentLogged = false;
/** Increments on every open or refresh so a stale cycle cannot paint the panel. */
let cycle = 0;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('Go Module Manager');
  context.subscriptions.push(output, {
    dispose: () => setGoInvocationSink(undefined),
  });
  setGoInvocationSink(logInvocation);
  output.appendLine(`Go Module Manager ${context.extension.packageJSON.version as string}`);

  handlers = createHandlers(context);

  const viewProvider = new GmmViewProvider({
    extensionUri: context.extensionUri,
    handlers,
    getModel: () => current?.model,
    ensureWorkspace: async () => {
      await ensureWorkspace(context);
    },
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('gmm.openPanel', () => openPanel(context)),
    watchManifests(context),
    vscode.window.registerWebviewViewProvider(GmmViewProvider.viewId, viewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('gmm.goPath') && GmmPanel.isOpen()) {
        void refresh(context, true);
      }
    }),
  );
}

function createHandlers(context: vscode.ExtensionContext): PanelHandlers {
  return {
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
    onVersions: (modulePath) => {
      void requestVersions(modulePath);
    },
    onOpenPanel: () => {
      void openPanel(context);
    },
  };
}

export function deactivate(): void {
  // Nothing to tear down: the panel and the watcher own their disposables.
}

function logInvocation(invocation: GoInvocation): void {
  if (output === undefined) {
    return;
  }
  output.appendLine(`[${new Date().toLocaleTimeString()}] go ${invocation.args.join(' ')}`);
  output.appendLine(`  cwd: ${invocation.cwd}`);
  output.appendLine(
    `  exit: ${invocation.exitCode}${invocation.timedOut ? ' (timed out)' : ''} in ${(
      invocation.durationMs / 1000
    ).toFixed(2)}s`,
  );
  if (invocation.exitCode !== 0) {
    appendOutput('stdout', invocation.stdout);
    appendOutput('stderr', invocation.stderr);
  }
}

function appendOutput(label: string, text: string): void {
  const trimmed = text.trim();
  if (trimmed === '') {
    return;
  }
  const clipped =
    trimmed.length > 8000 ? `${trimmed.slice(0, 8000)}\n… truncated` : trimmed;
  for (const line of clipped.split(/\r?\n/)) {
    output?.appendLine(`  ${label}: ${line}`);
  }
}

/** A failed update names its reason and offers the full command log. */
function showUpdateFailure(summary: string, detail: string): void {
  const first = detail.trim() === '' ? 'the go command failed without output' : detail.trim();
  const clipped = first.length > 240 ? `${first.slice(0, 240)}…` : first;
  void vscode.window.showErrorMessage(`${summary} ${clipped}`, 'Show log').then((choice) => {
    if (choice === 'Show log') {
      output?.show(true);
    }
  });
}

/** Logs the toolchain settings that decide whether a download or a sumdb check works. */
function logGoEnvironment(goPath: string, cwd: string): void {
  if (environmentLogged) {
    return;
  }
  environmentLogged = true;
  const keys = ['GOPROXY', 'GOSUMDB', 'GOFLAGS', 'GOPRIVATE', 'GONOPROXY', 'GOVERSION'];
  void createExecGoRunner(goPath)
    .run(['env', ...keys], { cwd, env: process.env, timeoutMs: 15_000 })
    .then((result) => {
      const values = result.stdout.split(/\r?\n/);
      output?.appendLine(
        `go env: ${keys.map((key, index) => `${key}=${values[index] ?? ''}`).join(' ')}`,
      );
    })
    .catch((error: unknown) => {
      output?.appendLine(`go env failed: ${messageOf(error)}`);
    });
}

async function openPanel(context: vscode.ExtensionContext): Promise<void> {
  const model = await ensureWorkspace(context);
  if (model === undefined || handlers === undefined) {
    return;
  }
  GmmPanel.show(context.extensionUri, model, handlers);
}

/**
 * Loads the workspace once. The Activity Bar view can be the first surface to
 * ask, so the command and the view share this path.
 */
async function ensureWorkspace(
  context: vscode.ExtensionContext,
): Promise<PanelModel | undefined> {
  if (current !== undefined) {
    return current.model;
  }

  const loaded = await loadModel(context);
  if (!loaded) {
    return undefined;
  }

  current = loaded;
  const token = ++cycle;
  void fillUpdates(loaded, false, token);
  return loaded.model;
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
  void handleRecovery(context, manifestPath, action);
}

async function handleRecovery(
  context: vscode.ExtensionContext,
  manifestPath: string,
  action: RecoveryAction,
): Promise<void> {
  const adapter = current?.adapter;
  if (!adapter) {
    return;
  }

  if (action === 'install') {
    openToolchainPage(adapter);
    return;
  }

  if (action === 'clean-checksum-cache') {
    const clean = adapter.cleanChecksumCache;
    if (clean === undefined) {
      void vscode.window.showErrorMessage(
        'GMM: this project cannot repair the checksum cache automatically.',
      );
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      "GMM: delete Go's cached checksum database data? Downloaded modules are kept; the next lookup downloads the checksum data again.",
      { modal: true },
      'Repair',
    );
    if (confirmed !== 'Repair') {
      return;
    }
    try {
      await clean();
      await refresh(context, true);
    } catch (error) {
      void vscode.window.showErrorMessage(`GMM: ${messageOf(error)}`);
    }
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
    let result: UpdateResult;
    output?.appendLine(
      `update ${group.manifestPath}: ${group.changes
        .map((change) => `${change.name}@${change.version}`)
        .join(', ')}`,
    );
    try {
      result = await update(group);
    } catch (error) {
      result = { ...group, status: 'failed', message: messageOf(error) };
    }

    // One bad module makes the whole `go get` fail. Retry the group one
    // dependency at a time so the healthy ones still move; every retry reuses
    // the snapshot taken before the group.
    if (result.status === 'failed' && group.changes.length > 1) {
      output?.appendLine(
        `group failed, retrying one by one: ${result.message ?? 'no message'}`,
      );
      for (const change of group.changes) {
        try {
          results.push(
            await update({
              manifestPath: group.manifestPath,
              changes: [change],
              snapshot: false,
            }),
          );
        } catch (error) {
          results.push({
            manifestPath: group.manifestPath,
            changes: [change],
            status: 'failed',
            message: messageOf(error),
          });
        }
      }
    } else {
      results.push(result);
    }
  }

  for (const result of results) {
    output?.appendLine(
      `result ${result.manifestPath}: ${result.status}${
        result.message === undefined ? '' : ` — ${result.message}`
      }`,
    );
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
  manifests: readonly string[],
): Promise<void> {
  const undo = adapter.undo;
  if (undo === undefined) {
    return;
  }

  for (const manifestPath of manifests) {
    try {
      const restored = await undo(manifestPath);
      if (!restored) {
        void vscode.window.showWarningMessage(
          `GMM: nothing to undo for ${manifestPath}.`,
        );
      }
    } catch (error) {
      void vscode.window.showErrorMessage(
        `GMM: undo failed for ${manifestPath}. ${messageOf(error)}`,
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
    if (result === undefined || change === undefined) {
      return;
    }
    if (result.status === 'failed') {
      showUpdateFailure(`GMM: ${change.name} could not be updated.`, result.message ?? '');
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
      await undoResults(loaded.adapter, [request.manifestPath]);
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
      showUpdateFailure(
        `GMM: ${failed.length} of ${results.length} dependency updates failed.`,
        failed[0]?.message ?? '',
      );
    }
    if (succeeded.length === 0) {
      return;
    }

    GmmPanel.clearSelection();
    const moved = succeeded.reduce((total, result) => total + result.changes.length, 0);
    const projectCount = new Set(succeeded.map((result) => result.manifestPath)).size;
    const choice = await vscode.window.showInformationMessage(
      `GMM: ${moved} dependencies updated in ${projectCount} project(s).`,
      'Undo',
    );
    if (choice === 'Undo') {
      await undoResults(loaded.adapter, [
        ...new Set(succeeded.map((result) => result.manifestPath)),
      ]);
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

async function requestVersions(modulePath: string): Promise<void> {
  const get = current?.adapter.versions;
  if (get === undefined) {
    return;
  }

  try {
    GmmPanel.postVersions(modulePath, await get(modulePath));
  } catch {
    // Keep the versions the panel already knows; the proxy is optional.
    GmmPanel.postVersions(modulePath, []);
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
  output?.appendLine(`workspace: ${root}`);

  let adapter: EcosystemAdapter | undefined;

  try {
    const goPath = vscode.workspace.getConfiguration('gmm').get<string>('goPath') ?? 'go';
    logGoEnvironment(goPath, root);
    const [detected] = detectAdapters(root, {
      goPath,
      advisories: ensureAdvisorySource(context, goPath),
      fetchText,
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

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.text();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
