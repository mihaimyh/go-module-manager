import { dirname } from 'node:path';
import { failureKindFor, GoCommandError } from './errors';
import { firstLine, goEnv, type GoRunner } from './runner';

const WHY_TIMEOUT_MS = 60_000;

/** Why the owning module needs this path: `go mod why -m`. */
export async function whyModule(
  manifestPath: string,
  name: string,
  runner: GoRunner,
): Promise<string> {
  const result = await runner.run(['mod', 'why', '-m', name], {
    cwd: dirname(manifestPath),
    env: goEnv(),
    timeoutMs: WHY_TIMEOUT_MS,
  });

  if (result.exitCode !== 0) {
    throw new GoCommandError(
      failureKindFor(result.exitCode, result.stderr),
      firstLine(result.stderr),
    );
  }

  const text = result.stdout.trim();
  return text === '' ? firstLine(result.stderr) : text;
}
