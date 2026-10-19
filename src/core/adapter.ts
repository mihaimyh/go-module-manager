import type { PanelModel, ResolvedProject } from './model';

export interface ResolveOptions {
  /** Ignore a settled cache entry; an in-flight lookup is still shared. */
  readonly fresh?: boolean;
}

export interface UpdateRequest {
  readonly manifestPath: string;
  readonly name: string;
  readonly version: string;
}

export interface UpdateOutcome {
  readonly manifestPath: string;
  readonly name: string;
  readonly version: string;
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
  /** Moves one dependency, writing only that project's manifest and lock file. */
  update?(request: UpdateRequest): Promise<UpdateOutcome>;
  /** Restores the snapshot taken before the last update of that project. */
  undo?(manifestPath: string): Promise<boolean>;
  /** Where to send a user whose toolchain is missing. */
  readonly toolchainUrl?: string;
}
