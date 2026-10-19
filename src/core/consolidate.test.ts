import { describe, expect, it } from 'vitest';
import { divergentModulePaths } from './consolidate';
import type { DependencyRow } from './model';

function row(name: string, project: string, resolved: string | undefined): DependencyRow {
  return {
    id: `${project}#${name}`,
    name,
    project,
    manifestPath: `/repo/${project}/go.mod`,
    declaredVersion: resolved ?? 'v1.0.0',
    ...(resolved === undefined ? {} : { resolvedVersion: resolved }),
    transitive: false,
    kind: 'none',
    advisories: [],
  };
}

describe('divergentModulePaths', () => {
  it('names modules that resolve to different versions across projects', () => {
    const rows = [
      row('rsc.io/quote', 'example.com/a', 'v1.5.1'),
      row('rsc.io/quote', 'example.com/b', 'v1.5.2'),
      row('rsc.io/sampler', 'example.com/a', 'v1.3.0'),
      row('rsc.io/sampler', 'example.com/b', 'v1.3.0'),
    ];

    expect([...divergentModulePaths(rows)]).toEqual(['rsc.io/quote']);
  });

  it('ignores a module whose resolved version is still unknown', () => {
    const rows = [
      row('rsc.io/quote', 'example.com/a', 'v1.5.1'),
      row('rsc.io/quote', 'example.com/b', undefined),
    ];

    expect(divergentModulePaths(rows).size).toBe(0);
  });
});
