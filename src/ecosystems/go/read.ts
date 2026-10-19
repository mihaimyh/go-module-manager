import { basename, join } from 'node:path';
import {
  assemblePanelModel,
  type DependencyInput,
  type ModuleReplacement,
  type PanelModel,
  type ProjectFailure,
  type ProjectInput,
} from '../../core/model';
import { findManifestDirectories } from '../discovery';
import { failureKindFor, GoCommandError } from './errors';
import { parseGoModJson, type GoModJson, type GoModRequire } from './goJson';
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
      const replacement = replacementFor(require, goMod);
      return {
        manifestPath,
        project: name,
        name: require.Path,
        declaredVersion: require.Version,
        transitive: require.Indirect === true,
        ...(replacement === undefined ? {} : { replacement }),
      };
    })
    .filter((dependency) => dependency !== undefined);

  return { manifestPath, name, dependencies };
}

/**
 * A replace can pin one version (`replace a v1 => b v2`) or every version
 * (`replace a => b v2`); the exact pin wins over the wildcard.
 */
function replacementFor(
  require: GoModRequire,
  goMod: GoModJson,
): ModuleReplacement | undefined {
  const candidates = (goMod.Replace ?? []).filter(
    (entry) => entry.Old?.Path === require.Path,
  );
  const exact = candidates.find((entry) => entry.Old?.Version === require.Version);
  const wildcard = candidates.find((entry) => entry.Old?.Version === undefined);
  const target = (exact ?? wildcard)?.New;
  if (target?.Path === undefined) {
    return undefined;
  }
  return target.Version === undefined
    ? { path: target.Path }
    : { path: target.Path, version: target.Version };
}

function messageOf(stderr: string, fallback: string): string {
  const text = stderr.trim();
  if (text === '') {
    return fallback;
  }
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}
