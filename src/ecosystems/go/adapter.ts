import type { EcosystemAdapter } from '../../core/adapter';
import { readRecordedWorkspace } from './fixture';

/**
 * The Go adapter. `read` consumes recorded toolchain output until the runner
 * lands; the interface is the shape the real runner will keep.
 */
export const goAdapter: EcosystemAdapter = {
  id: 'go',
  label: 'Go',
  manifestFile: 'go.mod',
  read: async (workspaceRoot) => readRecordedWorkspace(workspaceRoot),
};
