import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadFixtureWorkspace } from './fixtures';
import { isPseudoVersion } from './version';

const fixtureRoot = fileURLToPath(new URL('../../test/fixtures/workspace', import.meta.url));

describe('the fixture workspace', () => {
  it('has two modules', () => {
    const model = loadFixtureWorkspace(fixtureRoot);
    expect(model.modules.map((module) => module.path)).toEqual([
      'example.com/a',
      'example.com/b',
    ]);
  });

  it('produces one row per requirement, not per module path', () => {
    const model = loadFixtureWorkspace(fixtureRoot);
    expect(model.rows).toHaveLength(6);
    expect(model.rows.filter((row) => row.path === 'rsc.io/quote')).toHaveLength(2);
  });
});

describe('version columns', () => {
  it('reports the required version when nothing else raises it', () => {
    const model = loadFixtureWorkspace(fixtureRoot);
    const row = model.rows.find(
      (candidate) =>
        candidate.path === 'rsc.io/quote' && candidate.owningModule === 'example.com/a',
    );

    expect(row?.requiredVersion).toBe('v1.5.1');
    expect(row?.selectedVersion).toBe('v1.5.1');
  });

  it('offers the patch candidate recorded by the toolchain', () => {
    const model = loadFixtureWorkspace(fixtureRoot);
    const row = model.rows.find(
      (candidate) =>
        candidate.path === 'rsc.io/quote' && candidate.owningModule === 'example.com/a',
    );

    expect(row?.candidate).toBe('v1.5.2');
    expect(row?.kind).toBe('patch');
  });

  it('leaves the up-to-date module without a candidate', () => {
    const model = loadFixtureWorkspace(fixtureRoot);
    const row = model.rows.find(
      (candidate) =>
        candidate.path === 'rsc.io/quote' && candidate.owningModule === 'example.com/b',
    );

    expect(row?.selectedVersion).toBe('v1.5.2');
    expect(row?.candidate).toBeUndefined();
    expect(row?.kind).toBe('none');
  });

  it('classifies leaving a pseudo-version as a release move', () => {
    const model = loadFixtureWorkspace(fixtureRoot);
    const row = model.rows.find((candidate) => candidate.path === 'golang.org/x/text');

    expect(row?.selectedVersion).toBeDefined();
    expect(isPseudoVersion(row?.selectedVersion ?? '')).toBe(true);
    expect(row?.kind).toBe('release');
  });

  it('marks indirect requirements', () => {
    const model = loadFixtureWorkspace(fixtureRoot);
    const direct = model.rows.find((row) => row.path === 'rsc.io/quote');
    const indirect = model.rows.find((row) => row.path === 'rsc.io/sampler');

    expect(direct?.indirect).toBe(false);
    expect(indirect?.indirect).toBe(true);
  });

  it('attaches recorded advisories by module path, in every owning module', () => {
    const model = loadFixtureWorkspace(fixtureRoot);
    const samplerRows = model.rows.filter((row) => row.path === 'rsc.io/sampler');

    expect(samplerRows).toHaveLength(2);
    expect(samplerRows.every((row) => row.advisories.length === 1)).toBe(true);

    const ids = new Set(samplerRows.flatMap((row) => row.advisories.map((a) => a.id)));
    expect([...ids]).toEqual(['GO-0000-00001']);
  });
});
