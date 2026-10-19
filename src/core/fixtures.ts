import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGoModJson, parseModuleList } from './goJson';
import {
  assemblePanelModel,
  requirementFromGoMod,
  type Advisory,
  type AssembleOptions,
  type ModuleFile,
  type PanelModel,
} from './model';

/**
 * Reads a workspace from recorded `go` output instead of running the toolchain.
 * Layout: <root>/<module>/go.mod and <root>/<module>/__golden__/{mod-edit,mod-list}.json
 */
export function loadFixtureWorkspace(
  root: string,
  options: AssembleOptions = {},
): PanelModel {
  const files: ModuleFile[] = [];
  const buildLists = new Map<string, ReturnType<typeof parseModuleList>>();
  const advisories = new Map<string, readonly Advisory[]>();

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const moduleDirectory = join(root, entry.name);
    const goModPath = join(moduleDirectory, 'go.mod');
    const goldenDirectory = join(moduleDirectory, '__golden__');
    if (!existsSync(goModPath) || !existsSync(goldenDirectory)) {
      continue;
    }

    const goMod = parseGoModJson(readFileSync(join(goldenDirectory, 'mod-edit.json'), 'utf8'));
    const modulePath = goMod.Module?.Path;
    if (!modulePath) {
      continue;
    }

    const requirements = (goMod.Require ?? [])
      .map((require) => requirementFromGoMod(goModPath, modulePath, require))
      .filter((requirement) => requirement !== undefined);

    files.push({ goModPath, modulePath, requirements });
    buildLists.set(
      goModPath,
      parseModuleList(readFileSync(join(goldenDirectory, 'mod-list.json'), 'utf8')),
    );

    const advisoryFile = join(goldenDirectory, 'advisories.json');
    if (existsSync(advisoryFile)) {
      const recorded = JSON.parse(readFileSync(advisoryFile, 'utf8')) as Record<
        string,
        Advisory[]
      >;
      for (const [path, list] of Object.entries(recorded)) {
        advisories.set(path, list);
      }
    }
  }

  return assemblePanelModel(files, buildLists, { ...options, advisories });
}
