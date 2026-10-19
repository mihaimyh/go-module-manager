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
}

function Root(): JSX.Element {
  const [state, setState] = useState<ViewState>({});

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostToWebview>): void => {
      if (event.data.type === 'model') {
        setState({ model: event.data.model, progress: event.data.progress });
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

  return (
    <App
      model={state.model}
      progress={state.progress}
      onRefresh={onRefresh}
      onRecover={onRecover}
      onUpdate={onUpdate}
      onBulkUpdate={onBulkUpdate}
      onTidy={onTidy}
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
