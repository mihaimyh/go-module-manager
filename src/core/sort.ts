import type { DependencyRow } from './model';
import type { UpdateKind } from './version';
import { compareVersions } from './version';

export type SortKey = 'module' | 'owning' | 'required' | 'selected' | 'update' | 'kind';
export type SortDirection = 'asc' | 'desc';

export interface SortState {
  readonly key: SortKey;
  readonly direction: SortDirection;
}

const KIND_RANK: Record<UpdateKind, number> = {
  none: 0,
  patch: 1,
  release: 1,
  prerelease: 2,
  minor: 3,
  major: 4,
};

/**
 * Sorts rows for display. Missing versions always go last in the natural
 * direction; a descending sort reverses the present values, not the absences.
 */
export function sortRows(
  rows: readonly DependencyRow[],
  state: SortState,
): DependencyRow[] {
  const direction = state.direction === 'asc' ? 1 : -1;
  const present = rows.filter((row) => !missing(row, state.key));
  const absent = rows.filter((row) => missing(row, state.key));

  present.sort((left, right) => {
    const compared = compare(left, right, state.key);
    return compared !== 0 ? compared * direction : left.name.localeCompare(right.name) * direction;
  });
  // Rows without a version stay at the bottom in both directions.
  absent.sort((left, right) => left.name.localeCompare(right.name));

  return [...present, ...absent];
}

function missing(row: DependencyRow, key: SortKey): boolean {
  if (key === 'selected') {
    return row.resolvedVersion === undefined;
  }
  if (key === 'update') {
    return row.candidate === undefined;
  }
  return false;
}

function compare(left: DependencyRow, right: DependencyRow, key: SortKey): number {
  switch (key) {
    case 'module':
      return left.name.localeCompare(right.name);
    case 'owning':
      return left.project.localeCompare(right.project);
    case 'required':
      return compareVersion(left.declaredVersion, right.declaredVersion);
    case 'selected':
      return compareVersion(left.resolvedVersion, right.resolvedVersion);
    case 'update':
      return compareVersion(left.candidate, right.candidate);
    case 'kind':
      return KIND_RANK[left.kind] - KIND_RANK[right.kind];
  }
}

function compareVersion(left: string | undefined, right: string | undefined): number {
  if (left === undefined || right === undefined) {
    return 0;
  }
  return compareVersions(left, right);
}
