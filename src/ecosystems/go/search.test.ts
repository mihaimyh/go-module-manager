import { describe, expect, it } from 'vitest';
import {
  createModuleSearcher,
  fetchModuleMetadata,
  looksLikeModulePath,
  POPULAR_MODULES,
} from './search';

describe('createModuleSearcher', () => {
  it('queries pkg.go.dev/v1/search, drops std, deduplicates by modulePath, and notes sub-package hits', async () => {
    const requested: string[] = [];
    const searcher = createModuleSearcher({
      fetchJson: async (url) => {
        requested.push(url);
        return {
          items: [
            {
              packagePath: 'net/http',
              modulePath: 'std',
              version: 'go1.23.0',
              synopsis: 'Package http provides HTTP client and server implementations.',
              importedByCounts: { packages: 500000, modules: -1 },
            },
            {
              packagePath: 'github.com/spf13/cobra',
              modulePath: 'github.com/spf13/cobra',
              version: 'v1.10.2',
              synopsis: 'Package cobra is a commander for modern CLI interfaces.',
              importedByCounts: { packages: 195884, modules: -1 },
            },
            {
              packagePath: 'github.com/spf13/cobra/doc',
              modulePath: 'github.com/spf13/cobra',
              version: 'v1.10.2',
              synopsis: 'Package doc generates documentation.',
              importedByCounts: { packages: 3177, modules: 3604 },
            },
            {
              packagePath: 'github.com/cosmos/cosmos-sdk/server',
              modulePath: 'github.com/cosmos/cosmos-sdk',
              version: 'v0.55.0',
              synopsis: 'The commands from the SDK are defined with cobra.',
              importedByCounts: { packages: 4633, modules: -1 },
            },
          ],
          nextPageToken: 'page-2',
        };
      },
      isPrivate: async () => false,
      fetchVersions: async () => [],
    });

    const response = await searcher.search('cobra');

    expect(requested).toEqual(['https://pkg.go.dev/v1/search?q=cobra&limit=25']);
    expect(response).toEqual({
      query: 'cobra',
      nextPageToken: 'page-2',
      items: [
        {
          name: 'github.com/spf13/cobra',
          version: 'v1.10.2',
          summary: 'Package cobra is a commander for modern CLI interfaces.',
          importedBy: 195884,
        },
        {
          name: 'github.com/cosmos/cosmos-sdk',
          version: 'v0.55.0',
          summary: 'The commands from the SDK are defined with cobra.',
          matchedPackage: 'github.com/cosmos/cosmos-sdk/server',
          importedBy: 4633,
        },
      ],
    });
  });

  it('loads curated popular modules via /v1/package instead of /v1/search?q=github.com and caches them', async () => {
    const requested: string[] = [];
    const searcher = createModuleSearcher({
      fetchJson: async (url) => {
        requested.push(url);
        if (url.includes('/v1/package/github.com/stretchr/testify/assert')) {
          return {
            path: 'github.com/stretchr/testify/assert',
            modulePath: 'github.com/stretchr/testify',
            version: 'v1.10.0',
            synopsis: 'Package assert provides helpful assertion functions.',
            importedByCounts: { packages: 310000 },
          };
        }
        if (url.includes('/v1/package/golang.org/x/sync/errgroup')) {
          return {
            path: 'golang.org/x/sync/errgroup',
            modulePath: 'golang.org/x/sync',
            version: 'v0.12.0',
            synopsis: 'Package errgroup provides synchronization.',
            importedByCounts: { packages: 30000 },
          };
        }
        return null;
      },
      isPrivate: async () => false,
      fetchVersions: async () => [],
    });

    const first = await searcher.search('   ');
    const firstCallCount = requested.length;

    expect(firstCallCount).toBe(POPULAR_MODULES.length);
    expect(requested.some((url) => url.includes('/v1/search'))).toBe(false);
    expect(first.query).toBe('');
    expect(first.items).toEqual([
      {
        name: 'github.com/stretchr/testify',
        version: 'v1.10.0',
        summary: 'Package assert provides helpful assertion functions.',
        matchedPackage: 'github.com/stretchr/testify/assert',
        importedBy: 310000,
      },
      {
        name: 'golang.org/x/sync',
        version: 'v0.12.0',
        summary: 'Package errgroup provides synchronization.',
        matchedPackage: 'golang.org/x/sync/errgroup',
        importedBy: 30000,
      },
    ]);

    const second = await searcher.search('');
    expect(requested).toHaveLength(firstCallCount);
    expect(second.items).toEqual(first.items);

    // Bare `github.com` / `github.com/` reuse the same curated list (ADR 0013).
    const githubBare = await searcher.search('github.com/');
    expect(requested).toHaveLength(firstCallCount);
    expect(githubBare).toEqual({
      query: 'github.com/',
      items: first.items,
    });
  });

  it('skips private seeds and retries popular lookup after a transient total failure', async () => {
    let shouldFail = true;
    const requested: string[] = [];
    const searcher = createModuleSearcher({
      fetchJson: async (url) => {
        requested.push(url);
        if (shouldFail) {
          throw new Error('pkg.go.dev timed out after 15s');
        }
        return {
          path: 'golang.org/x/sync/errgroup',
          modulePath: 'golang.org/x/sync',
          version: 'v0.12.0',
          synopsis: 'Package errgroup provides synchronization.',
          importedByCounts: { packages: 30000 },
        };
      },
      isPrivate: async (path) => !path.startsWith('golang.org/x/sync'),
      fetchVersions: async () => [],
    });

    await expect(searcher.search('')).rejects.toThrow('pkg.go.dev timed out after 15s');
    expect(requested).toEqual([
      'https://pkg.go.dev/v1/package/golang.org/x/sync/errgroup?imported-by-counts=true&module=golang.org%2Fx%2Fsync',
    ]);

    shouldFail = false;
    const recovered = await searcher.search('');
    expect(recovered.items).toHaveLength(1);
    expect(recovered.items[0]?.name).toBe('golang.org/x/sync');
  });

  it('never contacts pkg.go.dev when the query matches GOPRIVATE and resolves via go list only when complete', async () => {
    let networkCalls = 0;
    const versionLookups: string[] = [];
    const searcher = createModuleSearcher({
      fetchJson: async () => {
        networkCalls += 1;
        return {};
      },
      isPrivate: async (path) => path.startsWith('github.com/acme/'),
      fetchVersions: async (path) => {
        versionLookups.push(path);
        return path === 'github.com/acme/secret' ? ['v1.4.0', 'v1.3.0'] : [];
      },
    });

    const partial = await searcher.search('github.com/acme/');
    expect(networkCalls).toBe(0);
    expect(versionLookups).toEqual([]);
    expect(partial).toEqual({ query: 'github.com/acme/', items: [] });

    const response = await searcher.search('github.com/acme/secret');

    expect(networkCalls).toBe(0);
    expect(versionLookups).toEqual(['github.com/acme/secret']);
    expect(response).toEqual({
      query: 'github.com/acme/secret',
      items: [
        {
          name: 'github.com/acme/secret',
          version: 'v1.4.0',
          summary: '',
          private: true,
        },
      ],
    });
  });

  it('falls back to go list -m -versions when a complete module path query returns no pkg.go.dev hits', async () => {
    const versionLookups: string[] = [];
    const searcher = createModuleSearcher({
      fetchJson: async () => ({ items: [] }),
      isPrivate: async () => false,
      fetchVersions: async (path) => {
        versionLookups.push(path);
        return path === 'example.com/fresh/mod' ? ['v0.2.0', 'v0.1.0'] : [];
      },
    });

    // Incomplete 2-segment github.com/owner path should not spawn `go list`.
    const incomplete = await searcher.search('github.com/spf13');
    expect(incomplete.items).toEqual([]);
    expect(versionLookups).toEqual([]);

    const response = await searcher.search('example.com/fresh/mod');

    expect(versionLookups).toEqual(['example.com/fresh/mod']);
    expect(response.items).toEqual([
      {
        name: 'example.com/fresh/mod',
        version: 'v0.2.0',
        summary: '',
      },
    ]);
  });
});

describe('looksLikeModulePath', () => {
  it('requires host/owner/repo for 3-segment VCS hosts and rejects trailing slashes', () => {
    expect(looksLikeModulePath('github.com')).toBe(false);
    expect(looksLikeModulePath('github.com/')).toBe(false);
    expect(looksLikeModulePath('github.com/spf13')).toBe(false);
    expect(looksLikeModulePath('github.com/spf13/')).toBe(false);
    expect(looksLikeModulePath('github.com/spf13/cobra')).toBe(true);
    expect(looksLikeModulePath('gitlab.com/group')).toBe(false);
    expect(looksLikeModulePath('gitlab.com/group/proj')).toBe(true);
    expect(looksLikeModulePath('rsc.io/quote')).toBe(true);
    expect(looksLikeModulePath('gopkg.in/yaml.v3')).toBe(true);
  });
});

describe('fetchModuleMetadata', () => {
  it('fetches license types, commitTime, and repoUrl from pkg.go.dev/v1/module', async () => {
    const requested: string[] = [];
    const metadata = await fetchModuleMetadata(
      'github.com/spf13/cobra',
      'v1.10.2',
      async (url) => {
        requested.push(url);
        return {
          path: 'github.com/spf13/cobra',
          version: 'v1.10.2',
          commitTime: '2025-12-03T23:51:15Z',
          repoUrl: 'https://github.com/spf13/cobra',
          licenses: [{ types: ['Apache-2.0'], filePath: 'LICENSE.txt' }],
        };
      },
      async () => false,
    );

    expect(requested).toEqual([
      'https://pkg.go.dev/v1/module/github.com/spf13/cobra?licenses=true&version=v1.10.2',
    ]);
    expect(metadata).toEqual({
      modulePath: 'github.com/spf13/cobra',
      version: 'v1.10.2',
      publishedAt: '2025-12-03T23:51:15Z',
      repoUrl: 'https://github.com/spf13/cobra',
      licenses: ['Apache-2.0'],
    });
  });

  it('never contacts pkg.go.dev for a private module path', async () => {
    let called = 0;
    const metadata = await fetchModuleMetadata(
      'github.com/acme/secret',
      'v1.0.0',
      async () => {
        called += 1;
        return {};
      },
      async () => true,
    );

    expect(called).toBe(0);
    expect(metadata).toBeUndefined();
  });
});

