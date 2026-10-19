import type { PanelModel, ResolvedProject } from './model';

export interface ResolveOptions {
  /** Ignore a settled cache entry; an in-flight lookup is still shared. */
  readonly fresh?: boolean;
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
}
