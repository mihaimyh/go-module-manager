import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ResolveOptions } from '../../core/adapter';
import type {
  ModuleReplacement,
  ResolvedDependency,
  ResolvedProject,
} from '../../core/model';
import { failureKindFor, GoCommandError } from './errors';
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
  const result = await runner.run(['list', '-m', '-u', '-e', '-json', 'all'], {
    cwd: dirname(manifestPath),
    env: goEnv(),
    timeoutMs: UPDATE_TIMEOUT_MS,
  });

  const parsed = parseModuleList(result.stdout);
  const dependencies = parsed.filter(hasVersion).map(toResolvedDependency);

  // `-e` keeps the modules that resolved. Some toolchain failures still exit
  // non-zero while printing usable JSON, so entries win over the exit code.
  if (dependencies.length > 0) {
    return { manifestPath, dependencies };
  }

  const firstError = parsed.find((entry) => typeof entry.Error?.Err === 'string');
  throw new GoCommandError(
    failureKindFor(result.exitCode, firstError?.Error?.Err ?? result.stderr),
    `${manifestPath}: ${firstLine(firstError?.Error?.Err ?? result.stderr)}`,
  );
}

function toResolvedDependency(
  entry: ModuleListEntry & { Path: string; Version: string },
): ResolvedDependency {
  const replacement = replacementOf(entry);
  const update = entry.Update?.Version;
  // A replace wins over the build list: the declared version is not the code
  // that runs, and `go get <declared path>@<update>` would not change it.
  const candidate =
    replacement === undefined && update !== undefined && !isPseudoVersion(update)
      ? update
      : undefined;

  return {
    name: entry.Path,
    version: replacement?.version ?? entry.Version,
    ...(candidate === undefined
      ? {}
      : { candidate, kind: classifyGoUpdate(entry.Version, candidate) }),
    ...(replacement === undefined ? {} : { replacement }),
  };
}

function replacementOf(
  entry: ModuleListEntry & { Path: string; Version: string },
): ModuleReplacement | undefined {
  const path = entry.Replace?.Path;
  if (path === undefined) {
    return undefined;
  }
  const version = entry.Replace?.Version;
  return version === undefined ? { path } : { path, version };
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
