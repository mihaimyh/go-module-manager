import type { Advisory, PanelModel, ProjectScan } from './model';

export interface ScanFinding {
  readonly id: string;
  readonly symbol?: string;
  readonly package?: string;
}

/**
 * Records the scan lifecycle on one project. Findings are only ever applied to
 * advisories the module-level lookup already returned: a scan cannot invent a
 * badge, it can only upgrade one.
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
  };
}

export function applyScan(
  model: PanelModel,
  manifestPath: string,
  findings: readonly ScanFinding[],
  at: string,
): PanelModel {
  const byId = new Map<string, ScanFinding>();
  for (const finding of findings) {
    if (!byId.has(finding.id)) {
      byId.set(finding.id, finding);
    }
  }

  return {
    ...markScan(model, manifestPath, { status: 'complete', at }),
    rows: model.rows.map((row) => {
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

function reachable(advisory: Advisory, finding: ScanFinding): Advisory {
  return {
    ...advisory,
    reachable: true,
    ...(finding.symbol === undefined ? {} : { symbol: finding.symbol }),
    ...(finding.package === undefined ? {} : { package: finding.package }),
  };
}
