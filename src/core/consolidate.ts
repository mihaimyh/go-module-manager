import type { DependencyRow } from './model';

/** Module paths that resolve to more than one version across projects. */
export function divergentModulePaths(
  rows: readonly DependencyRow[],
): ReadonlySet<string> {
  const versions = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.resolvedVersion === undefined) {
      continue;
    }
    const seen = versions.get(row.name) ?? new Set<string>();
    seen.add(row.resolvedVersion);
    versions.set(row.name, seen);
  }

  return new Set(
    [...versions.entries()]
      .filter(([, resolved]) => resolved.size > 1)
      .map(([name]) => name),
  );
}
