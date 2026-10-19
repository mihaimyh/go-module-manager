import type {
  ModuleMetadata,
  SearchOptions,
  SearchResponse,
  SearchResult,
} from '../../core/adapter';

const DEFAULT_LIMIT = 25;
const POPULAR_QUERY = 'github.com';

export interface ModuleSearcherOptions {
  readonly fetchJson: (url: string) => Promise<unknown>;
  readonly isPrivate: (modulePath: string) => Promise<boolean>;
  readonly fetchVersions: (modulePath: string) => Promise<readonly string[]>;
}

export interface ModuleSearcher {
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
}

interface RawSearchItem {
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
  return {
    async search(rawQuery, searchOptions = {}) {
      const query = rawQuery.trim();
      const effectiveQuery = query === '' ? POPULAR_QUERY : query;

      if (query !== '' && (await safeIsPrivate(options.isPrivate, query))) {
        const versions = await safeFetchVersions(options.fetchVersions, query);
        const latest = versions[0];
        return {
          query,
          items:
            latest === undefined
              ? []
              : [{ name: query, version: latest, summary: '', private: true }],
        };
      }

      const limit = searchOptions.limit ?? DEFAULT_LIMIT;
      const params = new URLSearchParams({
        q: effectiveQuery,
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

function looksLikeModulePath(query: string): boolean {
  if (query.includes(' ') || !query.includes('/')) {
    return false;
  }
  const firstSegment = query.split('/')[0] ?? '';
  return firstSegment.includes('.');
}

async function safeIsPrivate(
  isPrivate: (modulePath: string) => Promise<boolean>,
  query: string,
): Promise<boolean> {
  try {
    return await isPrivate(query);
  } catch {
    // Fail closed when GOPRIVATE cannot be read and query looks like a module path.
    return looksLikeModulePath(query);
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
    const item = raw as RawSearchItem;
    const modulePath = typeof item.modulePath === 'string' ? item.modulePath.trim() : '';
    const packagePath = typeof item.packagePath === 'string' ? item.packagePath.trim() : '';
    const version = typeof item.version === 'string' ? item.version.trim() : '';
    const summary = typeof item.synopsis === 'string' ? item.synopsis.trim() : '';
    const importedBy =
      typeof item.importedByCounts?.packages === 'number' && item.importedByCounts.packages >= 0
        ? item.importedByCounts.packages
        : undefined;

    if (modulePath === '' || modulePath === 'std' || version === '' || seen.has(modulePath)) {
      continue;
    }

    seen.add(modulePath);
    results.push({
      name: modulePath,
      version,
      summary,
      ...(packagePath !== '' && packagePath !== modulePath
        ? { matchedPackage: packagePath }
        : {}),
      ...(importedBy === undefined ? {} : { importedBy }),
    });
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

