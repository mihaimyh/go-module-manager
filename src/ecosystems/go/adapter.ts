import type { EcosystemAdapter } from '../../core/adapter';
import { readWorkspace } from './read';
import { execGoRunner, type GoRunner } from './runner';

export function createGoAdapter(runner: GoRunner): EcosystemAdapter {
  return {
    id: 'go',
    label: 'Go',
    manifestFile: 'go.mod',
    read: (workspaceRoot) => readWorkspace(workspaceRoot, runner),
  };
}

export const goAdapter: EcosystemAdapter = createGoAdapter(execGoRunner);
