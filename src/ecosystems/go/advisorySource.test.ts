import { describe, expect, it } from 'vitest';
import { createLiveAdvisorySource, type CachedAdvisoryDb, type AdvisoryCache } from './advisorySource';
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
  constructor(private readonly env: string) {}

  async run(_args: readonly string[], _options: RunOptions): Promise<RunResult> {
    return { stdout: this.env, stderr: '', exitCode: 0 };
  }
}

const DB = { modified: '2026-10-08T22:31:09Z' };
const INDEX = [
  {
    path: 'rsc.io/sampler',
    vulns: [{ id: 'GO-0000-00001', modified: '2026-01-01T00:00:00Z', fixed: '1.99.99' }],
  },
];
const DOCUMENT = {
  id: 'GO-0000-00001',
  summary: 'vulnerable function in sampler.DefaultText',
  affected: [
    {
      package: { name: 'rsc.io/sampler', ecosystem: 'Go' },
      ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: 'v1.99.99' }] }],
    },
  ],
};

function setup(options: { env?: string; fail?: boolean } = {}) {
  const requests: string[] = [];
  let failing = options.fail === true;
  let dbModified = DB.modified;

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
    if (url.endsWith('/ID/GO-0000-00001.json')) {
      return DOCUMENT;
    }
    throw new Error(`unexpected url ${url}`);
  };

  const cache = new MemoryCache();
  let clock = Date.parse('2026-10-09T00:00:00Z');
  const source = createLiveAdvisorySource({
    fetchJson,
    cache,
    runner: new FakeRunner(options.env ?? ''),
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

const target = [{ name: 'rsc.io/sampler', version: 'v1.3.0' }];

describe('the live advisory source', () => {
  it('fetches the index once and one document, then matches', async () => {
    const { source, requests, cache } = setup();

    const report = await source.lookup(target);

    expect(report.matches.get('rsc.io/sampler@v1.3.0')?.[0]).toMatchObject({
      id: 'GO-0000-00001',
      fixedIn: 'v1.99.99',
    });
    expect(report.stale).toBe(false);
    expect(report.fetchedAt).toBeDefined();
    expect(requests).toEqual([
      'https://vuln.go.dev/index/db.json',
      'https://vuln.go.dev/index/modules.json',
      'https://vuln.go.dev/ID/GO-0000-00001.json',
    ]);
    expect(cache.writes).toBe(1);
  });

  it('uses the cache within the TTL and only checks db.json', async () => {
    const { source, requests } = setup();
    await source.lookup(target);
    requests.length = 0;

    const report = await source.lookup(target);

    expect(requests).toEqual(['https://vuln.go.dev/index/db.json']);
    expect(report.matches.size).toBe(1);
  });

  it('refetches the index when the database changes', async () => {
    const harness = setup();
    await harness.source.lookup(target);
    harness.requests.length = 0;

    harness.setDbModified('2026-10-09T10:00:00Z');
    await harness.source.lookup(target);

    expect(harness.requests).toContain('https://vuln.go.dev/index/modules.json');
  });

  it('refetches the index after the TTL expires', async () => {
    const harness = setup();
    await harness.source.lookup(target);
    harness.requests.length = 0;

    harness.advance(25 * 60 * 60 * 1000);
    await harness.source.lookup(target);

    expect(harness.requests).toContain('https://vuln.go.dev/index/modules.json');
  });

  it('bypasses the TTL when asked to refresh', async () => {
    const { source, requests, advance } = setup();
    await source.lookup(target);
    advance(25 * 60 * 60 * 1000);
    requests.length = 0;

    await source.lookup(target, { fresh: true });

    expect(requests[0]).toBe('https://vuln.go.dev/index/db.json');
    expect(requests).toContain('https://vuln.go.dev/index/modules.json');
  });

  it('serves the cache as stale when the network fails', async () => {
    const { source, setFailing } = setup();
    await source.lookup(target);
    setFailing(true);

    const report = await source.lookup(target);

    expect(report.stale).toBe(true);
    expect(report.matches.size).toBe(1);
  });

  it('fails when the network is down and nothing is cached', async () => {
    const { source } = setup({ fail: true });

    await expect(source.lookup(target)).rejects.toThrow(/network down/);
  });

  it('never sends private module paths and marks them unchecked', async () => {
    const { source, requests } = setup({ env: '*.corp.example.com,github.com/acme/*' });

    const report = await source.lookup([
      { name: 'git.corp.example.com/team/lib', version: 'v1.0.0' },
      { name: 'github.com/acme/internal', version: 'v2.1.0' },
      { name: 'rsc.io/sampler', version: 'v1.3.0' },
    ]);

    expect([...report.unchecked]).toEqual([
      'git.corp.example.com/team/lib@v1.0.0',
      'github.com/acme/internal@v2.1.0',
    ]);
    expect(requests.some((url) => url.includes('corp.example.com'))).toBe(false);
    expect(requests.some((url) => url.includes('acme'))).toBe(false);
    expect(report.matches.size).toBe(1);
  });
});
