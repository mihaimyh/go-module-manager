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

export type RecoveryAction = 'repair' | 'retry' | 'install';

export type WebviewToHost =
  | { readonly type: 'ready' }
  | { readonly type: 'refresh' }
  | {
      readonly type: 'recover';
      readonly manifestPath: string;
      readonly action: RecoveryAction;
    }
  | {
      readonly type: 'update';
      readonly manifestPath: string;
      readonly name: string;
      readonly version: string;
    };
