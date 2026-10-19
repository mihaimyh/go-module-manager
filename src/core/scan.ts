import type { Advisory, PanelModel, ProjectScan } from './model';

export interface CallGraphFinding {
  readonly id: string;
  readonly symbol?: string;
  readonly packagePath?: string;
}

/**
 * Records the scan lifecycle on one project. Starting or failing a scan clears
 * the previous reachability, so a stale red chip cannot survive a rescan.
 * "not-run" is the absence of a scan on the project.
 */
export function markScan(
  model: PanelModel,
  manifestPath: string,
  scan: ProjectScan,
): PanelModel {
  return {
    ...model,
    projects: model.projects.map((project) =>
      project.manifestPath === manifestPath ? { ...project, scan } : project,
    ),
    ...(scan.status === 'running' || scan.status === 'failed'
      ? { rows: resetReachability(model, manifestPath).rows }
      : {}),
  };
}

export function applyScan(
  model: PanelModel,
  manifestPath: string,
  findings: readonly CallGraphFinding[],
  at: string,
): PanelModel {
  const byId = new Map<string, CallGraphFinding>();
  for (const finding of findings) {
    if (!byId.has(finding.id)) {
      byId.set(finding.id, finding);
    }
  }

  const reset = resetReachability(model, manifestPath);

  return {
    ...markScan(reset, manifestPath, { status: 'complete', at }),
    rows: reset.rows.map((row) => {
      if (row.manifestPath !== manifestPath || row.advisories.length === 0) {
        return row;
      }
      return {
        ...row,
        advisories: row.advisories.map((advisory) => {
          const finding = byId.get(advisory.id);
          return finding === undefined ? advisory : reachable(advisory, finding);
        }),
      };
    }),
  };
}

/** True when any advisory in the model is reachable from the project's code. */
export function hasReachable(model: PanelModel): boolean {
  return model.rows.some((row) => row.advisories.some((advisory) => advisory.reachable === true));
}

function resetReachability(model: PanelModel, manifestPath: string): PanelModel {
  return {
    ...model,
    rows: model.rows.map((row) => {
      if (row.manifestPath !== manifestPath || !row.advisories.some((a) => a.reachable)) {
        return row;
      }
      return {
        ...row,
        advisories: row.advisories.map((advisory) => withoutReachability(advisory)),
      };
    }),
  };
}

function withoutReachability(advisory: Advisory): Advisory {
  const { reachable, symbol, packagePath, ...rest } = advisory;
  void reachable;
  void symbol;
  void packagePath;
  return rest;
}

function reachable(advisory: Advisory, finding: CallGraphFinding): Advisory {
  return {
    ...advisory,
    reachable: true,
    ...(finding.symbol === undefined ? {} : { symbol: finding.symbol }),
    ...(finding.packagePath === undefined ? {} : { packagePath: finding.packagePath }),
  };
}
