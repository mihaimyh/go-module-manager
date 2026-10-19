import { isPrerelease, type UpdateKind } from './version';

/** A published report that specific symbols in a version range are vulnerable. */
export interface Advisory {
  readonly id: string;
  readonly summary: string;
  readonly fixedIn?: string;
}

/** A manifest and the code it governs: one `go.mod`, one `pubspec.yaml`. */
export interface ProjectInput {
  readonly manifestPath: string;
  readonly name: string;
  readonly dependencies: readonly DependencyInput[];
}

/** A declared need on another unit of code, as written in a manifest. */
export interface DependencyInput {
  readonly manifestPath: string;
  readonly project: string;
  readonly name: string;
  readonly declaredVersion: string;
  readonly transitive: boolean;
}

/** What the ecosystem's resolver decided for one dependency. */
export interface ResolvedDependency {
  readonly name: string;
  readonly version: string;
  readonly candidate?: string;
  readonly kind?: UpdateKind;
}

export interface DependencyRow {
  readonly id: string;
  readonly name: string;
  readonly project: string;
  readonly manifestPath: string;
  readonly declaredVersion: string;
  /** Absent until the build list has been read; never guessed from the manifest. */
  readonly resolvedVersion?: string;
  readonly transitive: boolean;
  readonly candidate?: string;
  readonly kind: UpdateKind;
  readonly advisories: readonly Advisory[];
}

export interface ProjectSummary {
  readonly name: string;
  readonly manifestPath: string;
  readonly dependencyCount: number;
}

export interface PanelModel {
  readonly projects: readonly ProjectSummary[];
  readonly rows: readonly DependencyRow[];
}

export interface AssembleOptions {
  readonly includePrereleases?: boolean;
  readonly advisories?: ReadonlyMap<string, readonly Advisory[]>;
}

/**
 * One row per declared dependency, never one row per name: two projects can
 * declare the same dependency at different versions, and that divergence is
 * what the Consolidate view exists to explain.
 */
export function assemblePanelModel(
  projects: readonly ProjectInput[],
  resolvedByManifest: ReadonlyMap<string, readonly ResolvedDependency[]>,
  options: AssembleOptions = {},
): PanelModel {
  const rows: DependencyRow[] = [];

  for (const project of projects) {
    const resolved = resolvedByManifest.get(project.manifestPath) ?? [];
    const byName = new Map(resolved.map((entry) => [entry.name, entry]));

    for (const dependency of project.dependencies) {
      const entry = byName.get(dependency.name);
      const resolvedVersion = entry?.version;

      let candidate = entry?.candidate;
      let kind: UpdateKind = entry?.kind ?? 'none';

      // Prereleases are a product-level policy, not an ecosystem one.
      if (candidate !== undefined && isPrerelease(candidate) && options.includePrereleases !== true) {
        candidate = undefined;
        kind = 'none';
      }
      if (candidate === resolvedVersion) {
        candidate = undefined;
        kind = 'none';
      }

      rows.push({
        id: `${project.manifestPath}#${dependency.name}`,
        name: dependency.name,
        project: project.name,
        manifestPath: project.manifestPath,
        declaredVersion: dependency.declaredVersion,
        ...(resolvedVersion === undefined ? {} : { resolvedVersion }),
        transitive: dependency.transitive,
        ...(candidate === undefined ? {} : { candidate }),
        kind,
        advisories: options.advisories?.get(dependency.name) ?? [],
      });
    }
  }

  rows.sort((left, right) => {
    if (left.project !== right.project) {
      return left.project.localeCompare(right.project);
    }
    return left.name.localeCompare(right.name);
  });

  const summaries = projects
    .map((project) => ({
      name: project.name,
      manifestPath: project.manifestPath,
      dependencyCount: project.dependencies.length,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return { projects: summaries, rows };
}
