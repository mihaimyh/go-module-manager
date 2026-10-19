import { isPrerelease, type UpdateKind } from './version';

/** A published report that specific symbols in a version range are vulnerable. */
export interface Advisory {
  readonly id: string;
  readonly summary: string;
  readonly fixedIn?: string;
  /** True only when a call-graph scan found the vulnerable symbol reachable. */
  readonly reachable?: boolean;
  readonly symbol?: string;
  readonly packagePath?: string;
}

/** One resolved dependency to look up, independent of the project that declared it. */
export interface AdvisoryTarget {
  readonly name: string;
  readonly version: string;
}

/**
 * Advisories depend on the resolved version, so they are keyed by both. Keying
 * by name alone would mark one project's row because another project resolved
 * an affected version.
 */
export function advisoryKey(name: string, version: string): string {
  return `${name}@${version}`;
}

export interface AdvisoryReport {
  /** Keyed by `name@version`. */
  readonly matches: ReadonlyMap<string, readonly Advisory[]>;
  /** Targets skipped because their path is private. */
  readonly unchecked: ReadonlySet<string>;
  readonly fetchedAt?: string;
  readonly stale: boolean;
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
  /** The last failed update for this row, shown until the next read. */
  readonly failure?: string;
  /** True when the advisory lookup skipped this row because its path is private. */
  readonly advisoryUnchecked?: boolean;
}

export interface AdvisoryData {
  readonly fetchedAt: string;
  readonly stale: boolean;
}

/** What the ecosystem's resolver decided for one project. */
export interface ResolvedProject {
  readonly manifestPath: string;
  readonly dependencies: readonly ResolvedDependency[];
}

/** Why a project could not be read or resolved. Drives the one recovery action. */
export type FailureKind =
  | 'missing-lock-entry'
  | 'toolchain-missing'
  | 'auth-required'
  | 'network'
  | 'timeout'
  | 'unknown';

export interface ProjectFailure {
  readonly manifestPath: string;
  readonly projectName: string;
  readonly kind: FailureKind;
  readonly message: string;
}

export interface ProjectScan {
  readonly status: 'running' | 'complete' | 'failed';
  readonly at?: string;
  readonly message?: string;
}

export interface ProjectSummary {
  readonly name: string;
  readonly manifestPath: string;
  readonly dependencyCount: number;
  readonly failure?: ProjectFailure;
  readonly scan?: ProjectScan;
}

export interface PanelModel {
  readonly projects: readonly ProjectSummary[];
  readonly rows: readonly DependencyRow[];
  readonly advisoryData?: AdvisoryData;
}

export interface AssembleOptions {
  readonly includePrereleases?: boolean;
  readonly failures?: readonly ProjectFailure[];
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
      const selected = selectCandidate(entry, options.includePrereleases === true);

      rows.push({
        id: `${project.manifestPath}#${dependency.name}`,
        name: dependency.name,
        project: project.name,
        manifestPath: project.manifestPath,
        declaredVersion: dependency.declaredVersion,
        ...(entry?.version === undefined ? {} : { resolvedVersion: entry.version }),
        transitive: dependency.transitive,
        ...(selected.candidate === undefined ? {} : { candidate: selected.candidate }),
        kind: selected.kind,
        advisories: [],
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

  return { projects: withFailures(summaries, options.failures ?? []), rows };
}

/**
 * Attaches failures to the summaries they belong to and adds a summary for a
 * manifest that could not be read at all, so a broken project stays visible.
 */
function withFailures(
  summaries: readonly ProjectSummary[],
  failures: readonly ProjectFailure[],
): ProjectSummary[] {
  const result = summaries.map((summary) => {
    const failure = failures.find((entry) => entry.manifestPath === summary.manifestPath);
    return failure === undefined ? summary : { ...summary, failure };
  });

  for (const failure of failures) {
    if (!result.some((summary) => summary.manifestPath === failure.manifestPath)) {
      result.push({
        name: failure.projectName,
        manifestPath: failure.manifestPath,
        dependencyCount: 0,
        failure,
      });
    }
  }

  return result.sort((left, right) => left.name.localeCompare(right.name));
}

export function mergeFailure(model: PanelModel, failure: ProjectFailure): PanelModel {
  return { ...model, projects: withFailures(model.projects, [failure]) };
}

/**
 * Attaches matched advisories to rows whose version is known. A row that was
 * never resolved has no version to match, so it keeps an empty list.
 */
export function withAdvisories(model: PanelModel, report: AdvisoryReport): PanelModel {
  return {
    ...model,
    ...(report.fetchedAt === undefined
      ? {}
      : { advisoryData: { fetchedAt: report.fetchedAt, stale: report.stale } }),
    rows: model.rows.map((row) => {
      if (row.resolvedVersion === undefined) {
        return row;
      }
      const key = advisoryKey(row.name, row.resolvedVersion);
      return {
        ...row,
        advisories: report.matches.get(key) ?? [],
        advisoryUnchecked: report.unchecked.has(key),
      };
    }),
  };
}

/** Every distinct resolved dependency in the model, for one lookup. */
export function advisoryTargets(model: PanelModel): AdvisoryTarget[] {
  const seen = new Set<string>();
  const targets: AdvisoryTarget[] = [];

  for (const row of model.rows) {
    if (row.resolvedVersion === undefined) {
      continue;
    }
    const key = advisoryKey(row.name, row.resolvedVersion);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    targets.push({ name: row.name, version: row.resolvedVersion });
  }

  return targets;
}

/** A failed update stays on its row until the next read replaces the model. */
export function mergeRowFailure(
  model: PanelModel,
  manifestPath: string,
  name: string,
  message: string,
): PanelModel {
  return {
    ...model,
    rows: model.rows.map((row) =>
      row.manifestPath === manifestPath && row.name === name
        ? { ...row, failure: message }
        : row,
    ),
  };
}

/**
 * Merges one project's resolver output into an existing model: the rows of that
 * project gain their resolved version and candidate, everything else is
 * untouched. Used as lookups arrive one project at a time.
 */
export function mergeResolution(
  model: PanelModel,
  resolved: ResolvedProject,
  options: AssembleOptions = {},
): PanelModel {
  const byName = new Map(resolved.dependencies.map((entry) => [entry.name, entry]));

  return {
    ...model,
    projects: model.projects.map((project) =>
      project.manifestPath === resolved.manifestPath && project.failure !== undefined
        ? {
            name: project.name,
            manifestPath: project.manifestPath,
            dependencyCount: project.dependencyCount,
          }
        : project,
    ),
    rows: model.rows.map((row) => {
      if (row.manifestPath !== resolved.manifestPath) {
        return row;
      }
      const entry = byName.get(row.name);
      if (entry === undefined) {
        return row;
      }

      const selected = selectCandidate(entry, options.includePrereleases === true);

      return {
        id: row.id,
        name: row.name,
        project: row.project,
        manifestPath: row.manifestPath,
        declaredVersion: row.declaredVersion,
        resolvedVersion: entry.version,
        transitive: row.transitive,
        ...(selected.candidate === undefined ? {} : { candidate: selected.candidate }),
        kind: selected.kind,
        advisories: row.advisories,
      };
    }),
  };
}

/**
 * Prereleases are a product-level policy, not an ecosystem one. A candidate
 * equal to the resolved version is not an update.
 */
function selectCandidate(
  entry: ResolvedDependency | undefined,
  includePrereleases: boolean,
): { readonly candidate?: string; readonly kind: UpdateKind } {
  const candidate = entry?.candidate;
  if (candidate === undefined || candidate === entry?.version) {
    return { kind: 'none' };
  }
  if (!includePrereleases && isPrerelease(candidate)) {
    return { kind: 'none' };
  }
  return { candidate, kind: entry?.kind ?? 'none' };
}
