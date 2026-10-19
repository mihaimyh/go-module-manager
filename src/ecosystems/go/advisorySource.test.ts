import { describe, expect, it } from 'vitest';
import {
  createLiveAdvisorySource,
  type AdvisoryCache,
  type CachedAdvisoryDb,
} from './advisorySource';
import type { GoRunner, RunOptions, RunResult } from './runner';

class MemoryCache implements AdvisoryCache {
  value: CachedAdvisoryDb | undefined;
  writes = 0;

  async read(): Promise<CachedAdvisoryDb | undefined> {
    return this.value;
  }

  async write(db: CachedAdvisoryDb): Promise<void> {
    this.value = db;
    this.writes += 1;
  }
}

class FakeRunner implements GoRunner {
  constructor(private readonly stdout: string, private readonly exitCode = 0) {}

  async run(_args: readonly string[], _options: RunOptions): Promise<RunResult> {
    return { stdout: this.stdout, stderr: '', exitCode: this.exitCode };
  }
}

const MODIFIED = '2026-01-01T00:00:00Z';

const DOCUMENTS: Record<string, unknown> = {
  'GO-0000-00001': {
    id: 'GO-0000-00001',
    summary: 'vulnerable function in sampler.DefaultText',
    affected: [
      {
        package: { name: 'rsc.io/sampler', ecosystem: 'Go' },
        ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: 'v1.99.99' }] }],
      },
    ],
  },
  'GO-0000-00002': {
    id: 'GO-0000-00002',
    summary: 'quote issue',
    affected: [
      {
        package: { name: 'rsc.io/quote', ecosystem: 'Go' },
        ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: 'v1.5.2' }] }],
      },
    ],
  },
  'GO-0000-00003': {
    id: 'GO-0000-00003',
    summary: 'affects two modules',
    affected: [
      {
        package: { name: 'rsc.io/sampler', ecosystem: 'Go' },
        ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: 'v9.0.0' }] }],
      },
      {
        package: { name: 'rsc.io/quote', ecosystem: 'Go' },
        ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: 'v9.0.0' }] }],
      },
    ],
  },
};

const INDEX = [
  {
    path: 'rsc.io/sampler',
    vulns: [
      { id: 'GO-0000-00001', modified: MODIFIED, fixed: '1.99.99' },
      { id: 'GO-0000-00003', modified: MODIFIED },
    ],
  },
  {
    path: 'rsc.io/quote',
    vulns: [
      { id: 'GO-0000-00002', modified: MODIFIED },
      { id: 'GO-0000-00003', modified: MODIFIED },
    ],
  },
];

function setup(options: { env?: string; fail?: boolean; envExitCode?: number } = {}) {
  const requests: string[] = [];
  let failing = options.fail === true;
  let dbModified = MODIFIED;

  const fetchJson = async (url: string): Promise<unknown> => {
    requests.push(url);
    if (failing) {
      throw new Error('network down');
    }
    if (url.endsWith('/index/db.json')) {
      return { modified: dbModified };
    }
    if (url.endsWith('/index/modules.json')) {
      return INDEX;
    }
    const match = /\/ID\/(.+)\.json$/.exec(url);
    if (match?.[1] !== undefined && DOCUMENTS[match[1]] !== undefined) {
      return DOCUMENTS[match[1]];
    }
    throw new Error(`unexpected url ${url}`);
  };

  const cache = new MemoryCache();
  let clock = Date.parse('2026-10-09T00:00:00Z');
  const source = createLiveAdvisorySource({
    fetchJson,
    cache,
    runner: new FakeRunner(options.env ?? '', options.envExitCode ?? 0),
    now: () => clock,
  });

  return {
    source,
    cache,
    requests,
    advance: (ms: number) => {
      clock += ms;
    },
    setFailing: (value: boolean) => {
      failing = value;
    },
    setDbModified: (value: string) => {
      dbModified = value;
    },
  };
}

const sampler = [{ name: 'rsc.io/sampler', version: 'v1.3.0' }];

describe('the live advisory source', () => {
  it('fetches the index once and matches from documents', async () => {
    const { source, requests, cache } = setup();

    const report = await source.lookup(sampler);

    expect(report.matches.get('rsc.io/sampler@v1.3.0')?.map((a) => a.id)).toEqual([
      'GO-0000-00001',
      'GO-0000-00003',
    ]);
    expect(report.stale).toBe(false);
    expect(report.fetchedAt).toBeDefined();
    expect(requests.filter((url) => url.endsWith('/index/modules.json'))).toHaveLength(1);
    expect(cache.writes).toBe(1);
  });

  it('fetches documents for a dependency added while the index is cached', async () => {
    const harness = setup();
    await harness.source.lookup(sampler);
    harness.requests.length = 0;

    const report = await harness.source.lookup([
      ...sampler,
      { name: 'rsc.io/quote', version: 'v1.5.1' },
    ]);

    expect(harness.requests).toContain('https://vuln.go.dev/ID/GO-0000-00002.json');
    expect(harness.requests.some((url) => url.endsWith('/index/modules.json'))).toBe(false);
    expect(report.matches.get('rsc.io/quote@v1.5.1')?.map((a) => a.id)).toContain(
      'GO-0000-00002',
    );
  });

  it('serves one cached document to every module it affects', async () => {
    const { source } = setup();

    const report = await source.lookup([
      ...sampler,
      { name: 'rsc.io/quote', version: 'v1.5.1' },
    ]);

    expect(report.matches.get('rsc.io/sampler@v1.3.0')?.map((a) => a.id)).toContain(
      'GO-0000-00003',
    );
    expect(report.matches.get('rsc.io/quote@v1.5.1')?.map((a) => a.id)).toContain(
      'GO-0000-00003',
    );
  });

  it('uses the cache within the TTL and only checks db.json', async () => {
    const harness = setup();
    await harness.source.lookup(sampler);
    harness.requests.length = 0;

    const report = await harness.source.lookup(sampler);

    expect(harness.requests).toEqual(['https://vuln.go.dev/index/db.json']);
    expect(report.matches.size).toBe(1);
  });

  it('refetches the index when the database changes', async () => {
    const harness = setup();
    await harness.source.lookup(sampler);
    harness.requests.length = 0;
    harness.setDbModified('2026-10-09T10:00:00Z');

    await harness.source.lookup(sampler);

    expect(harness.requests).toContain('https://vuln.go.dev/index/modules.json');
  });

  it('refetches the index after the TTL expires', async () => {
    const harness = setup();
    await harness.source.lookup(sampler);
    harness.requests.length = 0;
    harness.advance(25 * 60 * 60 * 1000);

    await harness.source.lookup(sampler);

    expect(harness.requests).toContain('https://vuln.go.dev/index/modules.json');
  });

  it('serves the cache as stale when the network fails', async () => {
    const harness = setup();
    await harness.source.lookup(sampler);
    harness.setFailing(true);

    const report = await harness.source.lookup(sampler);

    expect(report.stale).toBe(true);
    expect(report.matches.size).toBe(1);
  });

  it('fails when the network is down and nothing is cached', async () => {
    const harness = setup({ fail: true });

    await expect(harness.source.lookup(sampler)).rejects.toThrow(/network down/);
  });

  it('never sends private module paths, including nested ones', async () => {
    const harness = setup({ env: '*.corp.example.com,github.com/acme/*' });

    const report = await harness.source.lookup([
      { name: 'git.corp.example.com/team/lib', version: 'v1.0.0' },
      { name: 'github.com/acme/internal/sub', version: 'v2.1.0' },
      ...sampler,
    ]);

    expect([...report.unchecked]).toEqual([
      'git.corp.example.com/team/lib@v1.0.0',
      'github.com/acme/internal/sub@v2.1.0',
    ]);
    expect(harness.requests.some((url) => url.includes('corp.example.com'))).toBe(false);
    expect(harness.requests.some((url) => url.includes('acme'))).toBe(false);
    expect(report.matches.size).toBe(1);
  });

  it('fails closed when go env cannot be read', async () => {
    const harness = setup({ envExitCode: 1 });

    await expect(harness.source.lookup(sampler)).rejects.toThrow(/GOPRIVATE/);
    expect(harness.requests).toEqual([]);
  });
});
