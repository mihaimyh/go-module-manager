import type { EcosystemAdapter } from '../../core/adapter';
import type { Advisory, AdvisoryTarget } from '../../core/model';
import type { AdvisorySource } from './advisory';
import { downloadModules } from './download';
import { readWorkspace } from './read';
import { createProjectResolver } from './resolve';
import { createExecGoRunner, type GoRunner } from './runner';
import { tidyProject } from './tidy';
import { createUpdater } from './update';

export interface GoAdapterOptions {
  readonly advisories?: AdvisorySource;
}

export function createGoAdapter(
  runner: GoRunner,
  options: GoAdapterOptions = {},
): EcosystemAdapter {
  const resolver = createProjectResolver(runner);
  const updater = createUpdater(runner);
  const source = options.advisories;

  return {
    id: 'go',
    label: 'Go',
    manifestFile: 'go.mod',
    read: (workspaceRoot) => readWorkspace(workspaceRoot, runner),
    resolve: (manifestPath, resolveOptions) =>
      resolver.resolve(manifestPath, resolveOptions),
    repair: (manifestPath) => downloadModules(manifestPath, runner),
    update: (request) => updater.update(request),
    undo: (manifestPath) => updater.undo(manifestPath),
    tidy: (manifestPath) => tidyProject(manifestPath, runner),
    toolchainUrl: 'https://go.dev/dl/',
    ...(source === undefined
      ? {}
      : {
          advisories: (
            targets: readonly AdvisoryTarget[],
          ): Promise<ReadonlyMap<string, readonly Advisory[]>> => source.lookup(targets),
        }),
  };
}

export const goAdapter: EcosystemAdapter = createGoAdapter(createExecGoRunner());
