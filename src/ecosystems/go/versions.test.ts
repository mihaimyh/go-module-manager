import { describe, expect, it } from 'vitest';
import { createVersionsFetcher } from './versions';
import { GoCommandError } from './errors';
import type { GoRunner, RunOptions, RunResult } from './runner';

class FakeRunner implements GoRunner {
  readonly calls: { args: readonly string[]; options: RunOptions }[] = [];

  constructor(
    private readonly respond: (args: readonly string[]) => RunResult = () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
    }),
  ) {}

  async run(args: readonly string[], options: RunOptions): Promise<RunResult> {
    this.calls.push({ args, options });
    return this.respond(args);
  }
}

function listJson(options: {
  readonly versions: readonly string[];
  readonly retract?: readonly { Low: string; High: string }[];
}): string {
  return JSON.stringify({
    Path: 'rsc.io/quote',
    Versions: options.versions,
    ...(options.retract === undefined ? {} : { Retract: options.retract }),
  });
}

describe('versions fetcher', () => {
  it('lists tagged versions newest first via go list, not the public proxy', async () => {
    const runner = new FakeRunner(() => ({
      stdout: listJson({
        versions: ['v1.4.0', 'v1.10.0', 'v1.9.9', 'v1.4.0', 'not-a-version'],
      }),
      stderr: '',
      exitCode: 0,
    }));

    const versions = await createVersionsFetcher({ runner, cwd: '/repo' }).fetch('rsc.io/quote');

    expect(versions).toEqual(['v1.10.0', 'v1.9.9', 'v1.4.0']);
    expect(runner.calls).toEqual([
      expect.objectContaining({
        args: ['list', '-m', '-versions', '-json', 'rsc.io/quote'],
        options: expect.objectContaining({ cwd: '/repo' }),
      }),
    ]);
  });

  it('drops retracted versions the toolchain reported', async () => {
    const runner = new FakeRunner(() => ({
      stdout: listJson({
        versions: ['v1.0.0', 'v1.1.0', 'v1.2.0', 'v1.3.0'],
        retract: [{ Low: 'v1.1.0', High: 'v1.2.0' }],
      }),
      stderr: '',
      exitCode: 0,
    }));

    expect(await createVersionsFetcher({ runner }).fetch('example.com/m')).toEqual([
      'v1.3.0',
      'v1.0.0',
    ]);
  });

  it('keeps the list when retract data is absent', async () => {
    const runner = new FakeRunner(() => ({
      stdout: listJson({ versions: ['v1.0.0', 'v1.1.0'] }),
      stderr: '',
      exitCode: 0,
    }));

    expect(await createVersionsFetcher({ runner }).fetch('example.com/m')).toEqual([
      'v1.1.0',
      'v1.0.0',
    ]);
  });

  it('caches per module', async () => {
    const runner = new FakeRunner(() => ({
      stdout: listJson({ versions: ['v1.0.0'] }),
      stderr: '',
      exitCode: 0,
    }));
    const fetch = createVersionsFetcher({ runner });

    await fetch.fetch('rsc.io/quote');
    await fetch.fetch('rsc.io/quote');

    expect(runner.calls).toHaveLength(1);
  });

  it('fails with the toolchain message when go list cannot run', async () => {
    const runner = new FakeRunner(() => ({
      stdout: '',
      stderr: 'module lookup disabled by GOPROXY=off',
      exitCode: 1,
    }));

    await expect(createVersionsFetcher({ runner }).fetch('rsc.io/quote')).rejects.toBeInstanceOf(
      GoCommandError,
    );
  });
});
