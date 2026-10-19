import { join } from 'node:path';
import {
  assemblePanelModel,
  type DependencyInput,
  type PanelModel,
  type ProjectInput,
} from '../../core/model';
import { findManifestDirectories } from '../discovery';
import { parseGoModJson, type GoModJson } from './goJson';
import { goEnv, type GoRunner } from './runner';

const READ_TIMEOUT_MS = 60_000;

/**
 * Reads the declared dependencies of every project in a workspace. Updates are
 * a separate, slower lookup; this only needs the manifest, so it is offline and
 * works before any download.
 */
export async function readWorkspace(
  workspaceRoot: string,
  runner: GoRunner,
): Promise<PanelModel> {
  const directories = findManifestDirectories(workspaceRoot, 'go.mod');

  const attempts = await Promise.all(
    directories.map(async (directory) => ({
      directory,
      result: await runner.run(['mod', 'edit', '-json'], {
        cwd: directory,
        env: goEnv(),
        timeoutMs: READ_TIMEOUT_MS,
      }),
    })),
  );

  const projects: ProjectInput[] = [];
  const failures: string[] = [];

  for (const { directory, result } of attempts) {
    if (result.exitCode !== 0) {
      failures.push(`${directory}: ${firstLine(result.stderr)}`);
      continue;
    }

    const goMod = parseGoModJson(result.stdout);
    const name = goMod.Module?.Path;
    if (!name) {
      failures.push(`${directory}: go.mod has no module path`);
      continue;
    }

    projects.push(toProject(directory, name, goMod));
  }

  if (projects.length === 0) {
    throw new Error(
      failures.length > 0
        ? `Could not read any go.mod. ${failures[0]}`
        : 'No go.mod found in this workspace.',
    );
  }

  // No resolved versions yet: this ticket reads declarations only.
  return assemblePanelModel(projects, new Map());
}

function toProject(directory: string, name: string, goMod: GoModJson): ProjectInput {
  const manifestPath = join(directory, 'go.mod');

  const dependencies = (goMod.Require ?? [])
    .map((require): DependencyInput | undefined => {
      if (!require.Path || !require.Version) {
        return undefined;
      }
      return {
        manifestPath,
        project: name,
        name: require.Path,
        declaredVersion: require.Version,
        transitive: require.Indirect === true,
      };
    })
    .filter((dependency) => dependency !== undefined);

  return { manifestPath, name, dependencies };
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim() !== '');
  return line?.trim() ?? 'go mod edit failed';
}
