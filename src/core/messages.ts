import type { PanelModel } from './model';

/** How much of the background update lookup has finished. */
export interface ResolveProgress {
  readonly done: number;
  readonly total: number;
}

export type HostToWebview = {
  readonly type: 'model';
  readonly model: PanelModel;
  readonly progress?: ResolveProgress;
};

export type WebviewToHost =
  | { readonly type: 'ready' }
  | { readonly type: 'refresh' };
