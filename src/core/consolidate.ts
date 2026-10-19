import type { DependencyRow } from './model';

/** One module path that resolves to more than one version, with its rows. */
export interface DivergenceGroup {
  readonly name: string;
  readonly rows: readonly DependencyRow[];
}

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

/** Divergent rows, grouped by module path, projects sorted by name. */
export function groupedDivergence(rows: readonly DependencyRow[]): DivergenceGroup[] {
  const paths = divergentModulePaths(rows);
  const byName = new Map<string, DependencyRow[]>();
  for (const row of rows) {
    if (!paths.has(row.name)) {
      continue;
    }
    const group = byName.get(row.name) ?? [];
    group.push(row);
    byName.set(row.name, group);
  }

  return [...byName.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, group]) => ({
      name,
      rows: [...group].sort((left, right) => left.project.localeCompare(right.project)),
    }));
}
