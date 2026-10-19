import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { failureKindFor, GoCommandError } from './errors';
import { firstLine, goEnv, type GoRunner } from './runner';

/**
 * The checksum database keeps signed tree notes in the module cache. A
 * truncated or corrupted note produces "malformed note" for every module and
 * survives restarts; deleting that cache makes Go refetch it. Downloaded
 * modules live in a sibling directory and are not touched.
 */
export async function cleanChecksumCache(runner: GoRunner): Promise<void> {
  const result = await runner.run(['env', 'GOMODCACHE'], {
    cwd: process.cwd(),
    env: goEnv(),
    timeoutMs: 10_000,
  });

  if (result.exitCode !== 0) {
    throw new GoCommandError(
      failureKindFor(result.exitCode, result.stderr),
      `go env GOMODCACHE failed: ${firstLine(result.stderr)}`,
    );
  }

  const moduleCache = result.stdout.trim();
  if (moduleCache === '') {
    throw new GoCommandError('unknown', 'go env GOMODCACHE returned nothing.');
  }

  rmSync(join(moduleCache, 'cache', 'download', 'sumdb'), {
    recursive: true,
    force: true,
  });
}
