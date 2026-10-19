import type {
  AdvisoryReport,
  AdvisoryTarget,
  PanelModel,
  ResolvedProject,
} from './model';

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
  /** Where to send a user whose toolchain is missing. */
  readonly toolchainUrl?: string;
}
