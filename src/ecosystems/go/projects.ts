import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findManifestDirectories } from '../discovery';
import type { GoRunner } from './runner';

const WORK_TIMEOUT_MS = 60_000;

export interface GoWorkJson {
  readonly Use?: readonly { readonly DiskPath?: unknown }[];
}

/**
 * Project directories for one workspace folder.
 *
 * When a go.work is present, its `use` directories win (including nested modules
 * the tree walk would miss). Discovery never writes go.work; the command runs
 * without GOWORK=off so the toolchain can see the file. If that fails or
 * yields nothing, fall back to the ADR 0009 tree walk.
 */
export async function findProjectDirectories(
  workspaceRoot: string,
  runner: GoRunner,
): Promise<readonly string[]> {
  if (existsSync(join(workspaceRoot, 'go.work'))) {
    const fromWork = await directoriesFromGoWork(workspaceRoot, runner);
    if (fromWork.length > 0) {
      return fromWork;
    }
  }
  return findManifestDirectories(workspaceRoot, 'go.mod');
}

async function directoriesFromGoWork(
  workspaceRoot: string,
  runner: GoRunner,
): Promise<readonly string[]> {
  const result = await runner.run(['work', 'edit', '-json'], {
    cwd: workspaceRoot,
    // Must not force GOWORK=off: that hides the go.work we are reading.
    env: { ...process.env },
    timeoutMs: WORK_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(result.stdout) as GoWorkJson;
    return parseWorkUseDirectories(workspaceRoot, parsed).filter((directory) =>
      existsSync(join(directory, 'go.mod')),
    );
  } catch {
    return [];
  }
}

/** Pure: resolve Use DiskPath entries against the folder that holds go.work. */
export function parseWorkUseDirectories(
  workspaceRoot: string,
  work: GoWorkJson,
): readonly string[] {
  const directories = new Set<string>();
  for (const entry of work.Use ?? []) {
    if (typeof entry.DiskPath !== 'string' || entry.DiskPath === '') {
      continue;
    }
    directories.add(resolve(workspaceRoot, entry.DiskPath));
  }
  return [...directories].sort();
}
