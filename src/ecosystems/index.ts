import type { EcosystemAdapter } from '../core/adapter';
import { findManifestDirectories } from './discovery';
import { goAdapter } from './go/adapter';

export const adapters: readonly EcosystemAdapter[] = [goAdapter];

/** Finds every registered ecosystem with a manifest at the root or one level down. */
export function detectAdapters(workspaceRoot: string): readonly EcosystemAdapter[] {
  return adapters.filter(
    (adapter) => findManifestDirectories(workspaceRoot, adapter.manifestFile).length > 0,
  );
}
