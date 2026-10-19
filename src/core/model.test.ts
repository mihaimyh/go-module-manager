import { describe, expect, it } from 'vitest';
import {
  assemblePanelModel,
  type Advisory,
  type DependencyInput,
  type ProjectInput,
  type ResolvedDependency,
} from './model';

const MANIFEST = '/repo/a/go.mod';

function project(
  requires: readonly { name: string; version: string; transitive?: boolean }[],
): readonly ProjectInput[] {
  const dependencies: DependencyInput[] = requires.map((require) => ({
    manifestPath: MANIFEST,
    project: 'example.com/a',
    name: require.name,
    declaredVersion: require.version,
    transitive: require.transitive === true,
  }));
  return [{ manifestPath: MANIFEST, name: 'example.com/a', dependencies }];
}

function resolved(entries: readonly ResolvedDependency[]): Map<string, readonly ResolvedDependency[]> {
  return new Map([[MANIFEST, entries]]);
}

describe('assemblePanelModel', () => {
  it('falls back to the declared version when nothing resolved it', () => {
    const model = assemblePanelModel(project([{ name: 'rsc.io/quote', version: 'v1.5.1' }]), new Map());

    expect(model.rows[0]?.declaredVersion).toBe('v1.5.1');
    expect(model.rows[0]?.resolvedVersion).toBe('v1.5.1');
    expect(model.rows[0]?.candidate).toBeUndefined();
    expect(model.rows[0]?.kind).toBe('none');
  });

  it('prefers the resolved version and keeps the candidate kind from the adapter', () => {
    const model = assemblePanelModel(
      project([{ name: 'rsc.io/quote', version: 'v1.5.1' }]),
      resolved([{ name: 'rsc.io/quote', version: 'v1.5.2', candidate: 'v1.6.0', kind: 'minor' }]),
    );

    expect(model.rows[0]?.resolvedVersion).toBe('v1.5.2');
    expect(model.rows[0]?.candidate).toBe('v1.6.0');
    expect(model.rows[0]?.kind).toBe('minor');
  });

  it('hides a prerelease candidate unless the option asks for it', () => {
    const hidden = assemblePanelModel(
      project([{ name: 'rsc.io/quote', version: 'v1.5.1' }]),
      resolved([{ name: 'rsc.io/quote', version: 'v1.5.1', candidate: 'v2.0.0-rc.1', kind: 'prerelease' }]),
    );
    const shown = assemblePanelModel(
      project([{ name: 'rsc.io/quote', version: 'v1.5.1' }]),
      resolved([{ name: 'rsc.io/quote', version: 'v1.5.1', candidate: 'v2.0.0-rc.1', kind: 'prerelease' }]),
      { includePrereleases: true },
    );

    expect(hidden.rows[0]?.candidate).toBeUndefined();
    expect(hidden.rows[0]?.kind).toBe('none');
    expect(shown.rows[0]?.candidate).toBe('v2.0.0-rc.1');
  });

  it('attaches advisories by dependency name', () => {
    const advisory: Advisory = { id: 'GO-0000-00001', summary: 'reachable in sampler', fixedIn: 'v1.99.99' };
    const model = assemblePanelModel(
      project([
        { name: 'rsc.io/sampler', version: 'v1.3.0', transitive: true },
        { name: 'rsc.io/quote', version: 'v1.5.1' },
      ]),
      new Map(),
      { advisories: new Map([['rsc.io/sampler', [advisory]]]) },
    );

    const sampler = model.rows.find((row) => row.name === 'rsc.io/sampler');
    const quote = model.rows.find((row) => row.name === 'rsc.io/quote');

    expect(sampler?.advisories).toEqual([advisory]);
    expect(quote?.advisories).toEqual([]);
  });

  it('summarises each project with its dependency count', () => {
    const model = assemblePanelModel(
      project([
        { name: 'rsc.io/quote', version: 'v1.5.1' },
        { name: 'rsc.io/sampler', version: 'v1.3.0', transitive: true },
      ]),
      new Map(),
    );

    expect(model.projects).toEqual([
      { name: 'example.com/a', manifestPath: MANIFEST, dependencyCount: 2 },
    ]);
  });
});
