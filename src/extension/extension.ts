import * as vscode from 'vscode';
import type {
  EcosystemAdapter,
  ModuleMetadata,
  UpdateRequest,
  UpdateResult,
} from '../core/adapter';
import type { PanelFocus } from '../core/contextMenu';
import type { DependencySelection, RecoveryAction, ReleaseNotes } from '../core/messages';
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
import {
  createExecGoRunner,
  setGoInvocationSink,
  setGoSessionSignal,
  type GoInvocation,
} from '../ecosystems/go/runner';
import { failureKindFor } from '../ecosystems/go/errors';
import { requiredModuleAtLine, requireLineNumber } from '../ecosystems/go/requireLine';
import {
  planTargetChanges,
  shouldRetryFailedGroup,
  tidyEligibleManifests,
  type TargetChange,
} from '../core/bulk';
import {
  diffManifestCollateral,
  formatDirectiveNotice,
  type DirectiveChange,
  type ManifestCollateral,
} from '../core/collateral';
import { removeSafety } from '../core/version';
import { workspaceRoots } from '../core/workspaceRoots';
import type { AdvisorySource } from '../ecosystems/go/advisory';
import { fetchReleaseNotes } from '../ecosystems/go/releases';
import { createLiveAdvisorySource, FETCH_TIMEOUT_MS } from '../ecosystems/go/advisorySource';
import { FileAdvisoryCache } from './advisoryCache';
import type { PanelHandlers } from './handlers';
import { GmmPanel } from './panel';
import { registerActivityBarLauncher } from './view';

interface LoadedModel {
  readonly adapter: EcosystemAdapter;
  readonly model: PanelModel;
}

let current: LoadedModel | undefined;
let refreshTimer: NodeJS.Timeout | undefined;
let updating = false;
/** True while a write-driven refresh+resolve owns the panel (blocks watcher echoes). */
let writeRefreshPending = false;
let advisorySource: AdvisorySource | undefined;
let advisorySourcePath: string | undefined;
let handlers: PanelHandlers | undefined;
let output: vscode.OutputChannel | undefined;
let environmentLogged = false;
/** Increments on every open or refresh so a stale cycle cannot paint the panel. */
let cycle = 0;
let searchCycle = 0;
/** One append per page token: the sentinel can fire again while the request is open. */
let pendingAppend: { readonly token: string; readonly cycle: number } | undefined;
let session = new AbortController();
const releaseNotesCache = new Map<string, Promise<ReleaseNotes | undefined>>();
const moduleMetadataCache = new Map<string, Promise<ModuleMetadata | undefined>>();

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('Go Module Manager');
  context.subscriptions.push(output, {
    dispose: () => setGoInvocationSink(undefined),
  });
  setGoInvocationSink(logInvocation);
  setGoSessionSignal(session.signal);
  output.appendLine(`Go Module Manager ${context.extension.packageJSON.version as string}`);

  handlers = createHandlers(context);
  GmmPanel.setOnClosed(abortIfIdle);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gmm.openPanel',
      (resource?: unknown, selectedResources?: unknown) =>
        openPanel(
          context,
          resource instanceof vscode.Uri ? resource : undefined,
          Array.isArray(selectedResources),
        ),
    ),
    watchManifests(context),
    registerActivityBarLauncher(() => {
      void openPanel(context);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('gmm.goPath') && surfaceOpen()) {
        void refresh(context, true);
      }
    }),
  );
}

function createHandlers(context: vscode.ExtensionContext): PanelHandlers {
  return {
    onRefresh: () => {
      void refreshFromUser(context);
    },
    onRecover: (manifestPath, action) => {
      void handleRecovery(context, manifestPath, action);
    },
    onUpdate: (request) => {
      void updateDependency(context, request);
    },
    onApplyTargets: (targets) => {
      void applyTargets(context, targets);
    },
    onBulkUpdate: (targets, skippedVisible) => {
      void bulkUpdate(context, targets, skippedVisible);
    },
    onUninstall: (targets) => {
      void uninstallDependencies(context, targets);
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
    onShowOutput: () => {
      output?.show(true);
    },
    onOpenManifest: (manifestPath, name) => {
      void openManifest(manifestPath, name);
    },
    onWhy: (manifestPath, name) => {
      void requestWhy(manifestPath, name);
    },
    onReleaseNotes: (modulePath, version) => {
      void requestReleaseNotes(modulePath, version);
    },
    onPreview: (manifestPath, name, version) => {
      void requestPreview(manifestPath, name, version);
    },
    onSearch: (query, pageToken) => {
      void requestSearch(query, pageToken);
    },
    onModuleMetadata: (modulePath, version) => {
      void requestModuleMetadata(modulePath, version);
    },
  };
}

export function deactivate(): void {
  session.abort();
  setGoSessionSignal(undefined);
}

function surfaceOpen(): boolean {
  return GmmPanel.isOpen();
}

function resetSession(): void {
  session.abort();
  session = new AbortController();
  setGoSessionSignal(session.signal);
}

function abortIfIdle(): void {
  if (!surfaceOpen()) {
    resetSession();
  }
}

/**
 * Runs a user-visible panel action under the shared busy gate. Posts `label`
 * immediately so buttons disable during confirm dialogs as well as the work.
 */
async function runAction<T>(label: string, work: () => Promise<T>): Promise<T | undefined> {
  if (updating) {
    return undefined;
  }
  updating = true;
  GmmPanel.postBusy(label);
  try {
    return await work();
  } finally {
    GmmPanel.postBusy(undefined);
    updating = false;
  }
}

/** Updates the busy strip label while already inside `runAction`. */
function setBusy(label: string): void {
  GmmPanel.postBusy(label);
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
  const keys = [
    'GOPROXY',
    'GOSUMDB',
    'GOFLAGS',
    'GOPRIVATE',
    'GONOPROXY',
    'GOVERSION',
    'GOMODCACHE',
    'GOPATH',
    'GOTOOLCHAIN',
  ];
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

async function openPanel(
  context: vscode.ExtensionContext,
  resource?: vscode.Uri,
  fromExplorer = false,
): Promise<void> {
  if (handlers === undefined) {
    return;
  }
  const focus = resolveLaunchFocus(resource, fromExplorer, vscode.window.activeTextEditor);
  // Open the editor tab first so the Activity Bar click is not stuck waiting
  // on `go` / discovery before anything appears in the editor area.
  GmmPanel.show(context.extensionUri, handlers, current?.model);
  if (focus !== undefined) {
    GmmPanel.postFocus(focus);
  }
  const model = await ensureWorkspace(context);
  if (model === undefined) {
    return;
  }
  GmmPanel.show(context.extensionUri, handlers, model);
}

function resolveLaunchFocus(
  resource: vscode.Uri | undefined,
  fromExplorer: boolean,
  editor: vscode.TextEditor | undefined,
): PanelFocus | undefined {
  if (resource === undefined || resource.scheme !== 'file') {
    return undefined;
  }
  const fsPath = resource.fsPath;
  const lower = fsPath.toLowerCase();
  if (lower.endsWith('go.work')) {
    return {};
  }
  if (!lower.endsWith('go.mod')) {
    return undefined;
  }
  let moduleName: string | undefined;
  if (
    !fromExplorer &&
    editor !== undefined &&
    editor.document.uri.fsPath.toLowerCase() === lower
  ) {
    const line = editor.selection.active.line + 1;
    moduleName = requiredModuleAtLine(editor.document.getText(), line);
  }
  return {
    manifestPath: fsPath,
    ...(moduleName === undefined ? {} : { moduleName }),
  };
}

/** Loads the workspace once. Shared by the open command and the Activity Bar launcher. */
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

/**
 * User-clicked Check for updates: busy while reading the workspace, then the
 * progress strip while resolving. Holds the write gate for the whole lookup.
 */
async function refreshFromUser(context: vscode.ExtensionContext): Promise<void> {
  await runAction('Reading workspace…', async () => {
    resetSession();
    const loaded = await loadModel(context);
    if (!loaded) {
      return;
    }
    current = loaded;
    const token = ++cycle;
    // Seed progress, drop the busy label, and keep `updating` until resolve finishes.
    GmmPanel.update(loaded.model, {
      done: 0,
      total: loaded.model.projects.length,
    });
    GmmPanel.postBusy(undefined);
    await fillUpdates(loaded, true, token);
  });
}

/**
 * Reloads the panel model. Watcher/config refreshes are skipped while a write
 * is in flight (`updating`) or a write-driven resolve is still running.
 * Callers that just finished a write pass `force: true` and await resolve.
 */
async function refresh(
  context: vscode.ExtensionContext,
  fresh: boolean,
  options: { readonly force?: boolean; readonly fromWatcher?: boolean } = {},
): Promise<void> {
  if (options.fromWatcher === true && (updating || writeRefreshPending)) {
    return;
  }
  if (updating && options.force !== true) {
    return;
  }
  resetSession();
  const loaded = await loadModel(context);
  if (!loaded) {
    return;
  }

  current = loaded;
  const token = ++cycle;
  // Seed progress before returning so the webview stays locked across the
  // hand-off from a cleared busy strip into fillUpdates.
  GmmPanel.update(loaded.model, {
    done: 0,
    total: loaded.model.projects.length,
  });
  if (options.force === true) {
    writeRefreshPending = true;
    try {
      await fillUpdates(loaded, fresh, token);
    } finally {
      writeRefreshPending = false;
    }
    return;
  }
  void fillUpdates(loaded, fresh, token);
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
    await runAction('Confirming checksum repair…', async () => {
      const confirmed = await vscode.window.showWarningMessage(
        "GMM: delete Go's damaged checksum state? This removes the signed tree note in GOPATH\\pkg\\sumdb, the lookup cache, and any zero-filled cache metadata; downloaded modules are kept and refetched as needed.",
        { modal: true },
        'Repair',
      );
      if (confirmed !== 'Repair') {
        return;
      }
      try {
        setBusy('Repairing Go cache…');
        await clean();
        await refresh(context, true, { force: true });
      } catch (error) {
        void vscode.window.showErrorMessage(`GMM: ${messageOf(error)}`);
      }
    });
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
    await runAction('Downloading modules…', async () => {
      try {
        await repair(manifestPath);
        await refresh(context, false, { force: true });
      } catch (error) {
        showFailure(manifestPath, error);
      }
    });
    return;
  }

  void refreshFromUser(context);
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

interface GroupRunOutcome {
  readonly results: readonly UpdateResult[];
  readonly collateral: readonly {
    readonly manifestPath: string;
    readonly diff: ManifestCollateral;
  }[];
}

/**
 * One `go get` per group, sequentially; a failing group is recorded and the
 * others continue. Afterwards the workspace is re-read (awaiting resolve) and
 * failed groups are marked on their rows.
 */
async function runGroups(
  context: vscode.ExtensionContext,
  adapter: EcosystemAdapter,
  groups: readonly UpdateRequest[],
): Promise<GroupRunOutcome> {
  const update = adapter.update;
  const results: UpdateResult[] = [];
  const collateral: { manifestPath: string; diff: ManifestCollateral }[] = [];
  if (update === undefined) {
    return { results, collateral };
  }

  for (const group of groups) {
    const selectedNames = new Set(group.changes.map((change) => change.name));
    const beforeMeta =
      adapter.manifestMeta === undefined
        ? undefined
        : await adapter.manifestMeta(group.manifestPath).catch(() => undefined);

    let result: UpdateResult;
    output?.appendLine(
      `update ${group.manifestPath}: ${group.changes
        .map((change) => `${change.name}@${change.version}`)
        .join(', ')}`,
    );
    let kind: FailureKind = 'unknown';
    try {
      result = await update(group);
      if (result.status === 'failed') {
        kind = failureKindFor(1, result.message ?? '');
      }
    } catch (error) {
      kind = failureKindOf(error);
      result = { ...group, status: 'failed', message: messageOf(error) };
    }

    // One bad module makes the whole `go get` fail. Retry the group one
    // dependency at a time so the healthy ones still move; every retry reuses
    // the snapshot taken before the group. A broken toolchain is not retried.
    if (result.status === 'failed' && shouldRetryFailedGroup(group.changes.length, kind)) {
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

    const groupSucceeded = results.some(
      (entry) =>
        entry.manifestPath === group.manifestPath && entry.status === 'updated',
    );
    if (groupSucceeded && beforeMeta !== undefined && adapter.manifestMeta !== undefined) {
      try {
        const afterMeta = await adapter.manifestMeta(group.manifestPath);
        const diff = diffManifestCollateral(beforeMeta, afterMeta, selectedNames);
        if (diff.directives.length > 0 || diff.unselectedRequires.length > 0) {
          collateral.push({ manifestPath: group.manifestPath, diff });
          logCollateral(group.manifestPath, diff);
        }
      } catch {
        // Collateral is best-effort; the write already finished.
      }
    }
  }

  for (const result of results) {
    output?.appendLine(
      `result ${result.manifestPath}: ${result.status}${
        result.message === undefined ? '' : ` — ${result.message}`
      }`,
    );
  }

  await refresh(context, false, { force: true });

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

  return { results, collateral };
}

function logCollateral(manifestPath: string, diff: ManifestCollateral): void {
  for (const change of diff.directives) {
    output?.appendLine(
      `collateral ${manifestPath}: ${change.field} ${change.from ?? '(none)'} → ${change.to ?? '(none)'}`,
    );
  }
  for (const change of diff.unselectedRequires) {
    output?.appendLine(
      `collateral ${manifestPath}: ${change.kind} ${change.name} ${change.from ?? ''} → ${change.to ?? ''}`.trim(),
    );
  }
}

function collectDirectiveChanges(
  collateral: readonly { readonly diff: ManifestCollateral }[],
): DirectiveChange[] {
  const seen = new Set<string>();
  const changes: DirectiveChange[] = [];
  for (const entry of collateral) {
    for (const change of entry.diff.directives) {
      const key = `${change.field}:${change.from ?? ''}:${change.to ?? ''}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      changes.push(change);
    }
  }
  return changes;
}

function vendoredManifests(
  adapter: EcosystemAdapter,
  manifests: readonly string[],
): string[] {
  const check = adapter.isVendored;
  if (check === undefined) {
    return [];
  }
  return [...new Set(manifests)].filter((manifestPath) => check(manifestPath));
}

interface WriteFollowUpOptions {
  readonly context: vscode.ExtensionContext;
  readonly adapter: EcosystemAdapter;
  readonly message: string;
  readonly succeededManifests: readonly string[];
  readonly written: readonly { readonly manifestPath: string; readonly name: string }[];
  readonly declaredBefore: readonly { readonly manifestPath: string; readonly name: string }[];
  readonly collateral?: readonly { readonly diff: ManifestCollateral }[];
  readonly pruneSelection?: boolean;
  readonly undoLabel?: string;
}

/**
 * One completion toast: Undo → Run go mod tidy → Sync vendor, with go/toolchain
 * bumps in the body. Tidy is skipped for projects that gained a new module.
 */
async function offerWriteFollowUp(options: WriteFollowUpOptions): Promise<void> {
  const {
    context,
    adapter,
    succeededManifests,
    written,
    declaredBefore,
    pruneSelection = false,
    undoLabel = 'Undo',
  } = options;

  if (succeededManifests.length === 0) {
    return;
  }

  if (pruneSelection) {
    const succeeded = new Set(succeededManifests);
    const removeIds = written
      .filter((entry) => succeeded.has(entry.manifestPath))
      .map((entry) => `${entry.manifestPath}#${entry.name}`);
    GmmPanel.pruneSelection(removeIds, { removeVisibleWithoutUpdate: true });
  }

  const tidyTargets = tidyEligibleManifests(
    succeededManifests,
    written,
    declaredBefore,
  );
  const vendorTargets = vendoredManifests(adapter, succeededManifests);
  const directiveNotice = formatDirectiveNotice(
    collectDirectiveChanges(options.collateral ?? []),
  );
  const body =
    directiveNotice === undefined
      ? options.message
      : `${options.message} (${directiveNotice})`;

  const actions: string[] = [undoLabel];
  if (tidyTargets.length > 0 && adapter.tidy !== undefined) {
    actions.push('Run go mod tidy');
  }
  if (vendorTargets.length > 0 && adapter.vendor !== undefined) {
    actions.push(
      vendorTargets.length === 1 ? 'Sync vendor' : `Sync vendor (${vendorTargets.length})`,
    );
  }

  const choice = await vscode.window.showInformationMessage(body, ...actions);
  if (choice === undoLabel) {
    await runAction(undoLabel === 'Undo tidy' ? 'Undoing tidy…' : 'Undoing…', async () => {
      await undoResults(adapter, succeededManifests);
      await refresh(context, false, { force: true });
      const stillVendored = vendoredManifests(adapter, succeededManifests);
      if (stillVendored.length > 0 && adapter.vendor !== undefined) {
        const sync = await vscode.window.showInformationMessage(
          'GMM: go.mod restored. Sync vendor/ to match?',
          stillVendored.length === 1
            ? 'Sync vendor'
            : `Sync vendor (${stillVendored.length})`,
        );
        if (sync !== undefined) {
          await vendorProjects(adapter, stillVendored, { fromUndo: true });
        }
      }
    });
    return;
  }
  if (choice === 'Run go mod tidy') {
    await tidyProjects(context, [...tidyTargets], { fromFollowUp: true });
    return;
  }
  if (choice !== undefined && choice.startsWith('Sync vendor')) {
    await vendorProjects(adapter, vendorTargets);
  }
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
  const loaded = current;
  if (loaded === undefined || loaded.adapter.update === undefined) {
    return;
  }

  const change = request.changes[0];
  const removing = change?.version === 'none';
  const busyLabel = removing ? 'Removing dependency…' : 'Updating dependencies…';
  const declaredBefore = loaded.model.rows.map((row) => ({
    manifestPath: row.manifestPath,
    name: row.name,
  }));

  const outcome = await runAction(busyLabel, () =>
    runGroups(context, loaded.adapter, [request]),
  );
  if (outcome === undefined) {
    return;
  }

  const result = outcome.results[0];
  if (result === undefined || change === undefined) {
    return;
  }
  if (result.status === 'failed') {
    showUpdateFailure(
      removing
        ? `GMM: ${change.name} could not be removed.`
        : `GMM: ${change.name} could not be updated.`,
      result.message ?? '',
    );
    return;
  }

  const fresh = current;
  if (fresh === undefined) {
    return;
  }

  // Report what the toolchain resolved, not what was requested.
  const row = fresh.model.rows.find(
    (entry) => entry.manifestPath === request.manifestPath && entry.name === change.name,
  );
  const resolved = row?.resolvedVersion ?? row?.declaredVersion;

  const toastMessage = removing
    ? `GMM: ${change.name} removed`
    : resolved === undefined
      ? `GMM: ${change.name} updated`
      : `GMM: ${change.name} resolved to ${resolved}`;

  await offerWriteFollowUp({
    context,
    adapter: loaded.adapter,
    message: toastMessage,
    succeededManifests: [request.manifestPath],
    written: [{ manifestPath: request.manifestPath, name: change.name }],
    declaredBefore,
    collateral: outcome.collateral,
  });
}

async function applyTargets(
  context: vscode.ExtensionContext,
  targets: readonly TargetChange[],
): Promise<void> {
  const loaded = current;
  if (loaded === undefined || loaded.adapter.update === undefined) {
    return;
  }

  const groups = planTargetChanges(targets);
  if (groups.length === 0) {
    return;
  }
  if (groups.length === 1 && groups[0] !== undefined && groups[0].changes.length === 1) {
    await updateDependency(context, groups[0]);
    return;
  }

  const removingAll = targets.every((target) => target.version === 'none');
  const declaredBefore = loaded.model.rows.map((row) => ({
    manifestPath: row.manifestPath,
    name: row.name,
  }));
  const outcome = await runAction(
    removingAll ? 'Removing dependencies…' : 'Updating dependencies…',
    () => runGroups(context, loaded.adapter, groups),
  );
  if (outcome === undefined) {
    return;
  }

  const failed = outcome.results.filter((result) => result.status === 'failed');
  const succeeded = outcome.results.filter((result) => result.status === 'updated');

  if (failed.length > 0) {
    showUpdateFailure(
      `GMM: ${failed.length} of ${outcome.results.length} project updates failed.`,
      failed[0]?.message ?? '',
    );
  }
  if (succeeded.length === 0) {
    return;
  }

  const projectCount = new Set(succeeded.map((result) => result.manifestPath)).size;
  await offerWriteFollowUp({
    context,
    adapter: loaded.adapter,
    message: removingAll
      ? `GMM: removed from ${projectCount} project(s).`
      : `GMM: updated in ${projectCount} project(s).`,
    succeededManifests: [...new Set(succeeded.map((result) => result.manifestPath))],
    written: succeeded.flatMap((result) =>
      result.changes.map((change) => ({
        manifestPath: result.manifestPath,
        name: change.name,
      })),
    ),
    declaredBefore,
    collateral: outcome.collateral,
  });
}

async function bulkUpdate(
  context: vscode.ExtensionContext,
  targets: readonly TargetChange[],
  skippedVisible = 0,
): Promise<void> {
  const loaded = current;
  if (loaded === undefined || loaded.adapter.update === undefined) {
    return;
  }

  const groups = planTargetChanges(targets);
  if (groups.length === 0) {
    void vscode.window.showInformationMessage(
      'GMM: nothing in that selection has an update to move to.',
    );
    return;
  }

  const declaredBefore = loaded.model.rows.map((row) => ({
    manifestPath: row.manifestPath,
    name: row.name,
  }));
  const outcome = await runAction('Confirming update…', async () => {
    const planned = groups.reduce((total, group) => total + group.changes.length, 0);
    const confirmed = await vscode.window.showWarningMessage(
      `Update ${planned} dependencies in ${groups.length} go.mod file(s)?${
        skippedVisible > 0
          ? `\n${skippedVisible} selected rows have no update and will be skipped.`
          : ''
      }\n${groups.map((group) => group.manifestPath).join('\n')}`,
      { modal: true },
      'Update',
    );
    if (confirmed !== 'Update') {
      return undefined;
    }

    setBusy('Updating dependencies…');
    return runGroups(context, loaded.adapter, groups);
  });
  if (outcome === undefined) {
    return;
  }

  const failed = outcome.results.filter((result) => result.status === 'failed');
  const succeeded = outcome.results.filter((result) => result.status === 'updated');

  if (failed.length > 0) {
    showUpdateFailure(
      `GMM: ${failed.length} of ${outcome.results.length} dependency updates failed.`,
      failed[0]?.message ?? '',
    );
  }
  if (succeeded.length === 0) {
    return;
  }

  const moved = succeeded.reduce((total, result) => total + result.changes.length, 0);
  const projectCount = new Set(succeeded.map((result) => result.manifestPath)).size;
  await offerWriteFollowUp({
    context,
    adapter: loaded.adapter,
    message: `GMM: ${moved} dependencies updated in ${projectCount} project(s).`,
    succeededManifests: [...new Set(succeeded.map((result) => result.manifestPath))],
    written: succeeded.flatMap((result) =>
      result.changes.map((change) => ({
        manifestPath: result.manifestPath,
        name: change.name,
      })),
    ),
    declaredBefore,
    collateral: outcome.collateral,
    pruneSelection: true,
  });
}

async function tidyProjects(
  context: vscode.ExtensionContext,
  manifests: readonly string[],
  options: { readonly fromFollowUp?: boolean } = {},
): Promise<void> {
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

  const succeededManifests = await runAction(
    options.fromFollowUp === true ? 'Running go mod tidy…' : 'Confirming go mod tidy…',
    async () => {
      if (options.fromFollowUp !== true) {
        const confirmed = await vscode.window.showWarningMessage(
          `Run go mod tidy in ${targets.length} project(s)? This removes requirements nothing imports yet.\n${targets.join(
            '\n',
          )}`,
          { modal: true },
          'Run tidy',
        );
        if (confirmed !== 'Run tidy') {
          return [];
        }
        setBusy('Running go mod tidy…');
      }

      const ok: string[] = [];
      for (const manifestPath of targets) {
        try {
          await tidy(manifestPath);
          ok.push(manifestPath);
        } catch (error) {
          showFailure(manifestPath, error);
        }
      }
      await refresh(context, false, { force: true });
      return ok;
    },
  );
  if (succeededManifests === undefined || succeededManifests.length === 0) {
    return;
  }

  const vendorTargets = vendoredManifests(loaded.adapter, succeededManifests);
  const message =
    succeededManifests.length === 1
      ? 'GMM: go mod tidy finished in 1 project.'
      : `GMM: go mod tidy finished in ${succeededManifests.length} projects.`;
  const actions: string[] = ['Undo tidy'];
  if (vendorTargets.length > 0 && loaded.adapter.vendor !== undefined) {
    actions.push(
      vendorTargets.length === 1 ? 'Sync vendor' : `Sync vendor (${vendorTargets.length})`,
    );
  }
  const choice = await vscode.window.showInformationMessage(message, ...actions);
  if (choice === 'Undo tidy') {
    await runAction('Undoing tidy…', async () => {
      await undoResults(loaded.adapter, succeededManifests);
      await refresh(context, false, { force: true });
      const stillVendored = vendoredManifests(loaded.adapter, succeededManifests);
      if (stillVendored.length > 0 && loaded.adapter.vendor !== undefined) {
        const sync = await vscode.window.showInformationMessage(
          'GMM: go.mod restored. Sync vendor/ to match?',
          stillVendored.length === 1
            ? 'Sync vendor'
            : `Sync vendor (${stillVendored.length})`,
        );
        if (sync !== undefined) {
          await vendorProjects(loaded.adapter, stillVendored, { fromUndo: true });
        }
      }
    });
    return;
  }
  if (choice !== undefined && choice.startsWith('Sync vendor')) {
    await vendorProjects(loaded.adapter, vendorTargets);
  }
}

async function vendorProjects(
  adapter: EcosystemAdapter,
  manifests: readonly string[],
  options: { readonly fromUndo?: boolean } = {},
): Promise<void> {
  const vendor = adapter.vendor;
  if (vendor === undefined) {
    return;
  }
  const targets = vendoredManifests(adapter, manifests);
  if (targets.length === 0) {
    void vscode.window.showInformationMessage(
      'GMM: none of those projects have vendor/modules.txt.',
    );
    return;
  }

  await runAction('Syncing vendor…', async () => {
    let count = 0;
    for (const manifestPath of targets) {
      try {
        await vendor(manifestPath);
        count += 1;
      } catch (error) {
        showFailure(manifestPath, error);
      }
    }
    if (count > 0) {
      void vscode.window.showInformationMessage(
        options.fromUndo === true
          ? `GMM: vendor synced in ${count} project(s) after undo.`
          : `GMM: vendor synced in ${count} project(s).`,
      );
    }
    // vendor/ is not watched as go.mod; no model refresh required.
  });
}

async function scanProjects(manifests: readonly string[]): Promise<void> {
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
  await runAction('Scanning reachable code…', async () => {
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
  });
}

async function requestVersions(modulePath: string): Promise<void> {
  const get = current?.adapter.versions;
  if (get === undefined) {
    return;
  }

  try {
    GmmPanel.postVersionsLoading(modulePath);
    GmmPanel.postVersions(modulePath, await get(modulePath));
  } catch {
    // Keep the versions the panel already knows; listing is optional.
    GmmPanel.postVersions(modulePath, []);
  }
}

async function requestWhy(manifestPath: string, name: string): Promise<void> {
  const why = current?.adapter.why;
  if (why === undefined) {
    return;
  }
  try {
    GmmPanel.postWhy(manifestPath, name, { text: await why(manifestPath, name) });
  } catch (error) {
    GmmPanel.postWhy(manifestPath, name, { error: messageOf(error) });
  }
}

async function requestReleaseNotes(modulePath: string, version: string): Promise<void> {
  const key = `${modulePath}@${version}`;
  const cached = releaseNotesCache.get(key);
  const pending =
    cached ??
    fetchReleaseNotes(modulePath, version, fetchGitHubJson);
  if (cached === undefined) {
    releaseNotesCache.set(key, pending);
    void pending.catch(() => releaseNotesCache.delete(key));
  }
  GmmPanel.postReleaseNotes(modulePath, version, await pending);
}

async function requestPreview(
  manifestPath: string,
  name: string,
  version: string,
): Promise<void> {
  const preview = current?.adapter.preview;
  if (preview === undefined) {
    return;
  }
  await runAction('Previewing impact…', async () => {
    try {
      GmmPanel.postPreview(
        await preview({ manifestPath, changes: [{ name, version }], snapshot: false }),
      );
    } catch (error) {
      GmmPanel.postPreview({
        manifestPath,
        name,
        version,
        status: 'failed',
        impact: [],
        message: messageOf(error),
      });
    }
  });
}

async function requestSearch(query: string, pageToken?: string): Promise<void> {
  const search = current?.adapter.search;
  if (search === undefined) {
    return;
  }

  const append = pageToken !== undefined && pageToken !== '';
  if (!append) {
    pendingAppend = undefined;
  } else if (
    pendingAppend !== undefined &&
    pendingAppend.cycle === searchCycle &&
    pendingAppend.token === pageToken
  ) {
    return;
  }

  const token = append ? searchCycle : ++searchCycle;
  if (append) {
    pendingAppend = { token: pageToken ?? '', cycle: token };
  }
  GmmPanel.postSearchLoading(query, append);

  try {
    const response = await search(query, {
      ...(append ? { pageToken } : {}),
    });
    if (token !== searchCycle) {
      return;
    }
    GmmPanel.postSearchResults(response, { append });
  } catch (error) {
    if (token !== searchCycle) {
      return;
    }
    GmmPanel.postSearchResults(
      { query: query.trim(), items: [] },
      { append, error: messageOf(error) },
    );
  } finally {
    if (pendingAppend?.cycle === token) {
      pendingAppend = undefined;
    }
  }
}

async function requestModuleMetadata(
  modulePath: string,
  version?: string,
): Promise<void> {
  const fetchMetadata = current?.adapter.moduleMetadata;
  if (fetchMetadata === undefined) {
    return;
  }
  const key = `${modulePath}@${version ?? ''}`;
  const cached = moduleMetadataCache.get(key);
  const pending = cached ?? fetchMetadata(modulePath, version);
  if (cached === undefined) {
    moduleMetadataCache.set(key, pending);
    void pending.catch(() => moduleMetadataCache.delete(key));
  }
  GmmPanel.postModuleMetadata(modulePath, await pending);
}

async function fetchGitHubJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'go-module-manager',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

async function installScannerCli(): Promise<void> {
  const install = current?.adapter.installScanner;
  if (install === undefined) {
    return;
  }

  await runAction('Installing govulncheck…', async () => {
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
  });
}

async function fillUpdates(
  loaded: LoadedModel,
  fresh: boolean,
  token: number,
): Promise<void> {
  const resolve = loaded.adapter.resolve;
  if (!resolve) {
    // Clear any seeded progress so the panel does not stay locked.
    GmmPanel.update(loaded.model);
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
      GmmPanel.update(report.model, {
        done: report.done,
        total: report.total,
        project: report.project,
      });
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
    GmmPanel.update(resolved);
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
    current = { ...loaded, model: resolved };
    GmmPanel.update(resolved);
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
  const developmentRoot =
    context.extensionMode === vscode.ExtensionMode.Development
      ? process.env.GMM_WORKSPACE_ROOT
      : undefined;
  const roots = workspaceRoots(vscode.workspace.workspaceFolders, developmentRoot);
  if (roots.length === 0) {
    void vscode.window.showErrorMessage('GMM: open a folder before opening the module panel.');
    return undefined;
  }

  output?.appendLine(`workspace: ${roots.join(', ')}`);

  let adapter: EcosystemAdapter | undefined;

  try {
    const goPath = vscode.workspace.getConfiguration('gmm').get<string>('goPath') ?? 'go';
    logGoEnvironment(goPath, roots[0] ?? process.cwd());
    const [detected] = detectAdapters(roots, {
      goPath,
      advisories: ensureAdvisorySource(context, goPath),
    });
    adapter = detected;
    if (!adapter) {
      void vscode.window.showErrorMessage(
        'GMM: no supported manifest in the workspace. Checked go.work use dirs and walked six levels, skipping node_modules and dot-folders.',
      );
      return undefined;
    }
    return { adapter, model: await adapter.read(roots) };
  } catch (error) {
    const message = messageOf(error);
    const kind = (error as { kind?: FailureKind } | null)?.kind;

    if (kind === 'toolchain-missing') {
      void offerToolchainHelp(message, adapter);
      return undefined;
    }

    void vscode.window.showErrorMessage(
      `GMM: could not read the workspace. ${message}`,
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
    if (!surfaceOpen()) {
      return;
    }
    if (refreshTimer !== undefined) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void refresh(context, false, { fromWatcher: true });
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

async function uninstallDependencies(
  context: vscode.ExtensionContext,
  selection: readonly DependencySelection[],
): Promise<void> {
  const loaded = current;
  if (loaded === undefined || loaded.adapter.update === undefined || selection.length === 0) {
    return;
  }

  const targets: TargetChange[] = selection.map((entry) => ({
    manifestPath: entry.manifestPath,
    name: entry.name,
    version: 'none',
  }));
  const groups = planTargetChanges(targets);
  if (groups.length === 0) {
    return;
  }

  const declaredBefore = loaded.model.rows.map((row) => ({
    manifestPath: row.manifestPath,
    name: row.name,
  }));
  const outcome = await runAction('Checking uninstall impact…', async () => {
    const warnings: string[] = [];
    let needsConfirm = false;

    for (const entry of selection) {
      let whyText: string | undefined;
      if (loaded.adapter.why !== undefined) {
        try {
          whyText = await loaded.adapter.why(entry.manifestPath, entry.name);
        } catch {
          whyText = undefined;
        }
      }

      let previewImpact:
        | readonly {
            readonly name: string;
            readonly kind: 'raised' | 'lowered' | 'removed';
            readonly from?: string;
            readonly to?: string;
          }[]
        | undefined;
      if (loaded.adapter.preview !== undefined) {
        try {
          const previewResult = await loaded.adapter.preview({
            manifestPath: entry.manifestPath,
            changes: [{ name: entry.name, version: 'none' }],
            snapshot: false,
          });
          if (previewResult.status === 'ready') {
            previewImpact = previewResult.impact;
          }
        } catch {
          previewImpact = undefined;
        }
      }

      const safety = removeSafety({
        moduleName: entry.name,
        whyText,
        previewImpact,
      });
      if (safety.needsConfirm) {
        needsConfirm = true;
        const project =
          loaded.model.projects.find((item) => item.manifestPath === entry.manifestPath)
            ?.name ?? entry.manifestPath;
        if (safety.importedByCode) {
          warnings.push(
            `Source files in ${project} still import ${entry.name}; removing it from go.mod leaves those imports unresolved until edited or undone.`,
          );
        }
        for (const collateral of safety.collateral) {
          warnings.push(
            collateral.kind === 'removed'
              ? `${project}: drops ${collateral.name} ${collateral.from ?? ''}`.trim()
              : `${project}: ${collateral.kind} ${collateral.name} ${collateral.from ?? ''} → ${collateral.to ?? ''}`.trim(),
          );
        }
      }
    }

    if (needsConfirm) {
      const moduleNames = [...new Set(selection.map((entry) => entry.name))].join(', ');
      const detail =
        warnings.length > 0
          ? `\n\n${warnings.join('\n')}`
          : '\n\nImpact could not be verified beforehand.';
      const confirmed = await vscode.window.showWarningMessage(
        `Uninstall ${moduleNames} from ${groups.length} go.mod file(s)?${detail}`,
        { modal: true },
        'Uninstall',
      );
      if (confirmed !== 'Uninstall') {
        return undefined;
      }
    }

    setBusy(
      selection.length === 1 ? 'Removing dependency…' : 'Removing dependencies…',
    );
    return runGroups(context, loaded.adapter, groups);
  });

  if (outcome === undefined) {
    return;
  }

  const failed = outcome.results.filter((result) => result.status === 'failed');
  const succeeded = outcome.results.filter((result) => result.status === 'updated');

  if (failed.length > 0) {
    showUpdateFailure(
      selection.length === 1 && selection[0] !== undefined
        ? `GMM: ${selection[0].name} could not be removed.`
        : `GMM: ${failed.length} of ${outcome.results.length} removals failed.`,
      failed[0]?.message ?? '',
    );
  }
  if (succeeded.length === 0) {
    return;
  }

  const projectCount = new Set(succeeded.map((result) => result.manifestPath)).size;
  const toastMessage =
    selection.length === 1 && selection[0] !== undefined
      ? `GMM: ${selection[0].name} removed`
      : `GMM: removed from ${projectCount} project(s).`;
  await offerWriteFollowUp({
    context,
    adapter: loaded.adapter,
    message: toastMessage,
    succeededManifests: [...new Set(succeeded.map((result) => result.manifestPath))],
    written: succeeded.flatMap((result) =>
      result.changes.map((change) => ({
        manifestPath: result.manifestPath,
        name: change.name,
      })),
    ),
    declaredBefore,
    collateral: outcome.collateral,
  });
}

async function openManifest(manifestPath: string, name?: string): Promise<void> {
  const uri = vscode.Uri.file(manifestPath);
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, { preview: true });
  const line =
    name === undefined || name.trim() === ''
      ? 1
      : (requireLineNumber(document.getText(), name) ?? 1);
  const position = new vscode.Position(line - 1, 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position));
}

