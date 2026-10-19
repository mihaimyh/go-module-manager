import type { DependencySelection, RecoveryAction } from '../core/messages';
import type { UpdateRequest } from '../core/adapter';

export interface PanelHandlers {
  readonly onRefresh: () => void;
  readonly onRecover: (manifestPath: string, action: RecoveryAction) => void;
  readonly onUpdate: (request: UpdateRequest) => void;
  readonly onBulkUpdate: (selection: readonly DependencySelection[]) => void;
  readonly onTidy: (manifests: readonly string[]) => void;
  readonly onScan: (manifests: readonly string[]) => void;
  readonly onInstallScanner: () => void;
  readonly onVersions: (modulePath: string) => void;
  readonly onOpenPanel: () => void;
  readonly onOpenManifest: (manifestPath: string, name: string) => void;
}
