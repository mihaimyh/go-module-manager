import { describe, expect, it } from 'vitest';
import { advisoryFixOffer, affectedRangeText } from './advisoryAction';

const advisory = (fixedIn?: string) => ({
  id: 'GO-0000-00001',
  summary: 'vulnerable function',
  ...(fixedIn === undefined ? {} : { fixedIn }),
});

describe('advisoryFixOffer', () => {
  it('offers a fix strictly above the resolved version', () => {
    expect(advisoryFixOffer(advisory('v1.5.2'), 'v1.5.1')).toEqual({
      offered: true,
      version: 'v1.5.2',
    });
  });

  it('explains a missing fixed version', () => {
    expect(advisoryFixOffer(advisory(), 'v1.5.1')).toEqual({
      offered: false,
      reason: 'No fixed version is published for this module.',
    });
  });

  it('refuses a downgrade or the resolved version', () => {
    expect(advisoryFixOffer(advisory('v1.5.0'), 'v1.5.1')).toEqual({
      offered: false,
      reason: 'The advisory data is out of date for the resolved version.',
    });
  });

  it('refuses a prerelease fix', () => {
    expect(advisoryFixOffer(advisory('v1.6.0-rc.1'), 'v1.5.1')).toEqual({
      offered: false,
      reason: 'The fix is only available as a prerelease.',
    });
  });

  it('refuses a fix on a different major path', () => {
    expect(advisoryFixOffer(advisory('v2.0.0'), 'v1.5.1')).toEqual({
      offered: false,
      reason: 'The fix is a different major module path.',
    });
  });

  it('refuses when either version is unknown', () => {
    expect(advisoryFixOffer(advisory('v1.5.2'), undefined)).toEqual({
      offered: false,
      reason: 'The resolved version is unknown.',
    });
    expect(advisoryFixOffer(advisory('go1.21.2'), 'v1.5.1')).toEqual({
      offered: false,
      reason: 'The fixed version cannot be compared.',
    });
  });
});

describe('affectedRangeText', () => {
  it('renders both bounds', () => {
    expect(
      affectedRangeText({
        id: 'GO-0000-00002',
        summary: 'only the 1.4 line',
        introduced: 'v1.4.0',
        fixedIn: 'v1.5.0',
      }),
    ).toBe('v1.4.0 ≤ version < v1.5.0');
  });

  it('renders an open lower bound', () => {
    expect(
      affectedRangeText({
        id: 'GO-0000-00001',
        summary: 'from the start',
        fixedIn: 'v1.99.99',
      }),
    ).toBe('version < v1.99.99');
  });
});
