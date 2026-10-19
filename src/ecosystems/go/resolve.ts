import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ResolveOptions } from '../../core/adapter';
import type { ResolvedDependency, ResolvedProject } from '../../core/model';
import { parseModuleList, type ModuleListEntry } from './goJson';
import { firstLine, goEnv, type GoRunner } from './runner';
import { classifyGoUpdate, isPseudoVersion } from './version';

/** The update lookup hits the network for every module, so it gets more room. */
const UPDATE_TIMEOUT_MS = 120_000;

export interface ProjectResolver {
  resolve(manifestPath: string, options?: ResolveOptions): Promise<ResolvedProject>;
}

interface CacheEntry {
  readonly hash: string;
  readonly pending: Promise<ResolvedProject>;
  settled: boolean;
}

/**
 * Resolves one project's build list and available updates, caching the result
 * by the content of `go.mod` + `go.sum` (the two files that can change it) and
 * sharing one in-flight lookup between concurrent callers.
 */
export function createProjectResolver(runner: GoRunner): ProjectResolver {
  const cache = new Map<string, CacheEntry>();

  return {
    resolve(manifestPath, options = {}) {
      const hash = contentHash(manifestPath);
      const cached = cache.get(manifestPath);

      if (cached !== undefined && cached.hash === hash && (options.fresh !== true || !cached.settled)) {
        return cached.pending;
      }

      const pending = resolveProject(manifestPath, runner);
      const entry: CacheEntry = { hash, pending, settled: false };
      cache.set(manifestPath, entry);

      void pending.then(
        () => {
          entry.settled = true;
        },
        () => {
          if (cache.get(manifestPath) === entry) {
            cache.delete(manifestPath);
          }
        },
      );

      return pending;
    },
  };
}

async function resolveProject(
  manifestPath: string,
  runner: GoRunner,
): Promise<ResolvedProject> {
  const result = await runner.run(['list', '-m', '-u', '-json', 'all'], {
    cwd: dirname(manifestPath),
    env: goEnv(),
    timeoutMs: UPDATE_TIMEOUT_MS,
  });

  if (result.exitCode !== 0) {
    throw new Error(`${manifestPath}: ${firstLine(result.stderr)}`);
  }

  const dependencies = parseModuleList(result.stdout)
    .filter(hasVersion)
    .map(toResolvedDependency);

  return { manifestPath, dependencies };
}

function toResolvedDependency(
  entry: ModuleListEntry & { Path: string; Version: string },
): ResolvedDependency {
  const update = entry.Update?.Version;
  const candidate = update !== undefined && !isPseudoVersion(update) ? update : undefined;

  return {
    name: entry.Path,
    version: entry.Version,
    ...(candidate === undefined
      ? {}
      : { candidate, kind: classifyGoUpdate(entry.Version, candidate) }),
  };
}

function hasVersion(
  entry: ModuleListEntry,
): entry is ModuleListEntry & { Path: string; Version: string } {
  return typeof entry.Path === 'string' && typeof entry.Version === 'string';
}

function contentHash(manifestPath: string): string {
  const hash = createHash('sha256').update(readFileSync(manifestPath));
  const sumPath = join(dirname(manifestPath), 'go.sum');
  hash.update(existsSync(sumPath) ? readFileSync(sumPath) : '');
  return hash.digest('hex');
}
