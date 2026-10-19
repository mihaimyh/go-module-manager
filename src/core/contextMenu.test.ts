import { describe, expect, it } from 'vitest';
import {
  buildAdvisoryCardMenu,
  buildBrowseRowMenu,
  buildConsolidateGroupMenu,
  buildConsolidateRowMenu,
  buildDependencyRowMenu,
  buildFailureBannerMenu,
  buildProjectChecklistRowMenu,
  clampMenuPosition,
  resolvePanelFocus,
} from './contextMenu';
import type { DependencyRow, PanelModel, ProjectSummary } from './model';

const PROJECTS: readonly ProjectSummary[] = [
  { name: 'example.com/a', manifestPath: '/repo/a/go.mod', dependencyCount: 2 },
  { name: 'example.com/b', manifestPath: '/repo/b/go.mod', dependencyCount: 1 },
];

function makeRow(overrides: Partial<DependencyRow> = {}): DependencyRow {
  const manifestPath = overrides.manifestPath ?? '/repo/a/go.mod';
  const name = overrides.name ?? 'github.com/spf13/cobra';
  return {
    id: `${manifestPath}#${name}`,
    name,
    project: overrides.project ?? 'example.com/a',
    manifestPath,
    declaredVersion: overrides.declaredVersion ?? 'v1.8.0',
    resolvedVersion: overrides.resolvedVersion ?? 'v1.8.0',
    transitive: overrides.transitive ?? false,
    kind: overrides.kind ?? 'none',
    advisories: overrides.advisories ?? [],
    ...(overrides.candidate === undefined ? {} : { candidate: overrides.candidate }),
    ...(overrides.replacement === undefined ? {} : { replacement: overrides.replacement }),
  };
}

describe('resolvePanelFocus', () => {
  const model: PanelModel = {
    projects: PROJECTS,
    rows: [
      makeRow({ name: 'github.com/spf13/cobra', transitive: false }),
      makeRow({ name: 'golang.org/x/text', transitive: true }),
    ],
  };

  it('scopes to all modules when no manifestPath is given (go.work)', () => {
    expect(resolvePanelFocus(model, {})).toEqual({
      moduleFilter: 'all',
    });
  });

  it('scopes to the owning module and selects the dependency row when moduleName is present, revealing indirect rows', () => {
    expect(
      resolvePanelFocus(model, {
        manifestPath: '/repo/a/go.mod',
        moduleName: 'golang.org/x/text',
      }),
    ).toEqual({
      moduleFilter: 'example.com/a',
      tab: 'dependencies',
      selectedId: '/repo/a/go.mod#golang.org/x/text',
      revealIndirect: true,
    });
  });

  it('matches Windows paths case-insensitively and scopes only the moduleFilter when no moduleName matches', () => {
    const winModel: PanelModel = {
      projects: [
        { name: 'example.com/win', manifestPath: 'E:\\repo\\a\\go.mod', dependencyCount: 0 },
      ],
      rows: [],
    };
    expect(
      resolvePanelFocus(winModel, { manifestPath: 'e:\\repo\\a\\go.mod' }),
    ).toEqual({
      moduleFilter: 'example.com/win',
    });
  });
});

describe('clampMenuPosition', () => {
  it('keeps the menu within viewport margins when clicked near the bottom-right edge', () => {
    expect(
      clampMenuPosition(
        { x: 750, y: 550 },
        { width: 200, height: 180 },
        { width: 800, height: 600 },
        8,
      ),
    ).toEqual({ x: 592, y: 412 });
  });

  it('preserves coordinates when well inside the viewport', () => {
    expect(
      clampMenuPosition(
        { x: 120, y: 90 },
        { width: 200, height: 180 },
        { width: 800, height: 600 },
        8,
      ),
    ).toEqual({ x: 120, y: 90 });
  });
});

describe('buildDependencyRowMenu', () => {
  it('includes multi-select actions, candidate update, distinct advisory fix, uninstall, navigation, copy, and links', () => {
    const row = makeRow({
      candidate: 'v1.10.2',
      kind: 'minor',
      advisories: [
        {
          id: 'GO-2025-00001',
          summary: 'Flag parsing bug',
          fixedIn: 'v1.9.1',
        },
      ],
    });
    const sections = buildDependencyRowMenu({
      row,
      checkedIds: new Set([row.id, '/repo/b/go.mod#other']),
      updatableSelection: [{ manifestPath: row.manifestPath, name: row.name }],
      locked: false,
    });

    expect(sections.map((section) => section.id)).toEqual([
      'selection',
      'mutations',
      'navigation',
      'copy',
      'links',
    ]);
    expect(sections[0]?.items.map((item) => item.label)).toEqual([
      'Update selected (1)',
      'Clear selection',
    ]);
    expect(sections[1]?.items.map((item) => item.label)).toEqual([
      'Update to v1.10.2',
      'Update to v1.9.1 (fix advisory)',
      'Uninstall',
    ]);
    expect(sections[2]?.items.map((item) => item.label)).toEqual([
      'Open go.mod at require',
    ]);
    expect(sections[3]?.items.map((item) => item.label)).toEqual([
      'Copy module path',
      'Copy require line',
      'Copy go get command',
    ]);
    expect(sections[4]?.items.map((item) => item.label)).toEqual([
      'Open on pkg.go.dev',
      'Open repository',
    ]);
  });

  it('omits mutation items when the dependency is controlled by a replace directive', () => {
    const row = makeRow({
      candidate: 'v1.10.2',
      replacement: { path: '../local-cobra' },
    });
    const sections = buildDependencyRowMenu({
      row,
      checkedIds: new Set(),
      updatableSelection: [],
      locked: false,
    });

    expect(sections.map((section) => section.id)).toEqual(['navigation', 'copy']);
  });
});

describe('buildBrowseRowMenu', () => {
  it('offers Install for an uninstalled module and Update + Uninstall + Open go.mod when already installed', () => {
    const freshMenu = buildBrowseRowMenu({
      item: {
        name: 'github.com/spf13/cobra',
        version: 'v1.10.2',
        summary: 'CLI library',
        matchedPackage: 'github.com/spf13/cobra/doc',
      },
      projects: PROJECTS,
      rows: [],
      moduleFilter: 'example.com/b',
      locked: false,
    });

    expect(freshMenu[0]?.items[0]).toEqual({
      id: 'install-or-update',
      label: 'Install v1.10.2',
      disabled: false,
      action: {
        type: 'apply-targets',
        targets: [
          {
            manifestPath: '/repo/b/go.mod',
            name: 'github.com/spf13/cobra',
            version: 'v1.10.2',
          },
        ],
      },
    });

    const installedRow = makeRow({
      manifestPath: '/repo/a/go.mod',
      project: 'example.com/a',
      declaredVersion: 'v1.8.0',
      resolvedVersion: 'v1.8.0',
    });
    const installedMenu = buildBrowseRowMenu({
      item: {
        name: 'github.com/spf13/cobra',
        version: 'v1.10.2',
        summary: 'CLI library',
      },
      projects: PROJECTS,
      rows: [installedRow],
      moduleFilter: 'all',
      locked: false,
    });

    expect(installedMenu[0]?.items.map((item) => item.label)).toEqual([
      'Update to v1.10.2',
      'Uninstall',
    ]);
    expect(installedMenu[1]?.items.map((item) => item.label)).toEqual([
      'Open go.mod at require',
    ]);

    const upToDateRow = makeRow({
      manifestPath: '/repo/a/go.mod',
      project: 'example.com/a',
      declaredVersion: 'v1.10.2',
      resolvedVersion: 'v1.10.2',
      candidate: 'v1.10.3',
    });
    const lockedDepMenu = buildDependencyRowMenu({
      row: upToDateRow,
      checkedIds: new Set(),
      updatableSelection: [],
      locked: true,
    });
    expect(lockedDepMenu[0]?.items.map((item) => ({ label: item.label, disabled: item.disabled }))).toEqual([
      { label: 'Update to v1.10.3', disabled: true },
      { label: 'Uninstall', disabled: true },
    ]);

    const privateLatestMenu = buildBrowseRowMenu({
      item: {
        name: 'corp.internal/auth',
        version: 'v1.10.2',
        summary: 'Internal auth',
        private: true,
      },
      projects: [PROJECTS[0]!],
      rows: [
        makeRow({
          name: 'corp.internal/auth',
          manifestPath: '/repo/a/go.mod',
          project: 'example.com/a',
          declaredVersion: 'v1.10.2',
          resolvedVersion: 'v1.10.2',
        }),
      ],
      moduleFilter: 'all',
      locked: false,
    });
    expect(privateLatestMenu.map((section) => section.id)).toEqual([
      'mutations',
      'navigation',
      'copy',
    ]);
    expect(privateLatestMenu[0]?.items.map((item) => item.label)).toEqual(['Uninstall']);
  });
});

describe('buildConsolidateGroupMenu and buildConsolidateRowMenu', () => {
  const rowA = makeRow({
    manifestPath: '/repo/a/go.mod',
    project: 'example.com/a',
    declaredVersion: 'v1.8.0',
    resolvedVersion: 'v1.8.0',
    candidate: 'v1.10.2',
  });
  const rowB = makeRow({
    manifestPath: '/repo/b/go.mod',
    project: 'example.com/b',
    declaredVersion: 'v1.9.1',
    resolvedVersion: 'v1.9.1',
    candidate: 'v1.10.2',
  });

  it('offers Consolidate all to highest resolved and to latest candidate on a group header', () => {
    const sections = buildConsolidateGroupMenu({
      group: { name: 'github.com/spf13/cobra', rows: [rowA, rowB] },
      locked: false,
    });

    expect(sections[0]?.items.map((item) => item.label)).toEqual([
      'Consolidate all to v1.9.1',
      'Consolidate all to v1.10.2',
    ]);
    expect(sections[0]?.items[0]?.action).toEqual({
      type: 'apply-targets',
      targets: [
        {
          manifestPath: '/repo/a/go.mod',
          name: 'github.com/spf13/cobra',
          version: 'v1.9.1',
        },
      ],
    });
  });

  it('offers Consolidate other projects to this row version and Update this project to highest resolved on a lagging row', () => {
    const sections = buildConsolidateRowMenu({
      row: rowA,
      groupRows: [rowA, rowB],
      locked: false,
    });

    expect(sections[0]?.items.map((item) => item.label)).toEqual([
      'Consolidate other projects to v1.8.0',
      'Update example.com/a to v1.9.1',
    ]);
  });
});

describe('buildProjectChecklistRowMenu, buildAdvisoryCardMenu, and buildFailureBannerMenu', () => {
  it('builds checklist, advisory card, and failure banner menus with expected actions', () => {
    const checklistMenu = buildProjectChecklistRowMenu({
      project: PROJECTS[0]!,
      moduleName: 'github.com/spf13/cobra',
      installedRow: undefined,
      locked: false,
    });
    expect(checklistMenu.flatMap((section) => section.items.map((item) => item.label))).toEqual([
      'Target only example.com/a',
      'Target all projects',
      'Open go.mod',
      'Run go mod tidy in example.com/a',
      'Copy go.mod path',
    ]);

    const row = makeRow({ resolvedVersion: 'v1.8.0' });
    const advisoryMenu = buildAdvisoryCardMenu({
      advisory: {
        id: 'GO-2025-00001',
        summary: 'Flag parsing bug',
        fixedIn: 'v1.9.1',
      },
      row,
      locked: false,
    });
    expect(advisoryMenu.flatMap((section) => section.items.map((item) => item.label))).toEqual([
      'Update to v1.9.1',
      'Open advisory on pkg.go.dev',
      'Copy advisory ID',
      'Copy advisory details',
    ]);

    const failureMenu = buildFailureBannerMenu({
      project: PROJECTS[0]!,
      failure: {
        manifestPath: '/work/api/go.mod',
        projectName: 'example.com/api',
        kind: 'missing-lock-entry',
        message: 'missing go.sum entry for module',
      },
      recoveryLabel: 'Run go mod download',
      recoveryAction: 'repair',
      locked: false,
    });
    expect(failureMenu.flatMap((section) => section.items.map((item) => item.label))).toEqual([
      'Run go mod download',
      'Open go.mod',
      'Show output log',
      'Copy error message',
    ]);
  });
});
