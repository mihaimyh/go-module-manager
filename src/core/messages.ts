import type { PanelModel } from './model';

export type HostToWebview = {
  readonly type: 'model';
  readonly model: PanelModel;
};

export type WebviewToHost = {
  readonly type: 'ready';
};
