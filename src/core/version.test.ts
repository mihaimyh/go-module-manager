import { describe, expect, it } from 'vitest';
import {
  classifyUpdate,
  isPrerelease,
  isPseudoVersion,
  parseVersion,
  splitModulePath,
} from './version';

describe('parseVersion', () => {
  it('reads a release', () => {
    expect(parseVersion('v1.5.2')).toEqual({
      major: 1,
      minor: 5,
      patch: 2,
      prerelease: '',
    });
  });

  it('reads a prerelease suffix', () => {
    expect(parseVersion('v2.0.0-rc.1')?.prerelease).toBe('rc.1');
  });

  it('reads a version without the leading v', () => {
    expect(parseVersion('0.43.0')?.minor).toBe(43);
  });

  it('rejects a version that is not SemVer', () => {
    expect(parseVersion('latest')).toBeUndefined();
    expect(parseVersion('v1.5')).toBeUndefined();
  });
});

describe('isPseudoVersion', () => {
  it.each([
    'v0.0.0-20170915032832-14c0d48ead0c',
    'v1.2.3-0.20240101120000-abcdef123456',
  ])('recognises %s', (version) => {
    expect(isPseudoVersion(version)).toBe(true);
  });

  it('does not treat a release as a pseudo-version', () => {
    expect(isPseudoVersion('v1.5.2')).toBe(false);
  });

  it('does not treat a prerelease as a pseudo-version', () => {
    expect(isPseudoVersion('v2.0.0-rc.1')).toBe(false);
  });
});

describe('isPrerelease', () => {
  it('flags rc versions', () => {
    expect(isPrerelease('v2.0.0-rc.1')).toBe(true);
  });

  it('does not flag stable or pseudo versions', () => {
    expect(isPrerelease('v1.5.2')).toBe(false);
    expect(isPrerelease('v0.0.0-20170915032832-14c0d48ead0c')).toBe(false);
  });
});

describe('classifyUpdate', () => {
  it('returns none for identical versions', () => {
    expect(classifyUpdate('v1.5.2', 'v1.5.2')).toBe('none');
  });

  it('separates patch, minor and major moves', () => {
    expect(classifyUpdate('v1.5.1', 'v1.5.2')).toBe('patch');
    expect(classifyUpdate('v1.3.0', 'v1.99.99')).toBe('minor');
    expect(classifyUpdate('v1.5.2', 'v2.0.0')).toBe('major');
  });

  it('marks a prerelease target', () => {
    expect(classifyUpdate('v1.5.2', 'v2.0.0-rc.1')).toBe('prerelease');
  });

  it('marks leaving a pseudo-version for a release', () => {
    expect(classifyUpdate('v0.0.0-20170915032832-14c0d48ead0c', 'v0.43.0')).toBe(
      'release',
    );
  });
});

describe('splitModulePath', () => {
  it('strips a major suffix from v2 onwards', () => {
    expect(splitModulePath('github.com/gin-gonic/gin/v2')).toEqual({
      base: 'github.com/gin-gonic/gin',
      major: 2,
    });
  });

  it('keeps a path segment that only looks like a version', () => {
    expect(splitModulePath('example.com/thing/v1')).toEqual({
      base: 'example.com/thing/v1',
      major: 1,
    });
    expect(splitModulePath('example.com/v2thing')).toEqual({
      base: 'example.com/v2thing',
      major: 1,
    });
  });

  it('handles the gopkg.in dot form', () => {
    expect(splitModulePath('gopkg.in/yaml.v3')).toEqual({
      base: 'gopkg.in/yaml',
      major: 3,
    });
  });
});
