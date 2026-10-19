import type { EcosystemAdapter } from '../../core/adapter';
import type { AdvisoryReport, AdvisoryTarget } from '../../core/model';
import type { AdvisorySource } from './advisory';
import { cleanChecksumCache } from './checksum';
import { downloadModules } from './download';
import { readWorkspace } from './read';
import { createProjectResolver } from './resolve';
import { createExecGoRunner, type GoRunner } from './runner';
import { installScanner, scanProject } from './scan';
import { tidyProject } from './tidy';
import { previewUpdate } from './preview';
import { createUpdater } from './update';
import { createVersionsFetcher } from './versions';
import { whyModule } from './why';

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
  const versions = createVersionsFetcher({ runner });

  return {
    id: 'go',
    label: 'Go',
    manifestFile: 'go.mod',
    read: (workspaceRoot) => readWorkspace(workspaceRoot, runner),
    resolve: (manifestPath, resolveOptions) =>
      resolver.resolve(manifestPath, resolveOptions),
    repair: (manifestPath) => downloadModules(manifestPath, runner),
    cleanChecksumCache: () => cleanChecksumCache(runner),
    update: (request) => updater.update(request),
    undo: (manifestPath) => updater.undo(manifestPath),
    tidy: (manifestPath) => tidyProject(manifestPath, runner),
    scan: (manifestPath) => scanProject(manifestPath, runner),
    installScanner: () => installScanner(process.cwd(), runner),
    versions: (modulePath) => versions.fetch(modulePath),
    why: (manifestPath, name) => whyModule(manifestPath, name, runner),
    preview: (request) => previewUpdate(request, runner),
    toolchainUrl: 'https://go.dev/dl/',
    ...(source === undefined
      ? {}
      : {
          advisories: (
            targets: readonly AdvisoryTarget[],
            options?: { readonly fresh?: boolean },
          ): Promise<AdvisoryReport> => source.lookup(targets, options),
        }),
  };
}

export const goAdapter: EcosystemAdapter = createGoAdapter(createExecGoRunner());
