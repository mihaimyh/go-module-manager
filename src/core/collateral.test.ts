import { describe, expect, it } from 'vitest';
import {
  diffManifestCollateral,
  formatDirectiveNotice,
} from './collateral';

describe('diffManifestCollateral', () => {
  it('reports go and toolchain directive bumps', () => {
    const diff = diffManifestCollateral(
      {
        directives: { go: '1.21', toolchain: 'go1.21.0' },
        requires: [{ name: 'rsc.io/quote', version: 'v1.5.1' }],
      },
      {
        directives: { go: '1.22', toolchain: 'go1.22.5' },
        requires: [{ name: 'rsc.io/quote', version: 'v1.5.2' }],
      },
      new Set(['rsc.io/quote']),
    );

    expect(diff.directives).toEqual([
      { field: 'go', from: '1.21', to: '1.22' },
      { field: 'toolchain', from: 'go1.21.0', to: 'go1.22.5' },
    ]);
    expect(diff.unselectedRequires).toEqual([]);
  });

  it('logs unselected require moves and ignores selected names', () => {
    const diff = diffManifestCollateral(
      {
        directives: {},
        requires: [
          { name: 'rsc.io/quote', version: 'v1.5.1' },
          { name: 'rsc.io/sampler', version: 'v1.3.0' },
          { name: 'example.com/old', version: 'v0.1.0' },
        ],
      },
      {
        directives: {},
        requires: [
          { name: 'rsc.io/quote', version: 'v1.5.2' },
          { name: 'rsc.io/sampler', version: 'v1.99.99' },
          { name: 'example.com/new', version: 'v0.2.0' },
        ],
      },
      new Set(['rsc.io/quote']),
    );

    expect(diff.unselectedRequires).toEqual([
      { name: 'example.com/new', kind: 'added', to: 'v0.2.0' },
      { name: 'example.com/old', kind: 'removed', from: 'v0.1.0' },
      {
        name: 'rsc.io/sampler',
        kind: 'raised',
        from: 'v1.3.0',
        to: 'v1.99.99',
      },
    ]);
  });
});

describe('formatDirectiveNotice', () => {
  it('joins directive changes for a toast body', () => {
    expect(
      formatDirectiveNotice([
        { field: 'go', from: '1.21', to: '1.22' },
        { field: 'toolchain', to: 'go1.22.5' },
      ]),
    ).toBe('go 1.21 → 1.22; toolchain set to go1.22.5');
  });
});
