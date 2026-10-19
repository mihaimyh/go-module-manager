import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assemblePanelModel,
  type Advisory,
  type AssembleOptions,
  type DependencyInput,
  type PanelModel,
  type ProjectInput,
  type ResolvedDependency,
} from '../../core/model';
import { parseGoModJson, parseModuleList, type ModuleListEntry } from './goJson';
import { classifyGoUpdate, isPseudoVersion } from './version';

/**
 * Reads a workspace from recorded `go` output instead of running the toolchain.
 * Layout: <root>/<project>/go.mod and <root>/<project>/__golden__/{mod-edit,mod-list}.json
 */
export function readRecordedWorkspace(
  root: string,
  options: AssembleOptions = {},
): PanelModel {
  const projects: ProjectInput[] = [];
  const resolved = new Map<string, readonly ResolvedDependency[]>();
  const advisories = new Map<string, readonly Advisory[]>();

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const directory = join(root, entry.name);
    const manifestPath = join(directory, 'go.mod');
    const goldenDirectory = join(directory, '__golden__');
    if (!existsSync(manifestPath) || !existsSync(goldenDirectory)) {
      continue;
    }

    const goMod = parseGoModJson(readFileSync(join(goldenDirectory, 'mod-edit.json'), 'utf8'));
    const projectName = goMod.Module?.Path;
    if (!projectName) {
      continue;
    }

    const dependencies = (goMod.Require ?? [])
      .map((require): DependencyInput | undefined => {
        if (!require.Path || !require.Version) {
          return undefined;
        }
        return {
          manifestPath,
          project: projectName,
          name: require.Path,
          declaredVersion: require.Version,
          transitive: require.Indirect === true,
        };
      })
      .filter((dependency) => dependency !== undefined);

    projects.push({ manifestPath, name: projectName, dependencies });

    resolved.set(
      manifestPath,
      parseModuleList(readFileSync(join(goldenDirectory, 'mod-list.json'), 'utf8'))
        .filter(hasVersion)
        .map(toResolvedDependency),
    );

    const advisoryFile = join(goldenDirectory, 'advisories.json');
    if (existsSync(advisoryFile)) {
      const recorded = JSON.parse(readFileSync(advisoryFile, 'utf8')) as Record<
        string,
        Advisory[]
      >;
      for (const [name, list] of Object.entries(recorded)) {
        advisories.set(name, list);
      }
    }
  }

  return assemblePanelModel(projects, resolved, { ...options, advisories });
}

function hasVersion(
  entry: ModuleListEntry,
): entry is ModuleListEntry & { Path: string; Version: string } {
  return typeof entry.Path === 'string' && typeof entry.Version === 'string';
}

function toResolvedDependency(
  entry: ModuleListEntry & { Path: string; Version: string },
): ResolvedDependency {
  const update = entry.Update?.Version;
  const candidate = update !== undefined && !isPseudoVersion(update) ? update : undefined;

  return {
    name: entry.Path,
    version: entry.Version,
    ...(candidate === undefined
      ? {}
      : { candidate, kind: classifyGoUpdate(entry.Version, candidate) }),
  };
}
