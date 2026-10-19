import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { HostToWebview, WebviewToHost } from '../core/messages';
import type { PanelModel } from '../core/model';
import { App } from './App';
import { vscode } from './vscode';
import './webview.css';

function Root(): JSX.Element {
  const [model, setModel] = useState<PanelModel | undefined>();

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostToWebview>): void => {
      if (event.data.type === 'model') {
        setModel(event.data.model);
      }
    };
    window.addEventListener('message', onMessage);
    const ready: WebviewToHost = { type: 'ready' };
    vscode.postMessage(ready);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return <App model={model} />;
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
