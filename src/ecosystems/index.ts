import type { EcosystemAdapter } from '../core/adapter';
import { findManifestDirectories } from './discovery';
import { createGoAdapter, goAdapter } from './go/adapter';
import { createExecGoRunner } from './go/runner';

export interface DetectOptions {
  /** Configured path to the go executable; defaults to the one on PATH. */
  readonly goPath?: string;
}

/**
 * Adapters are memoised per toolchain path: the resolver cache and the undo
 * snapshot belong to the adapter instance, so rebuilding one per load would
 * silently drop both.
 */
const byToolchain = new Map<string, EcosystemAdapter>();

function adapterFor(goPath: string): EcosystemAdapter {
  const existing = byToolchain.get(goPath);
  if (existing !== undefined) {
    return existing;
  }
  const adapter = goPath === 'go' ? goAdapter : createGoAdapter(createExecGoRunner(goPath));
  byToolchain.set(goPath, adapter);
  return adapter;
}

/** Finds every ecosystem with a manifest at the root or one level down. */
export function detectAdapters(
  workspaceRoot: string,
  options: DetectOptions = {},
): readonly EcosystemAdapter[] {
  const candidates: readonly EcosystemAdapter[] = [adapterFor(options.goPath ?? 'go')];

  return candidates.filter(
    (adapter) => findManifestDirectories(workspaceRoot, adapter.manifestFile).length > 0,
  );
}
