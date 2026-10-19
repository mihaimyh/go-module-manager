import { describe, expect, it } from 'vitest';
import { planBulkUpdate } from './bulk';
import type { DependencyRow } from './model';

function row(
  manifestPath: string,
  name: string,
  candidate: string | undefined,
): DependencyRow {
  return {
    id: `${manifestPath}#${name}`,
    name,
    project: 'example.com/a',
    manifestPath,
    declaredVersion: 'v1.0.0',
    resolvedVersion: 'v1.0.0',
    transitive: false,
    ...(candidate === undefined ? {} : { candidate }),
    kind: candidate === undefined ? 'none' : 'patch',
    advisories: [],
  };
}

describe('planBulkUpdate', () => {
  it('groups the selection by owning manifest', () => {
    const groups = planBulkUpdate([
      row('/repo/a/go.mod', 'rsc.io/quote', 'v1.5.2'),
      row('/repo/b/go.mod', 'rsc.io/sampler', 'v1.99.99'),
      row('/repo/a/go.mod', 'rsc.io/sampler', 'v1.99.99'),
    ]);

    expect(groups).toEqual([
      {
        manifestPath: '/repo/a/go.mod',
        changes: [
          { name: 'rsc.io/quote', version: 'v1.5.2' },
          { name: 'rsc.io/sampler', version: 'v1.99.99' },
        ],
      },
      {
        manifestPath: '/repo/b/go.mod',
        changes: [{ name: 'rsc.io/sampler', version: 'v1.99.99' }],
      },
    ]);
  });

  it('drops rows without a candidate', () => {
    expect(
      planBulkUpdate([row('/repo/a/go.mod', 'rsc.io/quote', undefined)]),
    ).toEqual([]);
  });
});
