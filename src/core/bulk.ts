import type { UpdateRequest } from './adapter';
import type { DependencyRow, FailureKind } from './model';

const RETRYABLE: ReadonlySet<FailureKind> = new Set([
  'verification',
  'unknown',
  'missing-lock-entry',
]);

/**
 * Isolate one broken module in a group, but not when the toolchain itself
 * cannot run (missing binary, offline, timeout, auth).
 */
export function shouldRetryFailedGroup(
  changeCount: number,
  kind: FailureKind,
): boolean {
  return changeCount > 1 && RETRYABLE.has(kind);
}

/**
 * Groups the selected rows by owning manifest and targets each one's candidate.
 * Rows with no candidate have nothing to move to and are dropped.
 */
export function planBulkUpdate(rows: readonly DependencyRow[]): readonly UpdateRequest[] {
  const byManifest = new Map<string, { name: string; version: string }[]>();

  for (const row of rows) {
    if (row.candidate === undefined) {
      continue;
    }
    const changes = byManifest.get(row.manifestPath) ?? [];
    changes.push({ name: row.name, version: row.candidate });
    byManifest.set(row.manifestPath, changes);
  }

  return [...byManifest.entries()]
    .map(([manifestPath, changes]) => ({
      manifestPath,
      changes: changes.sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => left.manifestPath.localeCompare(right.manifestPath));
}

export interface TargetChange {
  readonly manifestPath: string;
  readonly name: string;
  readonly version: string;
}

/**
 * Groups explicit per-project changes (Add, Update, Consolidate, Remove) by
 * owning manifest so each project runs a single `go get`.
 */
/**
 * Tidy deletes unimported new requires, so a project that just gained a module
 * is not tidy-eligible until the user imports it.
 */
export function tidyEligibleManifests(
  succeededManifests: readonly string[],
  written: readonly { readonly manifestPath: string; readonly name: string }[],
  declaredBefore: readonly { readonly manifestPath: string; readonly name: string }[],
): readonly string[] {
  const declared = new Set(
    declaredBefore.map((entry) => `${entry.manifestPath}#${entry.name}`),
  );
  return [...new Set(succeededManifests)].filter((manifestPath) => {
    const names = written
      .filter((entry) => entry.manifestPath === manifestPath)
      .map((entry) => entry.name);
    if (names.length === 0) {
      return true;
    }
    return names.every((name) => declared.has(`${manifestPath}#${name}`));
  });
}

export function planTargetChanges(
  targets: readonly TargetChange[],
): readonly UpdateRequest[] {
  const byManifest = new Map<string, { name: string; version: string }[]>();
  const seen = new Set<string>();

  for (const target of targets) {
    if (
      target.manifestPath.trim() === '' ||
      target.name.trim() === '' ||
      target.version.trim() === ''
    ) {
      continue;
    }
    const key = `${target.manifestPath}#${target.name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const changes = byManifest.get(target.manifestPath) ?? [];
    changes.push({ name: target.name, version: target.version });
    byManifest.set(target.manifestPath, changes);
  }

  return [...byManifest.entries()]
    .map(([manifestPath, changes]) => ({
      manifestPath,
      changes: changes.sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => left.manifestPath.localeCompare(right.manifestPath));
}

