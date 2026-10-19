import { describe, expect, it } from 'vitest';
import { encodeModulePath, createVersionsFetcher } from './versions';
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

describe('versions fetcher', () => {
  it('lists every tagged version, newest first, without duplicates', async () => {
    const requested: string[] = [];
    const fetch = fetcher(async (url) => {
      requested.push(url);
      return ['v1.4.0', 'v1.10.0', 'v1.9.9', 'v1.4.0', 'not-a-version', ''].join('\n');
    });

    const versions = await fetch.fetch('rsc.io/quote');

    expect(versions).toEqual(['v1.10.0', 'v1.9.9', 'v1.4.0']);
    expect(requested).toEqual(['https://proxy.golang.org/rsc.io/quote/@v/list']);
  });

  it('caches per module', async () => {
    let calls = 0;
    const fetch = fetcher(async () => {
      calls += 1;
      return 'v1.0.0';
    });

    await fetch.fetch('rsc.io/quote');
    await fetch.fetch('rsc.io/quote');

    expect(calls).toBe(1);
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
