import type { SearchResult } from './adapter';
import { advisoryFixOffer } from './advisoryAction';
import {
  browseModuleStatus,
  defaultCheckedManifests,
  planInspectorTargets,
  type Tab,
} from './browse';
import type { TargetChange } from './bulk';
import type { DependencySelection, RecoveryAction } from './messages';
import type {
  Advisory,
  DependencyRow,
  PanelModel,
  ProjectFailure,
  ProjectSummary,
} from './model';
import { compareVersions } from './version';

export interface PanelFocus {
  readonly manifestPath?: string;
  readonly moduleName?: string;
}

export interface ResolvedPanelFocus {
  readonly moduleFilter: string;
  readonly tab?: Tab;
  readonly selectedId?: string;
  readonly revealIndirect?: boolean;
}

export type ContextMenuAction =
  | {
      readonly type: 'update';
      readonly manifestPath: string;
      readonly name: string;
      readonly version: string;
    }
  | { readonly type: 'apply-targets'; readonly targets: readonly TargetChange[] }
  | { readonly type: 'bulk-update'; readonly selection: readonly DependencySelection[] }
  | { readonly type: 'clear-selection' }
  | {
      readonly type: 'uninstall';
      readonly targets: readonly DependencySelection[];
    }
  | {
      readonly type: 'open-manifest';
      readonly manifestPath: string;
      readonly name?: string;
    }
  | { readonly type: 'tidy'; readonly manifests: readonly string[] }
  | {
      readonly type: 'recover';
      readonly manifestPath: string;
      readonly action: RecoveryAction;
    }
  | { readonly type: 'show-output' }
  | { readonly type: 'target-only-project'; readonly manifestPath: string }
  | { readonly type: 'target-all-projects' }
  | { readonly type: 'copy'; readonly text: string }
  | { readonly type: 'open-external'; readonly url: string };

export interface ContextMenuItem {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly action: ContextMenuAction;
}

export interface ContextMenuSection {
  readonly id: string;
  readonly items: readonly ContextMenuItem[];
}

export function resolvePanelFocus(
  model: PanelModel,
  focus: PanelFocus,
): ResolvedPanelFocus | undefined {
  if (focus.manifestPath === undefined) {
    return { moduleFilter: 'all' };
  }

  const targetPath = normalizeManifestPath(focus.manifestPath);
  const project = model.projects.find(
    (entry) => normalizeManifestPath(entry.manifestPath) === targetPath,
  );
  if (project === undefined) {
    return undefined;
  }

  if (focus.moduleName !== undefined && focus.moduleName.trim() !== '') {
    const row = model.rows.find(
      (entry) =>
        entry.manifestPath === project.manifestPath && entry.name === focus.moduleName,
    );
    if (row !== undefined) {
      return {
        moduleFilter: project.name,
        tab: 'dependencies',
        selectedId: row.id,
        revealIndirect: row.transitive,
      };
    }
  }

  return { moduleFilter: project.name };
}

export function clampMenuPosition(
  anchor: { readonly x: number; readonly y: number },
  menuSize: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
  margin = 8,
): { readonly x: number; readonly y: number } {
  const maxX = Math.max(margin, viewport.width - menuSize.width - margin);
  const maxY = Math.max(margin, viewport.height - menuSize.height - margin);
  return {
    x: Math.min(Math.max(margin, anchor.x), maxX),
    y: Math.min(Math.max(margin, anchor.y), maxY),
  };
}

export function buildDependencyRowMenu({
  row,
  checkedIds,
  updatableSelection,
  locked,
}: {
  readonly row: DependencyRow;
  readonly checkedIds: ReadonlySet<string>;
  readonly updatableSelection: readonly DependencySelection[];
  readonly locked: boolean;
}): readonly ContextMenuSection[] {
  const sections: ContextMenuSection[] = [];

  if (checkedIds.has(row.id) && checkedIds.size > 1) {
    sections.push({
      id: 'selection',
      items: [
        {
          id: 'bulk-update',
          label: `Update selected (${updatableSelection.length})`,
          disabled: locked || updatableSelection.length === 0,
          action: { type: 'bulk-update', selection: updatableSelection },
        },
        {
          id: 'clear-selection',
          label: 'Clear selection',
          action: { type: 'clear-selection' },
        },
      ],
    });
  }

  if (row.replacement === undefined) {
    const mutationItems: ContextMenuItem[] = [];
    if (row.candidate !== undefined) {
      mutationItems.push({
        id: 'update-candidate',
        label: `Update to ${row.candidate}`,
        disabled: locked,
        action: {
          type: 'update',
          manifestPath: row.manifestPath,
          name: row.name,
          version: row.candidate,
        },
      });
    }

    const seenFixes = new Set<string>(row.candidate === undefined ? [] : [row.candidate]);
    for (const advisory of row.advisories) {
      const fix = advisoryFixOffer(advisory, row.resolvedVersion);
      if (fix.offered && !seenFixes.has(fix.version)) {
        seenFixes.add(fix.version);
        mutationItems.push({
          id: `fix-advisory-${fix.version}`,
          label: `Update to ${fix.version} (fix advisory)`,
          disabled: locked,
          action: {
            type: 'update',
            manifestPath: row.manifestPath,
            name: row.name,
            version: fix.version,
          },
        });
      }
    }

    mutationItems.push({
      id: 'uninstall',
      label: 'Uninstall',
      disabled: locked,
      action: {
        type: 'uninstall',
        targets: [{ manifestPath: row.manifestPath, name: row.name }],
      },
    });

    sections.push({ id: 'mutations', items: mutationItems });
  }

  sections.push({
    id: 'navigation',
    items: [
      {
        id: 'open-manifest',
        label: 'Open go.mod at require',
        action: {
          type: 'open-manifest',
          manifestPath: row.manifestPath,
          name: row.name,
        },
      },
    ],
  });

  const targetVersion = row.candidate ?? row.resolvedVersion ?? row.declaredVersion;
  sections.push({
    id: 'copy',
    items: [
      {
        id: 'copy-path',
        label: 'Copy module path',
        action: { type: 'copy', text: row.name },
      },
      {
        id: 'copy-require',
        label: 'Copy require line',
        action: { type: 'copy', text: `${row.name} ${row.declaredVersion}` },
      },
      {
        id: 'copy-go-get',
        label: 'Copy go get command',
        action: { type: 'copy', text: `go get ${row.name}@${targetVersion}` },
      },
    ],
  });

  const links: ContextMenuItem[] = [];
  const docUrl = pkgUrl(row);
  if (docUrl !== undefined) {
    links.push({
      id: 'open-pkg',
      label: 'Open on pkg.go.dev',
      action: { type: 'open-external', url: docUrl },
    });
  }
  const repoUrl = repositoryUrlFor(row);
  if (repoUrl !== undefined) {
    links.push({
      id: 'open-repo',
      label: 'Open repository',
      action: { type: 'open-external', url: repoUrl },
    });
  }
  if (links.length > 0) {
    sections.push({ id: 'links', items: links });
  }

  return sections;
}

export function buildBrowseRowMenu({
  item,
  projects,
  rows,
  moduleFilter,
  locked,
}: {
  readonly item: SearchResult;
  readonly projects: readonly ProjectSummary[];
  readonly rows: readonly DependencyRow[];
  readonly moduleFilter: string;
  readonly locked: boolean;
}): readonly ContextMenuSection[] {
  const sections: ContextMenuSection[] = [];
  const status = browseModuleStatus(item.name, rows, moduleFilter);
  const checkedManifests = defaultCheckedManifests(
    projects,
    status.installedIn,
    moduleFilter,
  );
  const installTargets = planInspectorTargets({
    moduleName: item.name,
    chosenVersion: item.version,
    checkedManifests,
    rows,
    action: 'install-or-update',
  });
  const removeTargets = planInspectorTargets({
    moduleName: item.name,
    chosenVersion: item.version,
    checkedManifests,
    rows,
    action: 'remove',
  });

  const isAddingNew = installTargets.some(
    (target) =>
      !rows.some(
        (row) => row.manifestPath === target.manifestPath && row.name === item.name,
      ),
  );

  const mutationItems: ContextMenuItem[] = [];
  if (installTargets.length > 0) {
    mutationItems.push({
      id: 'install-or-update',
      label: isAddingNew ? `Install ${item.version}` : `Update to ${item.version}`,
      disabled: locked,
      action: { type: 'apply-targets', targets: installTargets },
    });
  }
  if (removeTargets.length > 0) {
    mutationItems.push({
      id: 'uninstall',
      label: 'Uninstall',
      disabled: locked,
      action: {
        type: 'uninstall',
        targets: removeTargets.map((target) => ({
          manifestPath: target.manifestPath,
          name: target.name,
        })),
      },
    });
  }
  if (mutationItems.length > 0) {
    sections.push({ id: 'mutations', items: mutationItems });
  }

  const firstInstalled = status.installedIn[0];
  if (firstInstalled !== undefined) {
    sections.push({
      id: 'navigation',
      items: [
        {
          id: 'open-manifest',
          label: 'Open go.mod at require',
          action: {
            type: 'open-manifest',
            manifestPath: firstInstalled.manifestPath,
            name: item.name,
          },
        },
      ],
    });
  }

  const importPath = item.matchedPackage ?? item.name;
  sections.push({
    id: 'copy',
    items: [
      {
        id: 'copy-path',
        label: 'Copy module path',
        action: { type: 'copy', text: item.name },
      },
      {
        id: 'copy-import',
        label: 'Copy import statement',
        action: { type: 'copy', text: `import "${importPath}"` },
      },
      {
        id: 'copy-go-get',
        label: 'Copy go get command',
        action: { type: 'copy', text: `go get ${item.name}@${item.version}` },
      },
    ],
  });

  if (item.private !== true) {
    const links: ContextMenuItem[] = [
      {
        id: 'open-pkg',
        label: 'Open on pkg.go.dev',
        action: { type: 'open-external', url: `https://pkg.go.dev/${item.name}` },
      },
    ];
    const repoUrl = repositoryUrl(item.name);
    if (repoUrl !== undefined) {
      links.push({
        id: 'open-repo',
        label: 'Open repository',
        action: { type: 'open-external', url: repoUrl },
      });
    }
    sections.push({ id: 'links', items: links });
  }

  return sections;
}

export function buildConsolidateGroupMenu({
  group,
  locked,
}: {
  readonly group: { readonly name: string; readonly rows: readonly DependencyRow[] };
  readonly locked: boolean;
}): readonly ContextMenuSection[] {
  const sections: ContextMenuSection[] = [];
  const highestResolved = highestVersion(
    group.rows.map((row) => row.resolvedVersion ?? row.declaredVersion),
  );
  const latestCandidate = highestVersion(
    group.rows
      .map((row) => row.candidate)
      .filter((value): value is string => value !== undefined),
  );

  const mutationItems: ContextMenuItem[] = [];
  if (highestResolved !== undefined) {
    const targets = consolidateTargetsForVersion(group.rows, highestResolved);
    if (targets.length > 0) {
      mutationItems.push({
        id: 'consolidate-highest',
        label: `Consolidate all to ${highestResolved}`,
        disabled: locked,
        action: { type: 'apply-targets', targets },
      });
    }
  }

  if (
    latestCandidate !== undefined &&
    (highestResolved === undefined || compareVersions(latestCandidate, highestResolved) > 0)
  ) {
    const candidateTargets = consolidateTargetsForVersion(group.rows, latestCandidate);
    if (candidateTargets.length > 0) {
      mutationItems.push({
        id: 'consolidate-candidate',
        label: `Consolidate all to ${latestCandidate}`,
        disabled: locked,
        action: { type: 'apply-targets', targets: candidateTargets },
      });
    }
  }

  if (mutationItems.length > 0) {
    sections.push({ id: 'mutations', items: mutationItems });
  }

  sections.push({
    id: 'copy',
    items: [
      {
        id: 'copy-path',
        label: 'Copy module path',
        action: { type: 'copy', text: group.name },
      },
    ],
  });

  const sampleRow = group.rows.find((row) => row.replacement === undefined) ?? group.rows[0];
  const links: ContextMenuItem[] = [];
  const docUrl = sampleRow === undefined ? undefined : pkgUrl(sampleRow);
  if (docUrl !== undefined) {
    links.push({
      id: 'open-pkg',
      label: 'Open on pkg.go.dev',
      action: { type: 'open-external', url: docUrl },
    });
  }
  const repoUrl = sampleRow === undefined ? repositoryUrl(group.name) : repositoryUrlFor(sampleRow);
  if (repoUrl !== undefined) {
    links.push({
      id: 'open-repo',
      label: 'Open repository',
      action: { type: 'open-external', url: repoUrl },
    });
  }
  if (links.length > 0) {
    sections.push({ id: 'links', items: links });
  }

  return sections;
}

export function buildConsolidateRowMenu({
  row,
  groupRows,
  locked,
}: {
  readonly row: DependencyRow;
  readonly groupRows: readonly DependencyRow[];
  readonly locked: boolean;
}): readonly ContextMenuSection[] {
  const sections: ContextMenuSection[] = [];
  const rowVersion = row.resolvedVersion ?? row.declaredVersion;
  const highestResolved = highestVersion(
    groupRows.map((entry) => entry.resolvedVersion ?? entry.declaredVersion),
  );

  const otherTargets: TargetChange[] = groupRows
    .filter(
      (entry) =>
        entry.manifestPath !== row.manifestPath &&
        entry.replacement === undefined &&
        (entry.resolvedVersion ?? entry.declaredVersion) !== rowVersion,
    )
    .map((entry) => ({
      manifestPath: entry.manifestPath,
      name: entry.name,
      version: rowVersion,
    }));

  const mutationItems: ContextMenuItem[] = [];
  if (otherTargets.length > 0) {
    mutationItems.push({
      id: 'consolidate-others',
      label: `Consolidate other projects to ${rowVersion}`,
      disabled: locked,
      action: { type: 'apply-targets', targets: otherTargets },
    });
  }

  if (
    row.replacement === undefined &&
    highestResolved !== undefined &&
    compareVersions(rowVersion, highestResolved) < 0
  ) {
    mutationItems.push({
      id: 'update-to-highest',
      label: `Update ${row.project} to ${highestResolved}`,
      disabled: locked,
      action: {
        type: 'update',
        manifestPath: row.manifestPath,
        name: row.name,
        version: highestResolved,
      },
    });
  }

  if (mutationItems.length > 0) {
    sections.push({ id: 'mutations', items: mutationItems });
  }

  sections.push({
    id: 'navigation',
    items: [
      {
        id: 'open-manifest',
        label: 'Open go.mod at require',
        action: {
          type: 'open-manifest',
          manifestPath: row.manifestPath,
          name: row.name,
        },
      },
    ],
  });

  sections.push({
    id: 'copy',
    items: [
      {
        id: 'copy-path',
        label: 'Copy module path',
        action: { type: 'copy', text: row.name },
      },
      {
        id: 'copy-require',
        label: 'Copy require line',
        action: { type: 'copy', text: `${row.name} ${row.declaredVersion}` },
      },
    ],
  });

  return sections;
}

export function buildProjectChecklistRowMenu({
  project,
  moduleName,
  installedRow,
  locked,
}: {
  readonly project: ProjectSummary;
  readonly moduleName: string;
  readonly installedRow: DependencyRow | undefined;
  readonly locked: boolean;
}): readonly ContextMenuSection[] {
  return [
    {
      id: 'selection',
      items: [
        {
          id: 'target-only',
          label: `Target only ${project.name}`,
          disabled: locked,
          action: { type: 'target-only-project', manifestPath: project.manifestPath },
        },
        {
          id: 'target-all',
          label: 'Target all projects',
          disabled: locked,
          action: { type: 'target-all-projects' },
        },
      ],
    },
    {
      id: 'navigation',
      items: [
        {
          id: 'open-manifest',
          label: installedRow !== undefined ? 'Open go.mod at require' : 'Open go.mod',
          action: {
            type: 'open-manifest',
            manifestPath: project.manifestPath,
            ...(installedRow !== undefined ? { name: moduleName } : {}),
          },
        },
      ],
    },
    {
      id: 'mutations',
      items: [
        {
          id: 'tidy-project',
          label: `Run go mod tidy in ${project.name}`,
          disabled: locked,
          action: { type: 'tidy', manifests: [project.manifestPath] },
        },
      ],
    },
    {
      id: 'copy',
      items: [
        {
          id: 'copy-manifest-path',
          label: 'Copy go.mod path',
          action: { type: 'copy', text: project.manifestPath },
        },
      ],
    },
  ];
}

export function buildAdvisoryCardMenu({
  advisory,
  row,
  locked,
}: {
  readonly advisory: Advisory;
  readonly row: DependencyRow;
  readonly locked: boolean;
}): readonly ContextMenuSection[] {
  const sections: ContextMenuSection[] = [];
  const fix = advisoryFixOffer(advisory, row.resolvedVersion);
  if (fix.offered && row.replacement === undefined) {
    sections.push({
      id: 'mutations',
      items: [
        {
          id: 'update-fixed',
          label: `Update to ${fix.version}`,
          disabled: locked,
          action: {
            type: 'update',
            manifestPath: row.manifestPath,
            name: row.name,
            version: fix.version,
          },
        },
      ],
    });
  }

  sections.push({
    id: 'links',
    items: [
      {
        id: 'open-advisory',
        label: 'Open advisory on pkg.go.dev',
        action: {
          type: 'open-external',
          url: `https://pkg.go.dev/vuln/${advisory.id}`,
        },
      },
    ],
  });

  sections.push({
    id: 'copy',
    items: [
      {
        id: 'copy-advisory-id',
        label: 'Copy advisory ID',
        action: { type: 'copy', text: advisory.id },
      },
      {
        id: 'copy-advisory-details',
        label: 'Copy advisory details',
        action: { type: 'copy', text: `${advisory.id}: ${advisory.summary}` },
      },
    ],
  });

  return sections;
}

export function buildFailureBannerMenu({
  project,
  failure,
  recoveryLabel,
  recoveryAction,
  locked,
}: {
  readonly project: ProjectSummary;
  readonly failure: ProjectFailure;
  readonly recoveryLabel: string;
  readonly recoveryAction: RecoveryAction;
  readonly locked: boolean;
}): readonly ContextMenuSection[] {
  return [
    {
      id: 'mutations',
      items: [
        {
          id: 'recover',
          label: recoveryLabel,
          disabled: locked,
          action: {
            type: 'recover',
            manifestPath: project.manifestPath,
            action: recoveryAction,
          },
        },
      ],
    },
    {
      id: 'navigation',
      items: [
        {
          id: 'open-manifest',
          label: 'Open go.mod',
          action: {
            type: 'open-manifest',
            manifestPath: project.manifestPath,
          },
        },
        {
          id: 'show-output',
          label: 'Show output log',
          action: { type: 'show-output' },
        },
      ],
    },
    {
      id: 'copy',
      items: [
        {
          id: 'copy-error',
          label: 'Copy error message',
          action: { type: 'copy', text: failure.message },
        },
      ],
    },
  ];
}

export function repositoryUrl(modulePath: string): string | undefined {
  const match = /^(github\.com|gitlab\.com|bitbucket\.org)\/([^/]+)\/([^/]+)/.exec(
    modulePath,
  );
  if (match === null) {
    return undefined;
  }
  return `https://${match[1]}/${match[2]}/${match[3]}`;
}

export function linkModulePath(row: DependencyRow): string | undefined {
  if (row.replacement === undefined) {
    return row.name;
  }
  return row.replacement.version === undefined ? undefined : row.replacement.path;
}

export function pkgUrl(row: DependencyRow): string | undefined {
  const path = linkModulePath(row);
  return path === undefined ? undefined : `https://pkg.go.dev/${path}`;
}

export function repositoryUrlFor(row: DependencyRow): string | undefined {
  const path = linkModulePath(row);
  return path === undefined ? undefined : repositoryUrl(path);
}

function consolidateTargetsForVersion(
  rows: readonly DependencyRow[],
  targetVersion: string,
): TargetChange[] {
  return rows
    .filter(
      (row) =>
        row.replacement === undefined &&
        (row.resolvedVersion ?? row.declaredVersion) !== targetVersion,
    )
    .map((row) => ({
      manifestPath: row.manifestPath,
      name: row.name,
      version: targetVersion,
    }));
}

function highestVersion(versions: readonly string[]): string | undefined {
  const sorted = [...new Set(versions)].sort((left, right) => compareVersions(right, left));
  return sorted[0];
}

function normalizeManifestPath(manifestPath: string): string {
  return manifestPath.replace(/\\/g, '/').toLowerCase();
}
