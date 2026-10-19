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
  readonly versions?: Readonly<Record<string, readonly string[]>>;
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
      if (message.type === 'versions') {
        const { modulePath, versions } = message;
        setState((current) => ({
          ...current,
          versions: { ...current.versions, [modulePath]: versions },
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

  return (
    <App
      model={state.model}
      progress={state.progress}
      clearSignal={clearSignal}
      versions={state.versions ?? {}}
      onVersions={onVersions}
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
