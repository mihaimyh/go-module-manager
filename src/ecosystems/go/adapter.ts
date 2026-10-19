import type { EcosystemAdapter } from '../../core/adapter';
import { downloadModules } from './download';
import { readWorkspace } from './read';
import { createProjectResolver } from './resolve';
import { createExecGoRunner, type GoRunner } from './runner';

export function createGoAdapter(runner: GoRunner): EcosystemAdapter {
  const resolver = createProjectResolver(runner);

  return {
    id: 'go',
    label: 'Go',
    manifestFile: 'go.mod',
    read: (workspaceRoot) => readWorkspace(workspaceRoot, runner),
    resolve: (manifestPath, options) => resolver.resolve(manifestPath, options),
    repair: (manifestPath) => downloadModules(manifestPath, runner),
    toolchainUrl: 'https://go.dev/dl/',
  };
}

export const goAdapter: EcosystemAdapter = createGoAdapter(createExecGoRunner());
