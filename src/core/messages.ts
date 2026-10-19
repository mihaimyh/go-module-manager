import type { PanelModel } from './model';

/** How much of the background update lookup has finished. */
export interface ResolveProgress {
  readonly done: number;
  readonly total: number;
}

export type HostToWebview =
  | {
      readonly type: 'model';
      readonly model: PanelModel;
      readonly progress?: ResolveProgress;
    }
  | { readonly type: 'clear-selection' }
  | {
      readonly type: 'versions';
      readonly modulePath: string;
      readonly versions: readonly string[];
    };

export type RecoveryAction =
  | 'repair'
  | 'retry'
  | 'install'
  | 'clean-checksum-cache';

/** A row the user selected, identified by its project and dependency name. */
export interface DependencySelection {
  readonly manifestPath: string;
  readonly name: string;
}

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
    }
  | {
      readonly type: 'bulk-update';
      readonly selection: readonly DependencySelection[];
    }
  | {
      readonly type: 'tidy';
      readonly manifests: readonly string[];
    }
  | {
      readonly type: 'versions';
      readonly modulePath: string;
    }
  | {
      readonly type: 'scan';
      readonly manifests: readonly string[];
    }
  | { readonly type: 'install-scanner' }
  | { readonly type: 'open-panel' };
