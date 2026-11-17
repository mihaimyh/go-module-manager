import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { failureKindFor, GoCommandError } from './errors';
import { firstLine, goEnv, type GoRunner } from './runner';

const VENDOR_TIMEOUT_MS = 180_000;

/** True when the project already opted into vendoring. */
export function isVendored(manifestPath: string): boolean {
  return existsSync(join(dirname(manifestPath), 'vendor', 'modules.txt'));
}

/**
 * Rewrites vendor/ to match go.mod. Never creates vendor/ unless modules.txt
 * already exists — callers must gate on `isVendored`.
 */
export async function vendorProject(
  manifestPath: string,
  runner: GoRunner,
): Promise<void> {
  if (!isVendored(manifestPath)) {
    throw new GoCommandError(
      'unknown',
      `${manifestPath}: no vendor/modules.txt; refusing to create a vendor tree`,
    );
  }

  const result = await runner.run(['mod', 'vendor'], {
    cwd: dirname(manifestPath),
    env: goEnv(),
    timeoutMs: VENDOR_TIMEOUT_MS,
  });

  if (result.exitCode !== 0) {
    throw new GoCommandError(
      failureKindFor(result.exitCode, result.stderr),
      `go mod vendor failed: ${firstLine(result.stderr)}`,
    );
  }
}
