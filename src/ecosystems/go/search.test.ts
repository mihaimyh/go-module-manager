import { describe, expect, it } from 'vitest';
import { createModuleSearcher, fetchModuleMetadata } from './search';

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

  it('loads popular modules when the query is empty', async () => {
    const requested: string[] = [];
    const searcher = createModuleSearcher({
      fetchJson: async (url) => {
        requested.push(url);
        return {
          items: [
            {
              packagePath: 'github.com/stretchr/testify/assert',
              modulePath: 'github.com/stretchr/testify',
              version: 'v1.10.0',
              synopsis: 'Package assert provides helpful assertion functions.',
              importedByCounts: { packages: 310000 },
            },
          ],
        };
      },
      isPrivate: async () => false,
      fetchVersions: async () => [],
    });

    const response = await searcher.search('   ');

    expect(requested).toEqual(['https://pkg.go.dev/v1/search?q=github.com&limit=25']);
    expect(response.query).toBe('');
    expect(response.items).toHaveLength(1);
    expect(response.items[0]?.name).toBe('github.com/stretchr/testify');
  });

  it('never contacts pkg.go.dev when the query matches GOPRIVATE and resolves via go list', async () => {
    let networkCalls = 0;
    const searcher = createModuleSearcher({
      fetchJson: async () => {
        networkCalls += 1;
        return {};
      },
      isPrivate: async (path) => path.startsWith('github.com/acme/'),
      fetchVersions: async (path) =>
        path === 'github.com/acme/secret' ? ['v1.4.0', 'v1.3.0'] : [],
    });

    const response = await searcher.search('github.com/acme/secret');

    expect(networkCalls).toBe(0);
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

  it('falls back to go list -m -versions when a module path query returns no pkg.go.dev hits', async () => {
    const searcher = createModuleSearcher({
      fetchJson: async () => ({ items: [] }),
      isPrivate: async () => false,
      fetchVersions: async (path) =>
        path === 'example.com/fresh/mod' ? ['v0.2.0', 'v0.1.0'] : [],
    });

    const response = await searcher.search('example.com/fresh/mod');

    expect(response.items).toEqual([
      {
        name: 'example.com/fresh/mod',
        version: 'v0.2.0',
        summary: '',
      },
    ]);
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

