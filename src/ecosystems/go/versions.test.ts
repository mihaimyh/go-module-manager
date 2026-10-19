import { describe, expect, it } from 'vitest';
import {
  createVersionsFetcher,
  encodeModulePath,
  parseRetracts,
} from './versions';
import type { GoRunner, RunOptions, RunResult } from './runner';

class FakeRunner implements GoRunner {
  readonly calls: string[] = [];

  constructor(private readonly env = '', private readonly exitCode = 0) {}

  async run(args: readonly string[], _options: RunOptions): Promise<RunResult> {
    this.calls.push(args.join(' '));
    return {
      stdout: args[0] === 'env' ? this.env : '',
      stderr: '',
      exitCode: this.exitCode,
    };
  }
}

function proxy(
  list: string,
  options: { latest?: string; goMod?: string } = {},
): (url: string) => Promise<string> {
  return async (url) => {
    if (url.endsWith('/@latest')) {
      return JSON.stringify({ Version: options.latest ?? 'v9.9.9' });
    }
    if (/\/@v\/.+\.mod$/.test(url)) {
      return options.goMod ?? 'module example.com/m\n';
    }
    return list;
  };
}

function fetcher(fetchText: (url: string) => Promise<string>, runner = new FakeRunner()) {
  return createVersionsFetcher({ fetchText, runner });
}

describe('encodeModulePath', () => {
  it('encodes uppercase letters the way the proxy expects', () => {
    expect(encodeModulePath('dev.azure.com/INGCDaaS/service')).toBe(
      'dev.azure.com/!i!n!g!c!daa!s/service',
    );
  });
});

describe('parseRetracts', () => {
  it('reads single versions and closed intervals, in blocks too', () => {
    const goMod = [
      'module example.com/m',
      'retract v1.0.1 // typo',
      'retract [v1.1.0, v1.2.0]',
      'retract (',
      '  v1.4.0',
      '  [v1.5.0, v1.6.0]',
      ')',
    ].join('\n');

    expect(parseRetracts(goMod)).toEqual([
      { low: 'v1.0.1', high: 'v1.0.1' },
      { low: 'v1.1.0', high: 'v1.2.0' },
      { low: 'v1.4.0', high: 'v1.4.0' },
      { low: 'v1.5.0', high: 'v1.6.0' },
    ]);
  });
});

describe('versions fetcher', () => {
  it('lists every tagged version, newest first, without duplicates', async () => {
    const requested: string[] = [];
    const fetch = fetcher(async (url) => {
      requested.push(url);
      if (url.endsWith('/@latest')) {
        return JSON.stringify({ Version: 'v1.10.0' });
      }
      if (url.endsWith('.mod')) {
        return 'module rsc.io/quote\n';
      }
      return ['v1.4.0', 'v1.10.0', 'v1.9.9', 'v1.4.0', 'not-a-version', ''].join('\n');
    });

    const versions = await fetch.fetch('rsc.io/quote');

    expect(versions).toEqual(['v1.10.0', 'v1.9.9', 'v1.4.0']);
    expect(requested[0]).toBe('https://proxy.golang.org/rsc.io/quote/@v/list');
  });

  it('drops retracted versions', async () => {
    const fetch = fetcher(
      proxy('v1.0.0\nv1.1.0\nv1.2.0\nv1.3.0', {
        latest: 'v1.3.0',
        goMod: 'module example.com/m\n\nretract [v1.1.0, v1.2.0]\n',
      }),
    );

    expect(await fetch.fetch('example.com/m')).toEqual(['v1.3.0', 'v1.0.0']);
  });

  it('keeps the list when retraction data cannot be read', async () => {
    const fetch = fetcher(async (url) => {
      if (url.endsWith('/@latest')) {
        throw new Error('no latest');
      }
      return 'v1.0.0\nv1.1.0';
    });

    expect(await fetch.fetch('example.com/m')).toEqual(['v1.1.0', 'v1.0.0']);
  });

  it('caches per module', async () => {
    let calls = 0;
    const fetch = fetcher(async (url) => {
      calls += 1;
      if (url.endsWith('/@latest')) {
        return JSON.stringify({ Version: 'v1.0.0' });
      }
      if (url.endsWith('.mod')) {
        return 'module example.com/m\n';
      }
      return 'v1.0.0';
    });

    await fetch.fetch('rsc.io/quote');
    const afterFirst = calls;
    await fetch.fetch('rsc.io/quote');

    expect(calls).toBe(afterFirst);
  });

  it('never requests a private module path', async () => {
    const runner = new FakeRunner('example.com/*');
    const requested: string[] = [];
    const fetch = fetcher(async (url) => {
      requested.push(url);
      return 'v1.0.0';
    }, runner);

    expect(await fetch.fetch('example.com/private')).toEqual([]);
    expect(requested).toEqual([]);
  });

  it('fails closed when go env cannot be read', async () => {
    const fetch = fetcher(async () => 'v1.0.0', new FakeRunner('', 1));

    await expect(fetch.fetch('rsc.io/quote')).rejects.toThrow(/GOPRIVATE/);
  });
});
