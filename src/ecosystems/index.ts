import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { EcosystemAdapter } from '../core/adapter';
import { goAdapter } from './go/adapter';

export const adapters: readonly EcosystemAdapter[] = [goAdapter];

/** Finds every registered ecosystem with a manifest at the root or one level down. */
export function detectAdapters(workspaceRoot: string): readonly EcosystemAdapter[] {
  return adapters.filter((adapter) => hasManifest(workspaceRoot, adapter.manifestFile));
}

function hasManifest(workspaceRoot: string, manifestFile: string): boolean {
  if (existsSync(join(workspaceRoot, manifestFile))) {
    return true;
  }
  return readdirSync(workspaceRoot, { withFileTypes: true }).some(
    (entry) => entry.isDirectory() && existsSync(join(workspaceRoot, entry.name, manifestFile)),
  );
}
