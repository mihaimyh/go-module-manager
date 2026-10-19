import { describe, expect, it } from 'vitest';
import type { DependencyRow } from './model';
import { sortRows } from './sort';

function row(
  name: string,
  declared: string,
  resolved: string | undefined,
  candidate: string | undefined,
  kind: DependencyRow['kind'],
): DependencyRow {
  return {
    id: `m#${name}`,
    name,
    project: 'example.com/a',
    manifestPath: 'm',
    declaredVersion: declared,
    ...(resolved === undefined ? {} : { resolvedVersion: resolved }),
    transitive: false,
    ...(candidate === undefined ? {} : { candidate }),
    kind,
    advisories: [],
  };
}

const rows = [
  row('z/lib', 'v1.10.0', 'v1.10.0', 'v2.0.0', 'major'),
  row('a/lib', 'v1.2.0', 'v1.2.0', 'v1.2.3', 'patch'),
  row('m/lib', 'v1.0.0', 'v1.0.0', 'v1.5.0', 'minor'),
  row('b/lib', 'v1.0.0', undefined, undefined, 'none'),
];

describe('sortRows', () => {
  it('sorts by module name', () => {
    expect(sortRows(rows, { key: 'module', direction: 'asc' }).map((r) => r.name)).toEqual([
      'a/lib',
      'b/lib',
      'm/lib',
      'z/lib',
    ]);
  });

  it('sorts versions numerically, not lexically', () => {
    expect(
      sortRows(rows, { key: 'update', direction: 'desc' }).map((r) => r.candidate),
    ).toEqual(['v2.0.0', 'v1.5.0', 'v1.2.3', undefined]);
  });

  it('sorts by update kind severity', () => {
    expect(sortRows(rows, { key: 'kind', direction: 'desc' }).map((r) => r.kind)).toEqual([
      'major',
      'minor',
      'patch',
      'none',
    ]);
  });

  it('reverses on descending', () => {
    expect(sortRows(rows, { key: 'module', direction: 'desc' }).map((r) => r.name)).toEqual([
      'z/lib',
      'm/lib',
      'b/lib',
      'a/lib',
    ]);
  });

  it('sorts declared and resolved versions numerically', () => {
    expect(
      sortRows(rows, { key: 'declared', direction: 'desc' }).map((r) => r.declaredVersion),
    ).toEqual(['v1.10.0', 'v1.2.0', 'v1.0.0', 'v1.0.0']);
  });
});
