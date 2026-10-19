import { describe, expect, it } from 'vitest';
import { planBulkUpdate, shouldRetryFailedGroup } from './bulk';
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

describe('shouldRetryFailedGroup', () => {
  it('retries a multi-module group after one module fails verification', () => {
    expect(shouldRetryFailedGroup(3, 'verification')).toBe(true);
    expect(shouldRetryFailedGroup(2, 'unknown')).toBe(true);
    expect(shouldRetryFailedGroup(2, 'missing-lock-entry')).toBe(true);
  });

  it('does not retry when the toolchain itself is broken', () => {
    expect(shouldRetryFailedGroup(3, 'toolchain-missing')).toBe(false);
    expect(shouldRetryFailedGroup(3, 'network')).toBe(false);
    expect(shouldRetryFailedGroup(3, 'timeout')).toBe(false);
    expect(shouldRetryFailedGroup(3, 'auth-required')).toBe(false);
  });

  it('does not retry a group of one', () => {
    expect(shouldRetryFailedGroup(1, 'verification')).toBe(false);
  });
});
