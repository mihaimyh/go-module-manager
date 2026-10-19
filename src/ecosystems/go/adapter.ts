import type { EcosystemAdapter } from '../../core/adapter';
import { readWorkspace } from './read';
import { createProjectResolver } from './resolve';
import { execGoRunner, type GoRunner } from './runner';

export function createGoAdapter(runner: GoRunner): EcosystemAdapter {
  const resolver = createProjectResolver(runner);

  return {
    id: 'go',
    label: 'Go',
    manifestFile: 'go.mod',
    read: (workspaceRoot) => readWorkspace(workspaceRoot, runner),
    resolve: (manifestPath, options) => resolver.resolve(manifestPath, options),
  };
}

export const goAdapter: EcosystemAdapter = createGoAdapter(execGoRunner);
