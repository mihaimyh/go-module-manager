import {
  mergeFailure,
  mergeResolution,
  type FailureKind,
  type PanelModel,
  type ResolvedProject,
} from './model';

export interface ResolveFailure {
  readonly manifestPath: string;
  readonly projectName: string;
  readonly kind: FailureKind;
  readonly message: string;
}

export interface ResolveReport {
  readonly done: number;
  readonly total: number;
  readonly model: PanelModel;
  readonly failure?: ResolveFailure;
}

export interface ResolveProjectsOptions {
  readonly concurrency?: number;
  readonly fresh?: boolean;
  readonly includePrereleases?: boolean;
}

const DEFAULT_CONCURRENCY = 4;

/**
 * Runs one resolver per project with a small pool, merging each result into the
 * model as it arrives. A failing project is reported and skipped; it never
 * removes the other projects.
 */
export async function resolveProjects(
  model: PanelModel,
  resolve: (
    manifestPath: string,
    options: { readonly fresh?: boolean },
  ) => Promise<ResolvedProject>,
  onProgress: (report: ResolveReport) => void,
  options: ResolveProjectsOptions = {},
): Promise<PanelModel> {
  const projects = model.projects;
  const total = projects.length;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, total));

  let current = model;
  let done = 0;
  let next = 0;

  if (total === 0) {
    return current;
  }

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const project = projects[index];
      if (project === undefined) {
        return;
      }

      try {
        const resolved = await resolve(project.manifestPath, { fresh: options.fresh });
        current = mergeResolution(current, resolved, {
          ...(options.includePrereleases === undefined
            ? {}
            : { includePrereleases: options.includePrereleases }),
        });
        done += 1;
        onProgress({ done, total, model: current });
      } catch (error) {
        const failure: ResolveFailure = {
          manifestPath: project.manifestPath,
          projectName: project.name,
          kind: failureKind(error),
          message: error instanceof Error ? error.message : String(error),
        };
        current = mergeFailure(current, failure);
        done += 1;
        onProgress({ done, total, model: current, failure });
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return current;
}

const KNOWN_KINDS: readonly FailureKind[] = [
  'missing-lock-entry',
  'toolchain-missing',
  'auth-required',
  'network',
  'verification',
  'timeout',
  'unknown',
];

/** Ecosystems signal a kind on the error; anything else is unknown. */
function failureKind(error: unknown): FailureKind {
  const kind = (error as { kind?: unknown } | null)?.kind;
  return KNOWN_KINDS.find((candidate) => candidate === kind) ?? 'unknown';
}
