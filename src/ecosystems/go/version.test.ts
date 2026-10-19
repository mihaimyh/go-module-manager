import { describe, expect, it } from 'vitest';
import { classifyGoUpdate, isPseudoVersion, splitModulePath } from './version';

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

describe('classifyGoUpdate', () => {
  it('marks leaving a pseudo-version for a release', () => {
    expect(
      classifyGoUpdate('v0.0.0-20170915032832-14c0d48ead0c', 'v0.43.0'),
    ).toBe('release');
  });

  it('does not call a commit move a release', () => {
    expect(
      classifyGoUpdate(
        'v0.0.0-20170915032832-14c0d48ead0c',
        'v0.0.0-20200101000000-abcdef123456',
      ),
    ).toBe('none');
  });

  it('falls back to the generic classifier', () => {
    expect(classifyGoUpdate('v1.5.1', 'v1.5.2')).toBe('patch');
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
