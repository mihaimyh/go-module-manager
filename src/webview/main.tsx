import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ModuleMetadata, PreviewResult, SearchResult } from '../core/adapter';
import type { TargetChange } from '../core/bulk';
import type {
  DependencySelection,
  HostToWebview,
  RecoveryAction,
  ReleaseNotes,
  ResolveProgress,
  WebviewToHost,
} from '../core/messages';
import type { PanelModel } from '../core/model';
import { App } from './App';
import { vscode } from './vscode';
import './webview.css';

interface ViewState {
  readonly model?: PanelModel;
  readonly progress?: ResolveProgress;
  readonly busy?: string;
  readonly versions?: Readonly<Record<string, readonly string[]>>;
  readonly versionsLoading?: Readonly<Record<string, boolean>>;
  readonly why?: Readonly<Record<string, { readonly text?: string; readonly error?: string }>>;
  readonly releaseNotes?: Readonly<Record<string, ReleaseNotes | null>>;
  readonly preview?: PreviewResult;
  readonly searchItems?: readonly SearchResult[];
  readonly searchLoading?: boolean;
  readonly searchNextPageToken?: string;
  readonly searchError?: string;
  readonly moduleMetadata?: Readonly<Record<string, ModuleMetadata | null>>;
}

function Root(): JSX.Element {
  const [state, setState] = useState<ViewState>({});
  const [clearSignal, setClearSignal] = useState(0);

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostToWebview>): void => {
      const message = event.data;
      if (message.type === 'model') {
        const { model, progress } = message;
        setState((current) => ({ ...current, model, progress }));
      }
      if (message.type === 'clear-selection') {
        setClearSignal((current) => current + 1);
      }
      if (message.type === 'busy') {
        setState((current) => ({ ...current, busy: message.label }));
      }
      if (message.type === 'versions-loading') {
        const { modulePath } = message;
        setState((current) => ({
          ...current,
          versionsLoading: { ...current.versionsLoading, [modulePath]: true },
        }));
      }
      if (message.type === 'versions') {
        const { modulePath, versions } = message;
        setState((current) => ({
          ...current,
          versions: { ...current.versions, [modulePath]: versions },
          versionsLoading: { ...current.versionsLoading, [modulePath]: false },
        }));
      }
      if (message.type === 'why') {
        const { manifestPath, name, text, error } = message;
        setState((current) => ({
          ...current,
          why: {
            ...current.why,
            [`${manifestPath}#${name}`]: {
              ...(text === undefined ? {} : { text }),
              ...(error === undefined ? {} : { error }),
            },
          },
        }));
      }
      if (message.type === 'release-notes') {
        const { modulePath, version, notes } = message;
        setState((current) => ({
          ...current,
          releaseNotes: {
            ...current.releaseNotes,
            [`${modulePath}@${version}`]: notes ?? null,
          },
        }));
      }
      if (message.type === 'preview') {
        setState((current) => ({ ...current, preview: message.result }));
      }
      if (message.type === 'search-loading') {
        setState((current) => ({
          ...current,
          searchLoading: true,
          searchError: undefined,
        }));
      }
      if (message.type === 'search-results') {
        const { response, append, error } = message;
        setState((current) => {
          const previous = append === true ? (current.searchItems ?? []) : [];
          const seen = new Set(previous.map((item) => item.name));
          const merged = [
            ...previous,
            ...response.items.filter((item) => !seen.has(item.name)),
          ];
          return {
            ...current,
            searchItems: merged,
            searchLoading: false,
            searchNextPageToken: response.nextPageToken,
            searchError: error,
          };
        });
      }
      if (message.type === 'module-metadata') {
        const { modulePath, metadata } = message;
        setState((current) => ({
          ...current,
          moduleMetadata: {
            ...current.moduleMetadata,
            [modulePath]: metadata ?? null,
          },
        }));
      }
    };
    window.addEventListener('message', onMessage);
    const ready: WebviewToHost = { type: 'ready' };
    vscode.postMessage(ready);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const onRefresh = (): void => {
    const message: WebviewToHost = { type: 'refresh' };
    vscode.postMessage(message);
  };

  const onRecover = (manifestPath: string, action: RecoveryAction): void => {
    const message: WebviewToHost = { type: 'recover', manifestPath, action };
    vscode.postMessage(message);
  };

  const onUpdate = (manifestPath: string, name: string, version: string): void => {
    const message: WebviewToHost = { type: 'update', manifestPath, name, version };
    vscode.postMessage(message);
  };

  const onApplyTargets = (targets: readonly TargetChange[]): void => {
    const message: WebviewToHost = { type: 'apply-targets', targets };
    vscode.postMessage(message);
  };

  const onBulkUpdate = (selection: readonly DependencySelection[]): void => {
    const message: WebviewToHost = { type: 'bulk-update', selection };
    vscode.postMessage(message);
  };

  const onTidy = (manifests: readonly string[]): void => {
    const message: WebviewToHost = { type: 'tidy', manifests };
    vscode.postMessage(message);
  };

  const onScan = (manifests: readonly string[]): void => {
    const message: WebviewToHost = { type: 'scan', manifests };
    vscode.postMessage(message);
  };

  const onInstallScanner = (): void => {
    const message: WebviewToHost = { type: 'install-scanner' };
    vscode.postMessage(message);
  };

  const onVersions = (modulePath: string): void => {
    const message: WebviewToHost = { type: 'versions', modulePath };
    vscode.postMessage(message);
  };

  const onOpenPanel = (): void => {
    const message: WebviewToHost = { type: 'open-panel' };
    vscode.postMessage(message);
  };

  const onOpenManifest = (manifestPath: string, name: string): void => {
    const message: WebviewToHost = { type: 'open-manifest', manifestPath, name };
    vscode.postMessage(message);
  };

  const onWhy = (manifestPath: string, name: string): void => {
    const message: WebviewToHost = { type: 'why', manifestPath, name };
    vscode.postMessage(message);
  };

  const onReleaseNotes = (modulePath: string, version: string): void => {
    const message: WebviewToHost = { type: 'release-notes', modulePath, version };
    vscode.postMessage(message);
  };

  const onPreview = (manifestPath: string, name: string, version: string): void => {
    const message: WebviewToHost = { type: 'preview', manifestPath, name, version };
    vscode.postMessage(message);
  };

  const onSearch = (query: string, pageToken?: string): void => {
    const message: WebviewToHost = {
      type: 'search',
      query,
      ...(pageToken === undefined ? {} : { pageToken }),
    };
    vscode.postMessage(message);
  };

  const onModuleMetadata = (modulePath: string, version?: string): void => {
    const message: WebviewToHost = {
      type: 'module-metadata',
      modulePath,
      ...(version === undefined ? {} : { version }),
    };
    vscode.postMessage(message);
  };

  return (
    <App
      model={state.model}
      progress={state.progress}
      busy={state.busy}
      versionsLoading={state.versionsLoading ?? {}}
      clearSignal={clearSignal}
      versions={state.versions ?? {}}
      onVersions={onVersions}
      onOpenPanel={onOpenPanel}
      onOpenManifest={onOpenManifest}
      why={state.why ?? {}}
      onWhy={onWhy}
      releaseNotes={state.releaseNotes ?? {}}
      onReleaseNotes={onReleaseNotes}
      preview={state.preview}
      onPreview={onPreview}
      searchItems={state.searchItems ?? []}
      searchLoading={state.searchLoading === true}
      searchNextPageToken={state.searchNextPageToken}
      searchError={state.searchError}
      onSearch={onSearch}
      moduleMetadata={state.moduleMetadata ?? {}}
      onModuleMetadata={onModuleMetadata}
      onRefresh={onRefresh}
      onRecover={onRecover}
      onUpdate={onUpdate}
      onApplyTargets={onApplyTargets}
      onBulkUpdate={onBulkUpdate}
      onTidy={onTidy}
      onScan={onScan}
      onInstallScanner={onInstallScanner}
    />
  );
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('GMM: missing #root container');
}
createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
