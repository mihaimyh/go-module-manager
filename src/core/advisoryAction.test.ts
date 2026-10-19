import { describe, expect, it } from 'vitest';
import { advisoryFix } from './advisoryAction';

const advisory = (fixedIn?: string) => ({
  id: 'GO-0000-00001',
  summary: 'vulnerable function',
  ...(fixedIn === undefined ? {} : { fixedIn }),
});

describe('advisoryFix', () => {
  it('offers a fix strictly above the resolved version', () => {
    expect(advisoryFix(advisory('v1.5.2'), 'v1.5.1')).toEqual({
      offered: true,
      version: 'v1.5.2',
    });
  });

  it('explains a missing fixed version', () => {
    expect(advisoryFix(advisory(), 'v1.5.1')).toEqual({
      offered: false,
      reason: 'No fixed version is published for this module.',
    });
  });

  it('refuses to offer the resolved version or a downgrade', () => {
    expect(advisoryFix(advisory('v1.5.1'), 'v1.5.1')).toEqual({
      offered: false,
      reason: 'The resolved version is already at or above the fix.',
    });
    expect(advisoryFix(advisory('v1.5.0'), 'v1.5.1')).toEqual({
      offered: false,
      reason: 'The resolved version is already at or above the fix.',
    });
  });

  it('refuses when either version is unknown', () => {
    expect(advisoryFix(advisory('v1.5.2'), undefined)).toEqual({
      offered: false,
      reason: 'The resolved version is unknown.',
    });
    expect(advisoryFix(advisory('go1.21.2'), 'v1.5.1')).toEqual({
      offered: false,
      reason: 'The fixed version cannot be compared.',
    });
  });
});
