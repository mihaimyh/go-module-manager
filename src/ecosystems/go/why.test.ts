import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { whyModule } from './why';
import type { GoRunner, RunOptions, RunResult } from './runner';

class FakeRunner implements GoRunner {
  readonly calls: { args: readonly string[]; options: RunOptions }[] = [];

  constructor(private readonly result: RunResult) {}

  async run(args: readonly string[], options: RunOptions): Promise<RunResult> {
    this.calls.push({ args, options });
    return this.result;
  }
}

describe('whyModule', () => {
  it('runs go mod why -m in the owning project with workspace mode off', async () => {
    const runner = new FakeRunner({
      stdout: '# rsc.io/quote\nexample.com/a\nrsc.io/quote\n',
      stderr: '',
      exitCode: 0,
    });

    const text = await whyModule('/repo/a/go.mod', 'rsc.io/quote', runner);

    expect(text).toBe('# rsc.io/quote\nexample.com/a\nrsc.io/quote');
    expect(runner.calls).toEqual([
      expect.objectContaining({
        args: ['mod', 'why', '-m', 'rsc.io/quote'],
        options: expect.objectContaining({
          cwd: dirname('/repo/a/go.mod'),
          env: expect.objectContaining({ GOWORK: 'off' }),
        }),
      }),
    ]);
  });

  it('keeps the not-needed line', async () => {
    const runner = new FakeRunner({
      stdout: '# rsc.io/quote\n(main module does not need package rsc.io/quote)\n',
      stderr: '',
      exitCode: 0,
    });

    expect(await whyModule('/repo/a/go.mod', 'rsc.io/quote', runner)).toContain(
      'main module does not need package',
    );
  });

  it('fails with the first stderr line', async () => {
    const runner = new FakeRunner({
      stdout: '',
      stderr: 'go: malformed go.mod\nmore',
      exitCode: 1,
    });

    await expect(whyModule('/repo/a/go.mod', 'rsc.io/quote', runner)).rejects.toThrow(
      /malformed go.mod/,
    );
  });
});
