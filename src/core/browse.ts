import type { TargetChange } from './bulk';
import type { DependencyRow, ProjectSummary } from './model';

export type Tab =
  | 'browse'
  | 'dependencies'
  | 'updates'
  | 'vulnerabilities'
  | 'consolidate';

export function initialTabFromHash(hash: string): Tab {
  if (hash === '#vulnerabilities') {
    return 'vulnerabilities';
  }
  if (hash === '#updates') {
    return 'updates';
  }
  if (hash === '#consolidate') {
    return 'consolidate';
  }
  if (hash === '#installed' || hash === '#dependencies') {
    return 'dependencies';
  }
  return 'browse';
}

export interface BrowseBadge {
  readonly label: string;
  readonly indirect: boolean;
}

export interface BrowseModuleStatus {
  readonly installedIn: readonly DependencyRow[];
  readonly badge?: BrowseBadge;
}

export function browseModuleStatus(
  modulePath: string,
  rows: readonly DependencyRow[],
  moduleFilter: string,
): BrowseModuleStatus {
  return statusFromRows(
    rows.filter(
      (row) =>
        row.name === modulePath &&
        (moduleFilter === 'all' || row.project === moduleFilter),
    ),
  );
}

/**
 * Status for every searched module in one pass. Browse pages can hold hundreds
 * of rows, so filtering the dependency list once beats filtering it per row.
 */
export function browseModuleStatusIndex(
  modulePaths: readonly string[],
  rows: readonly DependencyRow[],
  moduleFilter: string,
): ReadonlyMap<string, BrowseModuleStatus> {
  const byName = new Map<string, DependencyRow[]>();
  for (const row of rows) {
    if (moduleFilter !== 'all' && row.project !== moduleFilter) {
      continue;
    }
    const entries = byName.get(row.name);
    if (entries === undefined) {
      byName.set(row.name, [row]);
    } else {
      entries.push(row);
    }
  }

  const index = new Map<string, BrowseModuleStatus>();
  for (const modulePath of modulePaths) {
    index.set(modulePath, statusFromRows(byName.get(modulePath) ?? []));
  }
  return index;
}

function statusFromRows(installedIn: readonly DependencyRow[]): BrowseModuleStatus {
  if (installedIn.length === 0) {
    return { installedIn };
  }

  const versions = [
    ...new Set(
      installedIn.map((row) => row.resolvedVersion ?? row.declaredVersion),
    ),
  ];
  const allIndirect = installedIn.every((row) => row.transitive);

  if (versions.length > 1) {
    return {
      installedIn,
      badge: {
        label: `${versions.length} versions`,
        indirect: allIndirect,
      },
    };
  }

  const version = versions[0] ?? '';
  const suffix = installedIn.length > 1 ? ` (${installedIn.length})` : '';
  return {
    installedIn,
    badge: {
      label: allIndirect
        ? `indirect ${version}${suffix}`
        : `installed ${version}${suffix}`,
      indirect: allIndirect,
    },
  };
}

export function defaultCheckedManifests(
  projects: readonly ProjectSummary[],
  installedIn: readonly { readonly manifestPath: string }[],
  moduleFilter: string,
): ReadonlySet<string> {
  if (projects.length === 1 && projects[0] !== undefined) {
    return new Set([projects[0].manifestPath]);
  }
  if (moduleFilter !== 'all') {
    const matching = projects.find((project) => project.name === moduleFilter);
    if (matching !== undefined) {
      return new Set([matching.manifestPath]);
    }
  }
  if (installedIn.length > 0) {
    return new Set(installedIn.map((entry) => entry.manifestPath));
  }
  const firstHealthy =
    projects.find((project) => project.failure === undefined) ?? projects[0];
  return firstHealthy === undefined ? new Set() : new Set([firstHealthy.manifestPath]);
}

export function planInspectorTargets(input: {
  readonly moduleName: string;
  readonly chosenVersion: string;
  readonly checkedManifests: ReadonlySet<string>;
  readonly rows: readonly DependencyRow[];
  readonly action: 'install-or-update' | 'remove';
}): readonly TargetChange[] {
  const targets: TargetChange[] = [];

  for (const manifestPath of input.checkedManifests) {
    const existing = input.rows.find(
      (row) => row.manifestPath === manifestPath && row.name === input.moduleName,
    );
    if (existing?.replacement !== undefined) {
      continue;
    }

    if (input.action === 'remove') {
      if (existing !== undefined) {
        targets.push({
          manifestPath,
          name: input.moduleName,
          version: 'none',
        });
      }
      continue;
    }

    const currentVersion = existing?.resolvedVersion ?? existing?.declaredVersion;
    if (currentVersion === input.chosenVersion) {
      continue;
    }

    targets.push({
      manifestPath,
      name: input.moduleName,
      version: input.chosenVersion,
    });
  }

  return targets;
}
