import { describe, expect, it } from 'vitest';
import {
  classifyUpdate,
  commitPinUpdateNote,
  isPrerelease,
  isPseudoVersion,
  parseVersion,
  pickerVersions,
  removeSafety,
  versionApplyOffer,
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

describe('isPrerelease', () => {
  it('flags rc versions', () => {
    expect(isPrerelease('v2.0.0-rc.1')).toBe(true);
  });

  it('does not flag stable versions', () => {
    expect(isPrerelease('v1.5.2')).toBe(false);
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
});

describe('versionApplyOffer', () => {
  it('allows an upgrade on the same path', () => {
    expect(versionApplyOffer('v1.5.1', 'v1.5.2')).toEqual({ allowed: true });
  });

  it('refuses the already-resolved version', () => {
    expect(versionApplyOffer('v1.5.2', 'v1.5.2')).toEqual({
      allowed: false,
      reason: 'Already resolved at this version',
    });
  });

  it('refuses a downgrade until a preview is accepted', () => {
    expect(versionApplyOffer('v1.5.2', 'v1.5.1')).toEqual({
      allowed: false,
      reason: 'Preview the impact before downgrading.',
    });
    expect(
      versionApplyOffer('v1.5.2', 'v1.5.1', { allowDowngrade: true }),
    ).toEqual({ allowed: true });
  });

  it('hides a prerelease until asked', () => {
    expect(versionApplyOffer('v1.5.1', 'v1.6.0-rc.1')).toEqual({
      allowed: false,
      reason: 'Prereleases are hidden until you ask to show them.',
    });
    expect(
      versionApplyOffer('v1.5.1', 'v1.6.0-rc.1', { includePrereleases: true }),
    ).toEqual({ allowed: true });
  });
});

describe('pickerVersions', () => {
  it('drops prereleases unless asked', () => {
    const versions = ['v1.2.0', 'v1.3.0-rc.1', 'v1.1.0'];
    expect(pickerVersions(versions)).toEqual(['v1.2.0', 'v1.1.0']);
    expect(pickerVersions(versions, { includePrereleases: true })).toEqual([
      'v1.2.0',
      'v1.3.0-rc.1',
      'v1.1.0',
    ]);
  });
});

describe('isPseudoVersion', () => {
  it('recognises the three go shapes', () => {
    expect(isPseudoVersion('v0.0.0-20170915032832-14c0d48ead0c')).toBe(true);
    expect(isPseudoVersion('v1.2.3-0.20240101120000-abcdef123456')).toBe(true);
  });

  it('does not treat a release or prerelease as a pseudo-version', () => {
    expect(isPseudoVersion('v1.5.2')).toBe(false);
    expect(isPseudoVersion('v2.0.0-rc.1')).toBe(false);
  });
});

describe('commitPinUpdateNote', () => {
  const pseudo = 'v0.0.0-20170915032832-14c0d48ead0c';

  it('explains a commit pin with no candidate', () => {
    expect(
      commitPinUpdateNote({
        resolvedVersion: pseudo,
        declaredVersion: pseudo,
      }),
    ).toBe('No tagged release newer than this commit.');
  });

  it('uses the declared version when nothing is resolved yet', () => {
    expect(
      commitPinUpdateNote({ declaredVersion: pseudo }),
    ).toBe('No tagged release newer than this commit.');
  });

  it('stays silent when a candidate exists or the row is replaced', () => {
    expect(
      commitPinUpdateNote({
        resolvedVersion: pseudo,
        declaredVersion: pseudo,
        candidate: 'v1.0.0',
      }),
    ).toBeUndefined();
    expect(
      commitPinUpdateNote({
        resolvedVersion: pseudo,
        declaredVersion: pseudo,
        replaced: true,
      }),
    ).toBeUndefined();
  });

  it('stays silent for a tagged pin', () => {
    expect(
      commitPinUpdateNote({
        resolvedVersion: 'v1.5.2',
        declaredVersion: 'v1.5.2',
      }),
    ).toBeUndefined();
  });
});

describe('removeSafety', () => {
  it('allows immediate removal when go mod why reports unused and preview has no collateral changes', () => {
    expect(
      removeSafety({
        moduleName: 'github.com/spf13/cobra',
        whyText: '# github.com/spf13/cobra\n(main module does not need module github.com/spf13/cobra)',
        previewImpact: [
          { name: 'github.com/spf13/cobra', kind: 'removed', from: 'v1.10.2' },
        ],
      }),
    ).toEqual({
      needsConfirm: false,
      importedByCode: false,
      collateral: [],
    });
  });

  it('requires confirmation when go mod why shows active imports or MVS drops dependents', () => {
    expect(
      removeSafety({
        moduleName: 'rsc.io/sampler',
        whyText: '# rsc.io/sampler\nexample.com/a\nrsc.io/quote\nrsc.io/sampler',
        previewImpact: [
          { name: 'rsc.io/quote', kind: 'removed', from: 'v1.5.2' },
          { name: 'rsc.io/sampler', kind: 'removed', from: 'v1.3.0' },
        ],
      }),
    ).toEqual({
      needsConfirm: true,
      importedByCode: true,
      collateral: [{ name: 'rsc.io/quote', kind: 'removed', from: 'v1.5.2' }],
    });
  });
});

