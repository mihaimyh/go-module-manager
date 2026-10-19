import type { UpdateRequest } from './adapter';
import type { DependencyRow } from './model';

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
