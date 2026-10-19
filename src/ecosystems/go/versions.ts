import { compareVersions, parseVersion } from '../../core/version';
import { failureKindFor, GoCommandError } from './errors';
import { firstLine, goEnv, type GoRunner } from './runner';

const VERSIONS_TIMEOUT_MS = 15_000;

export interface VersionsOptions {
  readonly runner: GoRunner;
  readonly cwd?: string;
}

interface VersionList {
  readonly Versions?: unknown;
  readonly Retract?: readonly { readonly Low?: unknown; readonly High?: unknown }[];
}

/**
 * All tagged versions of a module, newest first, from `go list`. The toolchain
 * honours GOPROXY/GOPRIVATE and already knows which versions are retracted.
 */
export function createVersionsFetcher(options: VersionsOptions) {
  const cache = new Map<string, Promise<readonly string[]>>();

  return {
    fetch(modulePath: string): Promise<readonly string[]> {
      const cached = cache.get(modulePath);
      if (cached !== undefined) {
        return cached;
      }

      const pending = load(modulePath, options);
      cache.set(modulePath, pending);
      void pending.catch(() => cache.delete(modulePath));
      return pending;
    },
  };
}

async function load(
  modulePath: string,
  options: VersionsOptions,
): Promise<readonly string[]> {
  const result = await options.runner.run(['list', '-m', '-versions', '-json', modulePath], {
    cwd: options.cwd ?? process.cwd(),
    env: goEnv(),
    timeoutMs: VERSIONS_TIMEOUT_MS,
  });

  if (result.exitCode !== 0) {
    throw new GoCommandError(
      failureKindFor(result.exitCode, result.stderr),
      firstLine(result.stderr),
    );
  }

  const parsed = JSON.parse(result.stdout) as VersionList;
  const retracted = (parsed.Retract ?? [])
    .map((range) => ({
      low: typeof range.Low === 'string' ? range.Low : undefined,
      high: typeof range.High === 'string' ? range.High : undefined,
    }))
    .filter(
      (range): range is { low: string; high: string } =>
        range.low !== undefined && range.high !== undefined,
    );

  const listed = Array.isArray(parsed.Versions) ? parsed.Versions : [];
  return [
    ...new Set(
      listed.filter((value): value is string => typeof value === 'string'),
    ),
  ]
    .filter(
      (version) => parseVersion(version) !== undefined && !isRetracted(version, retracted),
    )
    .sort((left, right) => compareVersions(right, left));
}

function isRetracted(
  version: string,
  ranges: readonly { readonly low: string; readonly high: string }[],
): boolean {
  return ranges.some(
    (range) =>
      compareVersions(version, range.low) >= 0 && compareVersions(version, range.high) <= 0,
  );
}

export { VERSIONS_TIMEOUT_MS };
