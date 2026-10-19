import { describe, expect, it } from 'vitest';
import {
  assemblePanelModel,
  mergeResolution,
  mergeRowFailure,
  withAdvisories,
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
  it('leaves the resolved version unknown until the build list is read', () => {
    const model = assemblePanelModel(project([{ name: 'rsc.io/quote', version: 'v1.5.1' }]), new Map());

    expect(model.rows[0]?.declaredVersion).toBe('v1.5.1');
    expect(model.rows[0]?.resolvedVersion).toBeUndefined();
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

describe('project failures', () => {
  it('attaches a failure to its project and keeps the rows', () => {
    const model = assemblePanelModel(
      project([{ name: 'rsc.io/quote', version: 'v1.5.1' }]),
      new Map(),
      {
        failures: [
          {
            manifestPath: MANIFEST,
            projectName: 'example.com/a',
            kind: 'missing-lock-entry',
            message: 'go: missing go.sum entry',
          },
        ],
      },
    );

    expect(model.projects[0]?.failure?.kind).toBe('missing-lock-entry');
    expect(model.rows).toHaveLength(1);
  });

  it('adds a summary for a project that could not be read at all', () => {
    const model = assemblePanelModel(project([]), new Map(), {
      failures: [
        {
          manifestPath: '/repo/broken/go.mod',
          projectName: 'broken',
          kind: 'unknown',
          message: 'go: errors parsing go.mod',
        },
      ],
    });

    expect(model.projects.map((entry) => entry.name)).toEqual(['broken', 'example.com/a']);
    expect(model.projects[0]?.dependencyCount).toBe(0);
    expect(model.projects[0]?.failure?.message).toMatch(/errors parsing/);
  });

  it('clears the failure once the project resolves', () => {
    const failed = assemblePanelModel(
      project([{ name: 'rsc.io/quote', version: 'v1.5.1' }]),
      new Map(),
      {
        failures: [
          {
            manifestPath: MANIFEST,
            projectName: 'example.com/a',
            kind: 'missing-lock-entry',
            message: 'go: missing go.sum entry',
          },
        ],
      },
    );

    const model = mergeResolution(failed, {
      manifestPath: MANIFEST,
      dependencies: [{ name: 'rsc.io/quote', version: 'v1.5.1' }],
    });

    expect(model.projects[0]?.failure).toBeUndefined();
  });
});

describe('mergeResolution', () => {
  const declared = withAdvisories(
    mergeResolution(
      assemblePanelModel(
        project([
          { name: 'rsc.io/quote', version: 'v1.5.1' },
          { name: 'rsc.io/sampler', version: 'v1.3.0', transitive: true },
        ]),
        new Map(),
      ),
      {
        manifestPath: MANIFEST,
        dependencies: [{ name: 'rsc.io/sampler', version: 'v1.3.0' }],
      },
    ),
    new Map([
      ['rsc.io/sampler@v1.3.0', [{ id: 'GO-0000-00001', summary: 'reachable in sampler' }]],
    ]),
  );

  it('fills the resolved version and the candidate for the matching project', () => {
    const model = mergeResolution(declared, {
      manifestPath: MANIFEST,
      dependencies: [
        { name: 'rsc.io/quote', version: 'v1.5.2', candidate: 'v1.6.0', kind: 'minor' },
        { name: 'rsc.io/sampler', version: 'v1.3.0', candidate: 'v1.99.99', kind: 'minor' },
      ],
    });

    const quote = model.rows.find((row) => row.name === 'rsc.io/quote');
    expect(quote?.declaredVersion).toBe('v1.5.1');
    expect(quote?.resolvedVersion).toBe('v1.5.2');
    expect(quote?.candidate).toBe('v1.6.0');
    expect(quote?.kind).toBe('minor');
  });

  it('leaves other projects and advisories untouched', () => {
    const model = mergeResolution(declared, {
      manifestPath: '/repo/other/go.mod',
      dependencies: [{ name: 'rsc.io/quote', version: 'v9.9.9' }],
    });

    const quote = model.rows.find((row) => row.name === 'rsc.io/quote');
    const sampler = model.rows.find((row) => row.name === 'rsc.io/sampler');

    expect(quote?.resolvedVersion).toBeUndefined();
    expect(sampler?.advisories).toHaveLength(1);
  });

  it('hides a prerelease candidate unless asked for it', () => {
    const resolvedProject = {
      manifestPath: MANIFEST,
      dependencies: [
        {
          name: 'rsc.io/quote',
          version: 'v1.5.1',
          candidate: 'v2.0.0-rc.1',
          kind: 'prerelease' as const,
        },
      ],
    };

    const hidden = mergeResolution(declared, resolvedProject);
    const shown = mergeResolution(declared, resolvedProject, { includePrereleases: true });

    expect(hidden.rows.find((row) => row.name === 'rsc.io/quote')?.candidate).toBeUndefined();
    expect(shown.rows.find((row) => row.name === 'rsc.io/quote')?.candidate).toBe('v2.0.0-rc.1');
  });
});

describe('mergeRowFailure', () => {
  it('puts a failed update message on its own row', () => {
    const base = assemblePanelModel(
      project([
        { name: 'rsc.io/quote', version: 'v1.5.1' },
        { name: 'rsc.io/sampler', version: 'v1.3.0' },
      ]),
      new Map(),
    );

    const model = mergeRowFailure(base, MANIFEST, 'rsc.io/quote', 'go: permission denied');

    expect(model.rows.find((row) => row.name === 'rsc.io/quote')?.failure).toMatch(
      /permission denied/,
    );
    expect(model.rows.find((row) => row.name === 'rsc.io/sampler')?.failure).toBeUndefined();
  });
});

describe('withAdvisories', () => {
  it('attaches advisory matches only to rows with a resolved version', () => {
    const base = assemblePanelModel(
      project([{ name: 'rsc.io/sampler', version: 'v1.3.0' }]),
      new Map(),
    );
    const matches = new Map([
      ['rsc.io/sampler@v1.3.0', [{ id: 'GO-0000-00001', summary: 'reachable in sampler' }]],
    ]);

    const unresolved = withAdvisories(base, matches);
    expect(unresolved.rows[0]?.advisories).toEqual([]);

    const resolved = mergeResolution(base, {
      manifestPath: MANIFEST,
      dependencies: [{ name: 'rsc.io/sampler', version: 'v1.3.0' }],
    });
    const attached = withAdvisories(resolved, matches);
    expect(attached.rows[0]?.advisories).toHaveLength(1);
  });
});
