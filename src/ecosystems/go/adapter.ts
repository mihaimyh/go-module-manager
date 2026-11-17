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
import { createPrivateMatcher } from './private';
import { createModuleSearcher, fetchModuleMetadata } from './search';
import { readManifestMeta } from './manifestMeta';
import { createUpdater } from './update';
import { isVendored, vendorProject } from './vendor';
import { createVersionsFetcher } from './versions';
import { whyModule } from './why';

export interface GoAdapterOptions {
  readonly advisories?: AdvisorySource;
  readonly fetchJson?: (url: string) => Promise<unknown>;
}

const FETCH_TIMEOUT_SECONDS = 15;

function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function defaultFetchJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'go-module-manager',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_SECONDS * 1_000),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    ) {
      throw new Error(`${hostLabel(url)} timed out after ${FETCH_TIMEOUT_SECONDS}s`);
    }
    throw error;
  }
  if (!response.ok) {
    throw new Error(`${hostLabel(url)} returned ${response.status}`);
  }
  return response.json();
}

export function createGoAdapter(
  runner: GoRunner,
  options: GoAdapterOptions = {},
): EcosystemAdapter {
  // Last workspace root passed to `read`, so later `go env` / `go list` use it.
  let workspaceRoot: string | undefined;
  const getWorkspaceRoot = (): string | undefined => workspaceRoot;
  const resolver = createProjectResolver(runner);
  const updater = createUpdater(runner);
  const source = options.advisories;
  const versions = createVersionsFetcher({ runner, getWorkspaceRoot });
  const privateMatcher = createPrivateMatcher(runner, getWorkspaceRoot);
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  const searcher = createModuleSearcher({
    fetchJson,
    isPrivate: (modulePath) => privateMatcher.isPrivate(modulePath),
    fetchVersions: (modulePath) => versions.fetch(modulePath),
  });

  return {
    id: 'go',
    label: 'Go',
    manifestFile: 'go.mod',
    read: (roots) => {
      workspaceRoot = typeof roots === 'string' ? roots : roots[0];
      return readWorkspace(roots, runner);
    },
    resolve: (manifestPath, resolveOptions) =>
      resolver.resolve(manifestPath, resolveOptions),
    repair: (manifestPath) => downloadModules(manifestPath, runner),
    cleanChecksumCache: () => cleanChecksumCache(runner),
    update: (request) => updater.update(request),
    undo: (manifestPath) => updater.undo(manifestPath),
    tidy: async (manifestPath) => {
      updater.snapshot(manifestPath);
      await tidyProject(manifestPath, runner);
    },
    isVendored: (manifestPath) => isVendored(manifestPath),
    vendor: (manifestPath) => vendorProject(manifestPath, runner),
    manifestMeta: (manifestPath) => readManifestMeta(manifestPath, runner),
    scan: (manifestPath) => scanProject(manifestPath, runner),
    installScanner: () => installScanner(process.cwd(), runner),
    versions: (modulePath) => versions.fetch(modulePath),
    why: (manifestPath, name) => whyModule(manifestPath, name, runner),
    preview: (request) => previewUpdate(request, runner),
    search: (query, searchOptions) => searcher.search(query, searchOptions),
    moduleMetadata: (modulePath, version) =>
      fetchModuleMetadata(modulePath, version, fetchJson, (path) =>
        privateMatcher.isPrivate(path),
      ),
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
