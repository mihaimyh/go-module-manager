import type { EcosystemAdapter } from '../core/adapter';
import { findManifestDirectories } from './discovery';
import { createGoAdapter, goAdapter } from './go/adapter';
import { createExecGoRunner } from './go/runner';

export interface DetectOptions {
  /** Configured path to the go executable; defaults to the one on PATH. */
  readonly goPath?: string;
}

/** Finds every ecosystem with a manifest at the root or one level down. */
export function detectAdapters(
  workspaceRoot: string,
  options: DetectOptions = {},
): readonly EcosystemAdapter[] {
  const candidates: readonly EcosystemAdapter[] = [
    options.goPath === undefined ? goAdapter : createGoAdapter(createExecGoRunner(options.goPath)),
  ];

  return candidates.filter(
    (adapter) => findManifestDirectories(workspaceRoot, adapter.manifestFile).length > 0,
  );
}
