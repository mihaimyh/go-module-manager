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
  /** Plain-text HTTP seam for the proxy version list. */
  readonly fetchText?: (url: string) => Promise<string>;
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
  fetchText: ((url: string) => Promise<string>) | undefined,
): EcosystemAdapter {
  const key = `${goPath}:${advisories === undefined ? 'plain' : 'advisory'}:${
    fetchText === undefined ? 'text' : 'versions'
  }`;
  const existing = byToolchain.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const adapter =
    goPath === 'go' && advisories === undefined && fetchText === undefined
      ? goAdapter
      : createGoAdapter(createExecGoRunner(goPath), {
          ...(advisories === undefined ? {} : { advisories }),
          ...(fetchText === undefined ? {} : { fetchText }),
        });
  byToolchain.set(key, adapter);
  return adapter;
}

/** Finds every ecosystem with a manifest at the root or one level down. */
export function detectAdapters(
  workspaceRoot: string,
  options: DetectOptions = {},
): readonly EcosystemAdapter[] {
  const candidates: readonly EcosystemAdapter[] = [
    adapterFor(options.goPath ?? 'go', options.advisories, options.fetchText),
  ];

  return candidates.filter(
    (adapter) => findManifestDirectories(workspaceRoot, adapter.manifestFile).length > 0,
  );
}
