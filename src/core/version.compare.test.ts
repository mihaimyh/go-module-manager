import { describe, expect, it } from 'vitest';
import { compareVersions } from './version';

describe('compareVersions', () => {
  it('orders by major, minor and patch', () => {
    expect(compareVersions('v1.5.2', 'v1.5.2')).toBe(0);
    expect(compareVersions('v1.5.2', 'v1.5.3')).toBeLessThan(0);
    expect(compareVersions('v1.6.0', 'v1.5.9')).toBeGreaterThan(0);
    expect(compareVersions('v2.0.0', 'v1.99.99')).toBeGreaterThan(0);
  });

  it('ranks a release above its prereleases', () => {
    expect(compareVersions('v2.0.0', 'v2.0.0-rc.1')).toBeGreaterThan(0);
    expect(compareVersions('v2.0.0-rc.1', 'v2.0.0')).toBeLessThan(0);
  });

  it('orders prerelease identifiers by SemVer rules', () => {
    expect(compareVersions('v2.0.0-alpha', 'v2.0.0-alpha.1')).toBeLessThan(0);
    expect(compareVersions('v2.0.0-alpha.1', 'v2.0.0-alpha.beta')).toBeLessThan(0);
    expect(compareVersions('v2.0.0-beta.2', 'v2.0.0-beta.11')).toBeLessThan(0);
    expect(compareVersions('v2.0.0-rc.1', 'v2.0.0-beta.11')).toBeGreaterThan(0);
  });

  it('orders pseudo-versions below the release they precede', () => {
    expect(
      compareVersions('v0.0.0-20170915032832-14c0d48ead0c', 'v0.43.0'),
    ).toBeLessThan(0);
  });

  it('treats unparseable versions as equal', () => {
    expect(compareVersions('latest', 'v1.0.0')).toBe(0);
  });
});
