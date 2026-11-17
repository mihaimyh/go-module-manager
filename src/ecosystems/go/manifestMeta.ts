import { dirname } from 'node:path';
import type { ManifestDirectives, ManifestRequire } from '../../core/collateral';
import { parseGoModJson } from './goJson';
import { goEnv, type GoRunner } from './runner';

const READ_TIMEOUT_MS = 60_000;

export interface ManifestMeta {
  readonly directives: ManifestDirectives;
  readonly requires: readonly ManifestRequire[];
}

/** Reads go/toolchain directives and require lines via `go mod edit -json`. */
export async function readManifestMeta(
  manifestPath: string,
  runner: GoRunner,
): Promise<ManifestMeta> {
  const result = await runner.run(['mod', 'edit', '-json'], {
    cwd: dirname(manifestPath),
    env: goEnv(),
    timeoutMs: READ_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    return { directives: {}, requires: [] };
  }

  const goMod = parseGoModJson(result.stdout);
  const requires = (goMod.Require ?? [])
    .map((entry): ManifestRequire | undefined => {
      if (!entry.Path || !entry.Version) {
        return undefined;
      }
      return { name: entry.Path, version: entry.Version };
    })
    .filter((entry): entry is ManifestRequire => entry !== undefined);

  return {
    directives: {
      ...(goMod.Go === undefined ? {} : { go: goMod.Go }),
      ...(goMod.Toolchain === undefined ? {} : { toolchain: goMod.Toolchain }),
    },
    requires,
  };
}
