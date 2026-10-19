import { basename, join } from 'node:path';
import {
  assemblePanelModel,
  type DependencyInput,
  type PanelModel,
  type ProjectFailure,
  type ProjectInput,
} from '../../core/model';
import { findManifestDirectories } from '../discovery';
import { failureKindFor, GoCommandError } from './errors';
import { parseGoModJson, type GoModJson } from './goJson';
import { goEnv, type GoRunner } from './runner';

const READ_TIMEOUT_MS = 60_000;

/**
 * Reads the declared dependencies of every project in a workspace. A project
 * that cannot be read is kept as a summary carrying its failure, so it never
 * hides the healthy projects. Only an empty workspace throws.
 */
export async function readWorkspace(
  workspaceRoot: string,
  runner: GoRunner,
): Promise<PanelModel> {
  const directories = findManifestDirectories(workspaceRoot, 'go.mod');
  if (directories.length === 0) {
    throw new GoCommandError('unknown', 'No go.mod found in this workspace.');
  }

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
  const failures: ProjectFailure[] = [];

  for (const { directory, result } of attempts) {
    const manifestPath = join(directory, 'go.mod');

    if (result.exitCode !== 0) {
      const kind = failureKindFor(result.exitCode, result.stderr);
      failures.push({
        manifestPath,
        projectName: basename(directory),
        kind,
        message:
          kind === 'timeout'
            ? `The go command timed out after ${READ_TIMEOUT_MS / 1000}s.`
            : messageOf(result.stderr, 'go mod edit failed'),
      });
      continue;
    }

    const goMod = parseGoModJson(result.stdout);
    const name = goMod.Module?.Path;
    if (!name) {
      failures.push({
        manifestPath,
        projectName: basename(directory),
        kind: 'unknown',
        message: 'go.mod has no module path',
      });
      continue;
    }

    projects.push(toProject(directory, name, goMod));
  }

  // No resolved versions yet: this ticket reads declarations only.
  return assemblePanelModel(projects, new Map(), { failures });
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

function messageOf(stderr: string, fallback: string): string {
  const text = stderr.trim();
  if (text === '') {
    return fallback;
  }
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}
