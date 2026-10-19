import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { DependencySelection, HostToWebview, RecoveryAction, ResolveProgress, WebviewToHost } from '../core/messages';
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
      onRefresh={onRefresh}
      onRecover={onRecover}
      onUpdate={onUpdate}
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
