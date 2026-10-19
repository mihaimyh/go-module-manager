import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EcosystemAdapter } from '../core/adapter';
import { findManifestDirectories } from './discovery';
import type { AdvisorySource } from './go/advisory';
import { createGoAdapter, goAdapter } from './go/adapter';
import { createExecGoRunner } from './go/runner';

export interface DetectOptions {
  /** Configured path to the go executable; defaults to the one on PATH. */
  readonly goPath?: string;
  /** Live advisory source; when absent the adapter only reads and resolves. */
  readonly advisories?: AdvisorySource;
}

/**
 * Adapters are memoised per toolchain path and capability: the resolver cache,
 * the undo snapshot, the advisory index and the version cache belong to the
 * adapter or source instance.
 */
const byToolchain = new Map<string, EcosystemAdapter>();

function adapterFor(
  goPath: string,
  advisories: AdvisorySource | undefined,
): EcosystemAdapter {
  const key = `${goPath}:${advisories === undefined ? 'plain' : 'advisory'}`;
  const existing = byToolchain.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const adapter =
    goPath === 'go' && advisories === undefined
      ? goAdapter
      : createGoAdapter(createExecGoRunner(goPath), {
          ...(advisories === undefined ? {} : { advisories }),
        });
  byToolchain.set(key, adapter);
  return adapter;
}

/**
 * Finds every ecosystem with a project under any of the workspace folders.
 * Go is detected from a go.work or from the ADR 0009 tree walk.
 */
export function detectAdapters(
  workspaceRoots: string | readonly string[],
  options: DetectOptions = {},
): readonly EcosystemAdapter[] {
  const roots =
    typeof workspaceRoots === 'string' ? [workspaceRoots] : [...workspaceRoots];
  const candidates: readonly EcosystemAdapter[] = [
    adapterFor(options.goPath ?? 'go', options.advisories),
  ];

  return candidates.filter((adapter) =>
    roots.some((root) => hasProjects(root, adapter.manifestFile)),
  );
}

function hasProjects(workspaceRoot: string, manifestFile: string): boolean {
  if (manifestFile === 'go.mod' && existsSync(join(workspaceRoot, 'go.work'))) {
    return true;
  }
  return findManifestDirectories(workspaceRoot, manifestFile).length > 0;
}
