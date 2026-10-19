import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { UpdateOutcome, UpdateRequest } from '../../core/adapter';
import { firstLine, goEnv, type GoRunner } from './runner';

const UPDATE_TIMEOUT_MS = 120_000;

interface Snapshot {
  readonly goMod: string;
  /** Absent when the project had no go.sum before the update. */
  readonly goSum?: string;
}

export interface GoUpdater {
  update(request: UpdateRequest): Promise<UpdateOutcome>;
  undo(manifestPath: string): Promise<boolean>;
}

/**
 * Runs `go get` in the owning project and keeps exactly one snapshot per
 * project, taken before that write. Undo is in-memory and session-only.
 */
export function createUpdater(runner: GoRunner): GoUpdater {
  const snapshots = new Map<string, Snapshot>();

  return {
    async update(request) {
      snapshots.set(request.manifestPath, snapshotOf(request.manifestPath));

      const result = await runner.run(
        ['get', `${request.name}@${request.version}`],
        {
          cwd: dirname(request.manifestPath),
          env: goEnv(),
          timeoutMs: UPDATE_TIMEOUT_MS,
        },
      );

      if (result.exitCode !== 0) {
        snapshots.delete(request.manifestPath);
        return {
          ...request,
          status: 'failed',
          message: firstLine(result.stderr),
        };
      }

      return { ...request, status: 'updated' };
    },

    async undo(manifestPath) {
      const snapshot = snapshots.get(manifestPath);
      if (snapshot === undefined) {
        return false;
      }
      restore(manifestPath, snapshot);
      snapshots.delete(manifestPath);
      return true;
    },
  };
}

function snapshotOf(manifestPath: string): Snapshot {
  const goMod = readFileSync(manifestPath, 'utf8');
  const sumPath = sumPathOf(manifestPath);
  return existsSync(sumPath) ? { goMod, goSum: readFileSync(sumPath, 'utf8') } : { goMod };
}

function restore(manifestPath: string, snapshot: Snapshot): void {
  writeFileSync(manifestPath, snapshot.goMod);

  const sumPath = sumPathOf(manifestPath);
  if (snapshot.goSum === undefined) {
    rmSync(sumPath, { force: true });
  } else {
    writeFileSync(sumPath, snapshot.goSum);
  }
}

function sumPathOf(manifestPath: string): string {
  return join(dirname(manifestPath), 'go.sum');
}
