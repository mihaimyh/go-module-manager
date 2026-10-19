import type { GoModRequire, ModuleListEntry } from './goJson';
import { classifyUpdate, isPrerelease, isPseudoVersion, type UpdateKind } from './version';

/** A requirement line in one `go.mod`. The unit GMM lists, edits and updates. */
export interface Requirement {
  readonly goModPath: string;
  readonly owningModule: string;
  readonly path: string;
  readonly version: string;
  readonly indirect: boolean;
}

export interface ModuleFile {
  readonly goModPath: string;
  readonly modulePath: string;
  readonly requirements: readonly Requirement[];
}

export interface DependencyRow {
  readonly id: string;
  readonly path: string;
  readonly owningModule: string;
  readonly goModPath: string;
  readonly requiredVersion: string;
  readonly selectedVersion: string;
  readonly indirect: boolean;
  readonly candidate?: string;
  readonly kind: UpdateKind;
}

export interface ModuleSummary {
  readonly path: string;
  readonly goModPath: string;
  readonly dependencyCount: number;
}

export interface PanelModel {
  readonly modules: readonly ModuleSummary[];
  readonly rows: readonly DependencyRow[];
}

export interface AssembleOptions {
  readonly includePrereleases?: boolean;
}

export function requirementFromGoMod(
  goModPath: string,
  owningModule: string,
  require: GoModRequire,
): Requirement | undefined {
  if (!require.Path || !require.Version) {
    return undefined;
  }
  return {
    goModPath,
    owningModule,
    path: require.Path,
    version: require.Version,
    indirect: require.Indirect === true,
  };
}

/**
 * One row per requirement, never one row per module path: two modules in the
 * same workspace can require the same path at different versions, and that is
 * the divergence the Consolidate view exists to explain.
 */
export function assemblePanelModel(
  files: readonly ModuleFile[],
  buildLists: ReadonlyMap<string, readonly ModuleListEntry[]>,
  options: AssembleOptions = {},
): PanelModel {
  const rows: DependencyRow[] = [];

  for (const file of files) {
    const buildList = buildLists.get(file.goModPath) ?? [];
    const byPath = new Map<string, ModuleListEntry>(
      buildList
        .filter(hasIdentity)
        .map((entry): [string, ModuleListEntry] => [entry.Path, entry]),
    );

    for (const requirement of file.requirements) {
      const selected = byPath.get(requirement.path);
      const selectedVersion = selected?.Version ?? requirement.version;
      const candidate = pickCandidate(selected, options.includePrereleases === true);

      rows.push({
        id: `${file.goModPath}#${requirement.path}`,
        path: requirement.path,
        owningModule: file.modulePath,
        goModPath: file.goModPath,
        requiredVersion: requirement.version,
        selectedVersion,
        indirect: requirement.indirect,
        ...(candidate === undefined ? {} : { candidate }),
        kind: candidate === undefined ? 'none' : classifyUpdate(selectedVersion, candidate),
      });
    }
  }

  rows.sort((left, right) => {
    if (left.owningModule !== right.owningModule) {
      return left.owningModule.localeCompare(right.owningModule);
    }
    return left.path.localeCompare(right.path);
  });

  return {
    modules: files.map((file) => ({
      path: file.modulePath,
      goModPath: file.goModPath,
      dependencyCount: file.requirements.length,
    })),
    rows,
  };
}

/**
 * Pseudo-versions are never offered as a target, and prereleases only on request:
 * both would present a state the toolchain will not select by default.
 */
function pickCandidate(
  selected: ModuleListEntry | undefined,
  includePrereleases: boolean,
): string | undefined {
  const version = selected?.Update?.Version;
  if (!version || isPseudoVersion(version)) {
    return undefined;
  }
  if (isPrerelease(version) && !includePrereleases) {
    return undefined;
  }
  return version;
}

function hasIdentity(
  entry: ModuleListEntry,
): entry is ModuleListEntry & { Path: string } {
  return typeof entry.Path === 'string' && entry.Path !== '';
}
