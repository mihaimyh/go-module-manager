import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { HostToWebview, ResolveProgress, WebviewToHost } from '../core/messages';
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

  const onRecover = (manifestPath: string, action: 'download' | 'retry' | 'install'): void => {
    const message: WebviewToHost = { type: 'recover', manifestPath, action };
    vscode.postMessage(message);
  };

  return (
    <App
      model={state.model}
      progress={state.progress}
      onRefresh={onRefresh}
      onRecover={onRecover}
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
