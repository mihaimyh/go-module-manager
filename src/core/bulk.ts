import type { DependencyRow } from './model';

export interface PlannedChange {
  readonly name: string;
  readonly version: string;
}

export interface UpdateGroup {
  readonly manifestPath: string;
  readonly changes: readonly PlannedChange[];
}

/**
 * Groups the selected rows by owning manifest and targets each one's candidate.
 * Rows with no candidate have nothing to move to and are dropped.
 */
export function planBulkUpdate(rows: readonly DependencyRow[]): readonly UpdateGroup[] {
  const byManifest = new Map<string, PlannedChange[]>();

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
