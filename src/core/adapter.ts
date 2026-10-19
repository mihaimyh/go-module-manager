import type { PanelModel } from './model';

/**
 * The single seam between the panel and a dependency ecosystem.
 *
 * `read` is the only operation that exists today. `plan`, `apply` and
 * `advisories` are added when the Go runner lands, so that their signatures are
 * shaped by a real implementation rather than guessed.
 */
export interface EcosystemAdapter {
  readonly id: string;
  readonly label: string;
  readonly manifestFile: string;
  read(workspaceRoot: string): Promise<PanelModel>;
}
