import type { DependencySelection, RecoveryAction } from '../core/messages';
import type { UpdateRequest } from '../core/adapter';
import type { TargetChange } from '../core/bulk';

export interface PanelHandlers {
  readonly onRefresh: () => void;
  readonly onRecover: (manifestPath: string, action: RecoveryAction) => void;
  readonly onUpdate: (request: UpdateRequest) => void;
  readonly onApplyTargets: (targets: readonly TargetChange[]) => void;
  readonly onBulkUpdate: (selection: readonly DependencySelection[]) => void;
  readonly onUninstall: (targets: readonly DependencySelection[]) => void;
  readonly onTidy: (manifests: readonly string[]) => void;
  readonly onScan: (manifests: readonly string[]) => void;
  readonly onInstallScanner: () => void;
  readonly onVersions: (modulePath: string) => void;
  readonly onOpenPanel: () => void;
  readonly onShowOutput: () => void;
  readonly onOpenManifest: (manifestPath: string, name?: string) => void;
  readonly onWhy: (manifestPath: string, name: string) => void;
  readonly onReleaseNotes: (modulePath: string, version: string) => void;
  readonly onPreview: (manifestPath: string, name: string, version: string) => void;
  readonly onSearch: (query: string, pageToken?: string) => void;
  readonly onModuleMetadata: (modulePath: string, version?: string) => void;
}

