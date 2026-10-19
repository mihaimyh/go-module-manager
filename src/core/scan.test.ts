import { describe, expect, it } from 'vitest';
import { assemblePanelModel, withAdvisories, type ProjectInput } from './model';
import { applyScan, hasReachable, markScan } from './scan';

const MANIFEST = '/repo/a/go.mod';

function model() {
  const project: ProjectInput = {
    manifestPath: MANIFEST,
    name: 'example.com/a',
    dependencies: [
      {
        manifestPath: MANIFEST,
        project: 'example.com/a',
        name: 'rsc.io/sampler',
        declaredVersion: 'v1.3.0',
        transitive: false,
      },
    ],
  };
  const declared = assemblePanelModel([project], new Map(), {});
  const resolved = {
    ...declared,
    rows: declared.rows.map((row) => ({ ...row, resolvedVersion: 'v1.3.0' })),
  };
  return withAdvisories(resolved, {
    matches: new Map([
      [
        'rsc.io/sampler@v1.3.0',
        [
          { id: 'GO-0000-00001', summary: 'sampler', fixedIn: 'v1.99.99' },
          { id: 'GO-0000-00009', summary: 'unrelated row advisory' },
        ],
      ],
    ]),
    unchecked: new Set<string>(),
    stale: false,
  });
}

describe('scan state', () => {
  it('marks a project running without touching findings', () => {
    const next = markScan(model(), MANIFEST, { status: 'running' });

    expect(next.projects[0]?.scan).toEqual({ status: 'running' });
    expect(next.rows[0]?.advisories[0]?.reachable).toBeUndefined();
    expect(hasReachable(next)).toBe(false);
  });

  it('upgrades only advisories that the lookup already returned', () => {
    const next = applyScan(
      model(),
      MANIFEST,
      [
        { id: 'GO-0000-00001', symbol: 'sampler.DefaultText', packagePath: 'rsc.io/sampler' },
        { id: 'GO-0000-00077', symbol: 'invented.Function' },
      ],
      '2026-10-09T00:00:00.000Z',
    );

    const advisories = next.rows[0]?.advisories ?? [];
    expect(advisories.find((a) => a.id === 'GO-0000-00001')).toMatchObject({
      reachable: true,
      symbol: 'sampler.DefaultText',
      packagePath: 'rsc.io/sampler',
    });
    expect(advisories.find((a) => a.id === 'GO-0000-00009')?.reachable).toBeUndefined();
    expect(advisories.some((a) => a.id === 'GO-0000-00077')).toBe(false);
    expect(next.projects[0]?.scan).toEqual({
      status: 'complete',
      at: '2026-10-09T00:00:00.000Z',
    });
    expect(hasReachable(next)).toBe(true);
  });

  it('records a failure without adding findings', () => {
    const next = markScan(model(), MANIFEST, {
      status: 'failed',
      at: '2026-10-09T00:00:00.000Z',
      message: 'build failed',
    });

    expect(next.projects[0]?.scan?.status).toBe('failed');
    expect(hasReachable(next)).toBe(false);
  });
});

describe('clearing previous results', () => {
  it('drops reachability when a rescan finds nothing', () => {
    const scanned = applyScan(
      model(),
      MANIFEST,
      [{ id: 'GO-0000-00001', symbol: 'sampler.DefaultText' }],
      '2026-10-09T00:00:00.000Z',
    );
    expect(hasReachable(scanned)).toBe(true);

    const rescanned = applyScan(scanned, MANIFEST, [], '2026-10-09T01:00:00.000Z');

    expect(hasReachable(rescanned)).toBe(false);
    expect(rescanned.rows[0]?.advisories[0]?.reachable).toBeUndefined();
    expect(rescanned.rows[0]?.advisories[0]?.symbol).toBeUndefined();
  });

  it('drops reachability when a rescan fails', () => {
    const scanned = applyScan(
      model(),
      MANIFEST,
      [{ id: 'GO-0000-00001', symbol: 'sampler.DefaultText' }],
      '2026-10-09T00:00:00.000Z',
    );

    const failed = markScan(scanned, MANIFEST, {
      status: 'failed',
      at: '2026-10-09T01:00:00.000Z',
      message: 'build failed',
    });

    expect(hasReachable(failed)).toBe(false);
    expect(failed.projects[0]?.scan?.message).toBe('build failed');
  });
});
