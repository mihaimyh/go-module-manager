import type { DependencySelection, RecoveryAction } from '../core/messages';
import type { PanelModel } from '../core/model';
import type { PanelHandlers } from './handlers';

export interface MessageTarget {
  readonly getModel: () => PanelModel | undefined;
  readonly handlers: PanelHandlers;
  readonly postModel: () => void;
}

interface RawMessage {
  readonly type?: string;
  readonly manifestPath?: string;
  readonly action?: string;
  readonly name?: string;
  readonly version?: string;
  readonly modulePath?: string;
  readonly selection?: unknown;
  readonly manifests?: unknown;
}

const RECOVERY_ACTIONS: readonly RecoveryAction[] = [
  'repair',
  'retry',
  'install',
  'clean-checksum-cache',
];

/** One dispatcher for both webview surfaces; validation happens here. */
export function handleWebviewMessage(raw: unknown, target: MessageTarget): void {
  if (typeof raw !== 'object' || raw === null) {
    return;
  }
  const message = raw as RawMessage;
  // The Activity Bar view resolves before the first model exists, so `ready`
  // must reach the host even when there is nothing to post yet.
  if (message.type === 'ready') {
    target.postModel();
    return;
  }

  const model = target.getModel();
  if (model === undefined) {
    return;
  }

  switch (message.type) {
    case 'refresh':
      target.handlers.onRefresh();
      return;
    case 'recover':
      if (
        typeof message.manifestPath === 'string' &&
        typeof message.action === 'string' &&
        (RECOVERY_ACTIONS as readonly string[]).includes(message.action)
      ) {
        target.handlers.onRecover(message.manifestPath, message.action as RecoveryAction);
      }
      return;
    case 'update': {
      if (
        typeof message.manifestPath !== 'string' ||
        typeof message.name !== 'string' ||
        typeof message.version !== 'string'
      ) {
        return;
      }
      const known = model.rows.some(
        (row) => row.manifestPath === message.manifestPath && row.name === message.name,
      );
      if (known) {
        target.handlers.onUpdate({
          manifestPath: message.manifestPath,
          changes: [{ name: message.name, version: message.version }],
        });
      }
      return;
    }
    case 'bulk-update': {
      const selection = toSelection(message.selection, model);
      if (selection.length > 0) {
        target.handlers.onBulkUpdate(selection);
      }
      return;
    }
    case 'tidy':
      target.handlers.onTidy(toManifests(message.manifests, model));
      return;
    case 'scan':
      target.handlers.onScan(toManifests(message.manifests, model));
      return;
    case 'install-scanner':
      target.handlers.onInstallScanner();
      return;
    case 'versions':
      if (
        typeof message.modulePath === 'string' &&
        model.rows.some((row) => row.name === message.modulePath)
      ) {
        target.handlers.onVersions(message.modulePath);
      }
      return;
    case 'open-panel':
      target.handlers.onOpenPanel();
      return;
    case 'open-manifest':
      if (
        typeof message.manifestPath === 'string' &&
        typeof message.name === 'string' &&
        model.rows.some(
          (row) => row.manifestPath === message.manifestPath && row.name === message.name,
        )
      ) {
        target.handlers.onOpenManifest(message.manifestPath, message.name);
      }
      return;
    case 'why':
      if (
        typeof message.manifestPath === 'string' &&
        typeof message.name === 'string' &&
        model.rows.some(
          (row) => row.manifestPath === message.manifestPath && row.name === message.name,
        )
      ) {
        target.handlers.onWhy(message.manifestPath, message.name);
      }
      return;
    case 'release-notes':
      if (typeof message.modulePath === 'string' && typeof message.version === 'string') {
        target.handlers.onReleaseNotes(message.modulePath, message.version);
      }
      return;
    case 'preview':
      if (
        typeof message.manifestPath === 'string' &&
        typeof message.name === 'string' &&
        typeof message.version === 'string' &&
        model.rows.some(
          (row) => row.manifestPath === message.manifestPath && row.name === message.name,
        )
      ) {
        target.handlers.onPreview(message.manifestPath, message.name, message.version);
      }
      return;
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
