import type { ModuleMetadata, PreviewResult, SearchResponse } from './adapter';
import type { TargetChange } from './bulk';
import type { PanelModel } from './model';

export type { TargetChange };

export interface ReleaseNotes {
  readonly title: string;
  readonly body: string;
  readonly url: string;
}

/** How much of the background update lookup has finished. */
export interface ResolveProgress {
  readonly done: number;
  readonly total: number;
  readonly project?: string;
}

export type HostToWebview =
  | {
      readonly type: 'model';
      readonly model: PanelModel;
      readonly progress?: ResolveProgress;
    }
  | { readonly type: 'clear-selection' }
  | {
      readonly type: 'prune-selection';
      /** Row ids (manifestPath#name) to uncheck after a successful write. */
      readonly removeIds: readonly string[];
      /** Also drop visible checked rows that had no update candidate. */
      readonly removeVisibleWithoutUpdate?: boolean;
    }
  | { readonly type: 'busy'; readonly label?: string }
  | { readonly type: 'versions-loading'; readonly modulePath: string }
  | {
      readonly type: 'versions';
      readonly modulePath: string;
      readonly versions: readonly string[];
    }
  | {
      readonly type: 'why';
      readonly manifestPath: string;
      readonly name: string;
      readonly text?: string;
      readonly error?: string;
    }
  | {
      readonly type: 'release-notes';
      readonly modulePath: string;
      readonly version: string;
      readonly notes?: ReleaseNotes;
    }
  | { readonly type: 'preview'; readonly result: PreviewResult }
  | {
      readonly type: 'search-loading';
      readonly query: string;
      readonly append?: boolean;
    }
  | {
      readonly type: 'search-results';
      readonly response: SearchResponse;
      readonly append?: boolean;
      readonly error?: string;
    }
  | {
      readonly type: 'module-metadata';
      readonly modulePath: string;
      readonly metadata?: ModuleMetadata;
    }
  | {
      readonly type: 'focus';
      readonly manifestPath?: string;
      readonly moduleName?: string;
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
      readonly type: 'apply-targets';
      readonly targets: readonly TargetChange[];
    }
  | {
      /** Versioned targets planned in the webview (respects Include prerelease). */
      readonly type: 'bulk-update';
      readonly targets: readonly TargetChange[];
      /** Visible checked rows with no candidate, for the confirmation copy. */
      readonly skippedVisible?: number;
    }
  | {
      readonly type: 'uninstall';
      readonly targets: readonly DependencySelection[];
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
  | { readonly type: 'open-panel' }
  | { readonly type: 'show-output' }
  | {
      readonly type: 'open-manifest';
      readonly manifestPath: string;
      readonly name?: string;
    }
  | {
      readonly type: 'why';
      readonly manifestPath: string;
      readonly name: string;
    }
  | {
      readonly type: 'release-notes';
      readonly modulePath: string;
      readonly version: string;
    }
  | {
      readonly type: 'preview';
      readonly manifestPath: string;
      readonly name: string;
      readonly version: string;
    }
  | {
      readonly type: 'search';
      readonly query: string;
      readonly pageToken?: string;
    }
  | {
      readonly type: 'module-metadata';
      readonly modulePath: string;
      readonly version?: string;
    };

