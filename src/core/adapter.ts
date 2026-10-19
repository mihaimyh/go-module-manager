import type {
  AdvisoryReport,
  AdvisoryTarget,
  PanelModel,
  ResolvedProject,
} from './model';
import type { CallGraphFinding } from './scan';

export interface ResolveOptions {
  /** Ignore a settled cache entry; an in-flight lookup is still shared. */
  readonly fresh?: boolean;
}

export interface PlannedChange {
  readonly name: string;
  readonly version: string;
}

export interface UpdateRequest {
  readonly manifestPath: string;
  readonly changes: readonly PlannedChange[];
  /** False for fallback retries that must reuse the action's first snapshot. */
  readonly snapshot?: boolean;
}

export interface UpdateResult {
  readonly manifestPath: string;
  readonly changes: readonly PlannedChange[];
  readonly status: 'updated' | 'failed';
  readonly message?: string;
}

/**
 * The single seam between the panel and a dependency ecosystem.
 *
 * `read` is fast and offline; `resolve` fills in build-list versions and
 * available updates for one project. Writes arrive with a later ticket.
 */
export interface EcosystemAdapter {
  readonly id: string;
  readonly label: string;
  readonly manifestFile: string;
  read(workspaceRoot: string): Promise<PanelModel>;
  resolve?(manifestPath: string, options?: ResolveOptions): Promise<ResolvedProject>;
  /** Recovery for a missing lock entry; bounded to the owning project. */
  repair?(manifestPath: string): Promise<void>;
  /** Moves the selected dependencies, writing only that project's manifest and lock file. */
  update?(request: UpdateRequest): Promise<UpdateResult>;
  /** Restores the snapshot taken before the last update of that project. */
  undo?(manifestPath: string): Promise<boolean>;
  /** Tidies one project; only ever called from its own confirmed action. */
  tidy?(manifestPath: string): Promise<void>;
  /** Attaches advisories for the resolved versions in the model. */
  advisories?(
    targets: readonly AdvisoryTarget[],
    options?: { readonly fresh?: boolean },
  ): Promise<AdvisoryReport>;
  /** Runs the precise, call-graph scan for one project. */
  scan?(manifestPath: string): Promise<readonly CallGraphFinding[]>;
  /** Optional: installs the scanner CLI for terminal use; scans never need it. */
  installScanner?(): Promise<void>;
  /** Every tagged version of a module, newest first, for the version picker. */
  versions?(modulePath: string): Promise<readonly string[]>;
  /** Where to send a user whose toolchain is missing. */
  readonly toolchainUrl?: string;
}
