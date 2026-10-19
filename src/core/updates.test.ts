import { describe, expect, it } from 'vitest';
import type { PanelModel, ResolvedProject } from './model';
import { mergeResolution } from './model';
import { resolveProjects, type ResolveReport } from './updates';

function emptyModel(manifests: readonly string[]): PanelModel {
  return {
    projects: manifests.map((manifestPath, index) => ({
      name: `example.com/p${index}`,
      manifestPath,
      dependencyCount: 0,
    })),
    rows: [],
  };
}

describe('resolveProjects', () => {
  it('resolves every project and reports progress as each one finishes', async () => {
    const manifests = ['/repo/a/go.mod', '/repo/b/go.mod', '/repo/c/go.mod'];
    const reports: ResolveReport[] = [];
    let inFlight = 0;
    let peak = 0;

    const model = await resolveProjects(
      emptyModel(manifests),
      async (manifestPath) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        return { manifestPath, dependencies: [] };
      },
      (report) => reports.push(report),
      { concurrency: 2 },
    );

    expect(peak).toBeLessThanOrEqual(2);
    expect(reports.map((report) => report.done)).toEqual([1, 2, 3]);
    expect(reports.every((report) => report.total === 3)).toBe(true);
    expect(model.projects).toHaveLength(3);
  });

  it('keeps going when one project fails and reports which one', async () => {
    const manifests = ['/repo/a/go.mod', '/repo/b/go.mod', '/repo/c/go.mod'];
    const reports: ResolveReport[] = [];

    const model = await resolveProjects(
      emptyModel(manifests),
      async (manifestPath) => {
        if (manifestPath === '/repo/b/go.mod') {
          throw new Error('missing go.sum entry');
        }
        return { manifestPath, dependencies: [] };
      },
      (report) => reports.push(report),
      { concurrency: 1 },
    );

    expect(reports).toHaveLength(3);
    expect(reports.filter((report) => report.failure !== undefined)).toEqual([
      expect.objectContaining({
        failure: {
          manifestPath: '/repo/b/go.mod',
          projectName: 'example.com/p1',
          kind: 'unknown',
          message: 'missing go.sum entry',
        },
      }),
    ]);
    expect(
      model.projects.find((project) => project.name === 'example.com/p1')?.failure?.kind,
    ).toBe('unknown');
    expect(model.projects).toHaveLength(3);
  });

  it('merges a resolved project into the model before reporting it', async () => {
    const manifestPath = '/repo/a/go.mod';
    const model: PanelModel = {
      projects: [{ name: 'example.com/a', manifestPath, dependencyCount: 1 }],
      rows: [
        {
          id: `${manifestPath}#rsc.io/quote`,
          name: 'rsc.io/quote',
          project: 'example.com/a',
          manifestPath,
          declaredVersion: 'v1.5.1',
          transitive: false,
          kind: 'none',
          advisories: [],
        },
      ],
    };

    const seen: PanelModel[] = [];
    await resolveProjects(
      model,
      async (path): Promise<ResolvedProject> => ({
        manifestPath: path,
        dependencies: [{ name: 'rsc.io/quote', version: 'v1.5.2', candidate: 'v1.6.0', kind: 'minor' }],
      }),
      (report) => seen.push(report.model),
      { concurrency: 1 },
    );

    expect(seen[0]?.rows[0]?.resolvedVersion).toBe('v1.5.2');
    expect(seen[0]?.rows[0]?.candidate).toBe('v1.6.0');
    expect(mergeResolution(model, { manifestPath, dependencies: [] }).rows[0]?.resolvedVersion).toBeUndefined();
  });
});
