import { dirname } from 'node:path';
import { failureKindFor, GoCommandError } from './errors';
import { firstLine, goEnv, type GoRunner } from './runner';

const TIDY_TIMEOUT_MS = 120_000;

/**
 * `go mod tidy` removes requirements nothing imports yet, so it is never part
 * of an update: it only runs from its own confirmed action.
 */
export async function tidyProject(manifestPath: string, runner: GoRunner): Promise<void> {
  const result = await runner.run(['mod', 'tidy'], {
    cwd: dirname(manifestPath),
    env: goEnv(),
    timeoutMs: TIDY_TIMEOUT_MS,
  });

  if (result.exitCode !== 0) {
    throw new GoCommandError(
      failureKindFor(result.exitCode, result.stderr),
      `go mod tidy failed: ${firstLine(result.stderr)}`,
    );
  }
}
