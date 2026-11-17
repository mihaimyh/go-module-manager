import type {
  ModuleMetadata,
  SearchOptions,
  SearchResponse,
  SearchResult,
} from '../../core/adapter';

const DEFAULT_LIMIT = 25;
const POPULAR_CONCURRENCY = 4;

const THREE_SEGMENT_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org']);

interface PopularModuleSeed {
  readonly modulePath: string;
  readonly packagePath: string;
}

/**
 * `pkg.go.dev/v1/search` rejects empty `q` (HTTP 400) and times out / 500s on
 * ultra-broad queries like `q=github.com`. Seed an empty Browse query with
 * live metadata from `pkg.go.dev/v1/package/{path}` instead.
 */
export const POPULAR_MODULES: readonly PopularModuleSeed[] = [
  { modulePath: 'google.golang.org/grpc', packagePath: 'google.golang.org/grpc' },
  { modulePath: 'github.com/sirupsen/logrus', packagePath: 'github.com/sirupsen/logrus' },
  { modulePath: 'github.com/spf13/cobra', packagePath: 'github.com/spf13/cobra' },
  { modulePath: 'github.com/gin-gonic/gin', packagePath: 'github.com/gin-gonic/gin' },
  { modulePath: 'go.uber.org/zap', packagePath: 'go.uber.org/zap' },
  { modulePath: 'github.com/google/uuid', packagePath: 'github.com/google/uuid' },
  { modulePath: 'gorm.io/gorm', packagePath: 'gorm.io/gorm' },
  {
    modulePath: 'github.com/prometheus/client_golang',
    packagePath: 'github.com/prometheus/client_golang/prometheus',
  },
  { modulePath: 'golang.org/x/oauth2', packagePath: 'golang.org/x/oauth2' },
  { modulePath: 'golang.org/x/crypto', packagePath: 'golang.org/x/crypto/bcrypt' },
  { modulePath: 'gopkg.in/yaml.v3', packagePath: 'gopkg.in/yaml.v3' },
  {
    modulePath: 'google.golang.org/protobuf',
    packagePath: 'google.golang.org/protobuf/proto',
  },
  { modulePath: 'github.com/rs/zerolog', packagePath: 'github.com/rs/zerolog' },
  { modulePath: 'golang.org/x/sync', packagePath: 'golang.org/x/sync/errgroup' },
  {
    modulePath: 'github.com/stretchr/testify',
    packagePath: 'github.com/stretchr/testify/assert',
  },
  { modulePath: 'github.com/go-chi/chi/v5', packagePath: 'github.com/go-chi/chi/v5' },
  { modulePath: 'golang.org/x/time', packagePath: 'golang.org/x/time/rate' },
  { modulePath: 'go.opentelemetry.io/otel', packagePath: 'go.opentelemetry.io/otel' },
  { modulePath: 'golang.org/x/net', packagePath: 'golang.org/x/net/html' },
  { modulePath: 'github.com/jackc/pgx/v5', packagePath: 'github.com/jackc/pgx/v5' },
];

export interface ModuleSearcherOptions {
  readonly fetchJson: (url: string) => Promise<unknown>;
  readonly isPrivate: (modulePath: string) => Promise<boolean>;
  readonly fetchVersions: (modulePath: string) => Promise<readonly string[]>;
}

export interface ModuleSearcher {
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
}

interface RawModuleHit {
  readonly path?: unknown;
  readonly packagePath?: unknown;
  readonly modulePath?: unknown;
  readonly version?: unknown;
  readonly synopsis?: unknown;
  readonly importedByCounts?: {
    readonly packages?: unknown;
  };
}

interface RawSearchResponse {
  readonly items?: unknown;
  readonly nextPageToken?: unknown;
}

export function createModuleSearcher(options: ModuleSearcherOptions): ModuleSearcher {
  let popularCache: Promise<readonly SearchResult[]> | undefined;

  const getPopular = (): Promise<readonly SearchResult[]> => {
    if (popularCache !== undefined) {
      return popularCache;
    }
    const pending = loadPopularModules(options);
    popularCache = pending;
    void pending.catch(() => {
      if (popularCache === pending) {
        popularCache = undefined;
      }
    });
    return pending;
  };

  return {
    async search(rawQuery, searchOptions = {}) {
      const query = rawQuery.trim();
      const limit = searchOptions.limit ?? DEFAULT_LIMIT;

      // Empty and bare `github.com` both use the curated starter list: /v1/search
      // rejects empty `q` and times out on `q=github.com`.
      if (query === '' || isBareGitHubHost(query)) {
        const popular = await getPopular();
        return {
          query,
          items: popular.slice(0, limit),
        };
      }

      if (await safeIsPrivate(options.isPrivate, query)) {
        const versions = looksLikeModulePath(query)
          ? await safeFetchVersions(options.fetchVersions, query)
          : [];
        const latest = versions[0];
        return {
          query,
          items:
            latest === undefined
              ? []
              : [{ name: query, version: latest, summary: '', private: true }],
        };
      }

      const params = new URLSearchParams({
        q: query,
        limit: String(limit),
      });
      if (searchOptions.pageToken !== undefined && searchOptions.pageToken !== '') {
        params.set('token', searchOptions.pageToken);
      }

      const raw = (await options.fetchJson(
        `https://pkg.go.dev/v1/search?${params.toString()}`,
      )) as RawSearchResponse | null;

      const items = parseSearchItems(raw?.items);
      const nextPageToken =
        typeof raw?.nextPageToken === 'string' && raw.nextPageToken !== ''
          ? raw.nextPageToken
          : undefined;

      if (items.length === 0 && looksLikeModulePath(query)) {
        const versions = await safeFetchVersions(options.fetchVersions, query);
        const latest = versions[0];
        if (latest !== undefined) {
          return {
            query,
            items: [{ name: query, version: latest, summary: '' }],
          };
        }
      }

      return {
        query,
        items,
        ...(nextPageToken === undefined ? {} : { nextPageToken }),
      };
    },
  };
}

function isBareGitHubHost(query: string): boolean {
  return query.replace(/\/+$/, '').toLowerCase() === 'github.com';
}

export function looksLikeModulePath(query: string): boolean {
  if (
    /\s/.test(query) ||
    query.startsWith('/') ||
    query.endsWith('/') ||
    query.includes('//')
  ) {
    return false;
  }
  const segments = query.split('/');
  const host = segments[0]?.toLowerCase() ?? '';
  if (!host.includes('.')) {
    return false;
  }
  const minSegments = THREE_SEGMENT_HOSTS.has(host) ? 3 : 2;
  return segments.length >= minSegments && segments.every((segment) => segment !== '');
}

function looksLikeHostPath(query: string): boolean {
  if (/\s/.test(query) || !query.includes('/')) {
    return false;
  }
  const firstSegment = query.split('/')[0] ?? '';
  return firstSegment.includes('.');
}

async function loadPopularModules(
  options: ModuleSearcherOptions,
): Promise<readonly SearchResult[]> {
  const publicSeeds: PopularModuleSeed[] = [];
  for (const seed of POPULAR_MODULES) {
    if (!(await safeIsPrivate(options.isPrivate, seed.modulePath))) {
      publicSeeds.push(seed);
    }
  }
  if (publicSeeds.length === 0) {
    return [];
  }

  const resolved: (SearchResult | undefined)[] = new Array(publicSeeds.length);
  let nextIndex = 0;
  let firstError: unknown;

  const worker = async (): Promise<void> => {
    while (nextIndex < publicSeeds.length) {
      const index = nextIndex;
      nextIndex += 1;
      const seed = publicSeeds[index];
      if (seed === undefined) {
        continue;
      }
      const params = new URLSearchParams({
        'imported-by-counts': 'true',
        module: seed.modulePath,
      });
      try {
        const raw = (await options.fetchJson(
          `https://pkg.go.dev/v1/package/${seed.packagePath}?${params.toString()}`,
        )) as RawModuleHit | null;
        resolved[index] = parsePackageInfo(raw, seed);
      } catch (error) {
        firstError ??= error;
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(POPULAR_CONCURRENCY, publicSeeds.length) },
    () => worker(),
  );
  await Promise.all(workers);

  const items = resolved.filter((item): item is SearchResult => item !== undefined);
  if (items.length === 0 && firstError !== undefined) {
    throw firstError;
  }

  return [...items].sort(
    (left, right) => (right.importedBy ?? -1) - (left.importedBy ?? -1),
  );
}

function parsePackageInfo(
  raw: RawModuleHit | null,
  seed: PopularModuleSeed,
): SearchResult | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const version = typeof raw.version === 'string' ? raw.version.trim() : '';
  if (version === '') {
    return undefined;
  }
  return toSearchResult({
    modulePath:
      typeof raw.modulePath === 'string' && raw.modulePath.trim() !== ''
        ? raw.modulePath.trim()
        : seed.modulePath,
    packagePath:
      typeof raw.path === 'string' && raw.path.trim() !== ''
        ? raw.path.trim()
        : seed.packagePath,
    version,
    summary: typeof raw.synopsis === 'string' ? raw.synopsis.trim() : '',
    importedBy: importedByCount(raw.importedByCounts?.packages),
  });
}

function toSearchResult(fields: {
  readonly modulePath: string;
  readonly packagePath: string;
  readonly version: string;
  readonly summary: string;
  readonly importedBy?: number;
}): SearchResult {
  return {
    name: fields.modulePath,
    version: fields.version,
    summary: fields.summary,
    ...(fields.packagePath !== '' && fields.packagePath !== fields.modulePath
      ? { matchedPackage: fields.packagePath }
      : {}),
    ...(fields.importedBy === undefined ? {} : { importedBy: fields.importedBy }),
  };
}

function importedByCount(value: unknown): number | undefined {
  return typeof value === 'number' && value >= 0 ? value : undefined;
}

async function safeIsPrivate(
  isPrivate: (modulePath: string) => Promise<boolean>,
  query: string,
): Promise<boolean> {
  try {
    return await isPrivate(query);
  } catch {
    // Fail closed when GOPRIVATE cannot be read and query looks like a module/host path.
    return looksLikeHostPath(query) || isBareGitHubHost(query);
  }
}

async function safeFetchVersions(
  fetchVersions: (modulePath: string) => Promise<readonly string[]>,
  modulePath: string,
): Promise<readonly string[]> {
  try {
    return await fetchVersions(modulePath);
  } catch {
    return [];
  }
}

function parseSearchItems(rawItems: unknown): SearchResult[] {
  if (!Array.isArray(rawItems)) {
    return [];
  }

  const seen = new Set<string>();
  const results: SearchResult[] = [];

  for (const raw of rawItems) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const item = raw as RawModuleHit;
    const modulePath = typeof item.modulePath === 'string' ? item.modulePath.trim() : '';
    const packagePath = typeof item.packagePath === 'string' ? item.packagePath.trim() : '';
    const version = typeof item.version === 'string' ? item.version.trim() : '';

    if (modulePath === '' || modulePath === 'std' || version === '' || seen.has(modulePath)) {
      continue;
    }

    seen.add(modulePath);
    results.push(
      toSearchResult({
        modulePath,
        packagePath,
        version,
        summary: typeof item.synopsis === 'string' ? item.synopsis.trim() : '',
        importedBy: importedByCount(item.importedByCounts?.packages),
      }),
    );
  }

  return results;
}

interface RawModuleMetadata {
  readonly version?: unknown;
  readonly commitTime?: unknown;
  readonly repoUrl?: unknown;
  readonly licenses?: readonly { readonly types?: unknown }[];
}

export async function fetchModuleMetadata(
  modulePath: string,
  version: string | undefined,
  fetchJson: (url: string) => Promise<unknown>,
  isPrivate: (modulePath: string) => Promise<boolean>,
): Promise<ModuleMetadata | undefined> {
  if (await safeIsPrivate(isPrivate, modulePath)) {
    return undefined;
  }

  const params = new URLSearchParams({ licenses: 'true' });
  if (version !== undefined && version !== '') {
    params.set('version', version);
  }

  try {
    const raw = (await fetchJson(
      `https://pkg.go.dev/v1/module/${modulePath}?${params.toString()}`,
    )) as RawModuleMetadata | null;
    if (typeof raw !== 'object' || raw === null) {
      return undefined;
    }

    const licenses = [
      ...new Set(
        (Array.isArray(raw.licenses) ? raw.licenses : []).flatMap((entry) =>
          Array.isArray(entry?.types)
            ? entry.types.filter((type: unknown): type is string => typeof type === 'string')
            : [],
        ),
      ),
    ];

    return {
      modulePath,
      ...(typeof raw.version === 'string' && raw.version !== ''
        ? { version: raw.version }
        : {}),
      ...(typeof raw.commitTime === 'string' && raw.commitTime !== ''
        ? { publishedAt: raw.commitTime }
        : {}),
      ...(typeof raw.repoUrl === 'string' && raw.repoUrl !== ''
        ? { repoUrl: raw.repoUrl }
        : {}),
      licenses,
    };
  } catch {
    return undefined;
  }
}

