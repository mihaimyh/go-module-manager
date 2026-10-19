import { describe, expect, it } from 'vitest';
import {
  browseModuleStatus,
  defaultCheckedManifests,
  initialTabFromHash,
  planInspectorTargets,
} from './browse';
import type { DependencyRow, ProjectSummary } from './model';

const PROJECTS: readonly ProjectSummary[] = [
  { name: 'example.com/a', manifestPath: '/repo/a/go.mod', dependencyCount: 1 },
  { name: 'example.com/b', manifestPath: '/repo/b/go.mod', dependencyCount: 1 },
];

function makeRow(
  project: string,
  manifestPath: string,
  name: string,
  version: string,
  transitive = false,
): DependencyRow {
  return {
    id: `${manifestPath}#${name}`,
    name,
    project,
    manifestPath,
    declaredVersion: version,
    resolvedVersion: version,
    transitive,
    kind: 'none',
    advisories: [],
  };
}

describe('initialTabFromHash', () => {
  it('defaults to browse when no hash is given and supports #installed and #dependencies', () => {
    expect(initialTabFromHash('')).toBe('browse');
    expect(initialTabFromHash('#browse')).toBe('browse');
    expect(initialTabFromHash('#installed')).toBe('dependencies');
    expect(initialTabFromHash('#dependencies')).toBe('dependencies');
    expect(initialTabFromHash('#updates')).toBe('updates');
    expect(initialTabFromHash('#vulnerabilities')).toBe('vulnerabilities');
    expect(initialTabFromHash('#consolidate')).toBe('consolidate');
  });
});

describe('browseModuleStatus', () => {
  it('summarises installed and indirect status for a searched module', () => {
    const rows = [
      makeRow('example.com/a', '/repo/a/go.mod', 'github.com/spf13/cobra', 'v1.9.0', true),
    ];

    const status = browseModuleStatus('github.com/spf13/cobra', rows, 'all');
    expect(status.installedIn).toHaveLength(1);
    expect(status.badge).toEqual({
      label: 'indirect v1.9.0',
      indirect: true,
    });
  });

  it('notes version count when multiple projects require different versions', () => {
    const rows = [
      makeRow('example.com/a', '/repo/a/go.mod', 'rsc.io/quote', 'v1.5.1'),
      makeRow('example.com/b', '/repo/b/go.mod', 'rsc.io/quote', 'v1.5.2'),
    ];

    const status = browseModuleStatus('rsc.io/quote', rows, 'all');
    expect(status.badge).toEqual({
      label: '2 versions',
      indirect: false,
    });
  });
});

describe('defaultCheckedManifests', () => {
  it('selects the filtered owning module when one is chosen in the toolbar', () => {
    expect([
      ...defaultCheckedManifests(PROJECTS, [], 'example.com/b'),
    ]).toEqual(['/repo/b/go.mod']);
  });

  it('selects already-installed projects when the module is present, or the first healthy project when new', () => {
    expect([
      ...defaultCheckedManifests(
        PROJECTS,
        [{ manifestPath: '/repo/b/go.mod' }],
        'all',
      ),
    ]).toEqual(['/repo/b/go.mod']);

    expect([...defaultCheckedManifests(PROJECTS, [], 'all')]).toEqual([
      '/repo/a/go.mod',
    ]);
  });
});

describe('planInspectorTargets', () => {
  it('plans install/update targets for checked projects not already at chosenVersion and remove targets for installed ones', () => {
    const rows = [
      makeRow('example.com/a', '/repo/a/go.mod', 'github.com/spf13/cobra', 'v1.9.0'),
      makeRow('example.com/b', '/repo/b/go.mod', 'github.com/spf13/cobra', 'v1.10.2'),
    ];
    const checked = new Set(['/repo/a/go.mod', '/repo/b/go.mod']);

    expect(
      planInspectorTargets({
        moduleName: 'github.com/spf13/cobra',
        chosenVersion: 'v1.10.2',
        checkedManifests: checked,
        rows,
        action: 'install-or-update',
      }),
    ).toEqual([
      {
        manifestPath: '/repo/a/go.mod',
        name: 'github.com/spf13/cobra',
        version: 'v1.10.2',
      },
    ]);

    expect(
      planInspectorTargets({
        moduleName: 'github.com/spf13/cobra',
        chosenVersion: 'v1.10.2',
        checkedManifests: checked,
        rows,
        action: 'remove',
      }),
    ).toEqual([
      {
        manifestPath: '/repo/a/go.mod',
        name: 'github.com/spf13/cobra',
        version: 'none',
      },
      {
        manifestPath: '/repo/b/go.mod',
        name: 'github.com/spf13/cobra',
        version: 'none',
      },
    ]);
  });
});
