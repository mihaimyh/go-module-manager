import { dirname } from 'node:path';
import { failureKindFor, GoCommandError } from './errors';
import { firstLine, goEnv, type GoRunner } from './runner';

const DOWNLOAD_TIMEOUT_MS = 120_000;

/** The recovery action for a missing go.sum entry. */
export async function downloadModules(
  manifestPath: string,
  runner: GoRunner,
): Promise<void> {
  const result = await runner.run(['mod', 'download'], {
    cwd: dirname(manifestPath),
    env: goEnv(),
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
  });

  if (result.exitCode !== 0) {
    throw new GoCommandError(
      failureKindFor(result.exitCode, result.stderr),
      `go mod download failed: ${firstLine(result.stderr)}`,
    );
  }
}
