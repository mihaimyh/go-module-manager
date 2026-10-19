import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectAdapters } from '../index';
import { readRecordedWorkspace } from './fixture';
import { isPseudoVersion } from './version';

const fixtureRoot = fileURLToPath(new URL('../../../test/fixtures/workspace', import.meta.url));

describe('the fixture workspace', () => {
  it('has two projects', () => {
    const model = readRecordedWorkspace(fixtureRoot);
    expect(model.projects.map((project) => project.name)).toEqual([
      'example.com/a',
      'example.com/b',
    ]);
  });

  it('produces one row per declared dependency, not per name', () => {
    const model = readRecordedWorkspace(fixtureRoot);
    expect(model.rows).toHaveLength(6);
    expect(model.rows.filter((row) => row.name === 'rsc.io/quote')).toHaveLength(2);
  });
});

describe('version columns', () => {
  it('reports the declared version when the resolver agrees', () => {
    const model = readRecordedWorkspace(fixtureRoot);
    const row = model.rows.find(
      (candidate) => candidate.name === 'rsc.io/quote' && candidate.project === 'example.com/a',
    );

    expect(row?.declaredVersion).toBe('v1.5.1');
    expect(row?.resolvedVersion).toBe('v1.5.1');
  });

  it('offers the patch candidate recorded by the toolchain', () => {
    const model = readRecordedWorkspace(fixtureRoot);
    const row = model.rows.find(
      (candidate) => candidate.name === 'rsc.io/quote' && candidate.project === 'example.com/a',
    );

    expect(row?.candidate).toBe('v1.5.2');
    expect(row?.kind).toBe('patch');
  });

  it('leaves the up-to-date dependency without a candidate', () => {
    const model = readRecordedWorkspace(fixtureRoot);
    const row = model.rows.find(
      (candidate) => candidate.name === 'rsc.io/quote' && candidate.project === 'example.com/b',
    );

    expect(row?.resolvedVersion).toBe('v1.5.2');
    expect(row?.candidate).toBeUndefined();
    expect(row?.kind).toBe('none');
  });

  it('classifies leaving a pseudo-version as a release move', () => {
    const model = readRecordedWorkspace(fixtureRoot);
    const row = model.rows.find((candidate) => candidate.name === 'golang.org/x/text');

    expect(row?.resolvedVersion).toBeDefined();
    expect(isPseudoVersion(row?.resolvedVersion ?? '')).toBe(true);
    expect(row?.kind).toBe('release');
  });

  it('marks transitive requirements', () => {
    const model = readRecordedWorkspace(fixtureRoot);
    const direct = model.rows.find((row) => row.name === 'rsc.io/quote');
    const transitive = model.rows.find((row) => row.name === 'rsc.io/sampler');

    expect(direct?.transitive).toBe(false);
    expect(transitive?.transitive).toBe(true);
  });
});

describe('advisories', () => {
  it('attaches recorded advisories by dependency name, in every project', () => {
    const model = readRecordedWorkspace(fixtureRoot);
    const samplerRows = model.rows.filter((row) => row.name === 'rsc.io/sampler');

    expect(samplerRows).toHaveLength(2);
    expect(samplerRows.every((row) => row.advisories.length === 1)).toBe(true);

    const ids = new Set(samplerRows.flatMap((row) => row.advisories.map((a) => a.id)));
    expect([...ids]).toEqual(['GO-0000-00001']);
  });
});

describe('adapter detection', () => {
  it('finds the Go adapter through a nested go.mod', () => {
    expect(detectAdapters(fixtureRoot).map((adapter) => adapter.id)).toEqual(['go']);
  });
});
