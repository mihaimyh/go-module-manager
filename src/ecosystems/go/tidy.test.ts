import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GoRunner, RunOptions, RunResult } from './runner';
import { tidyProject } from './tidy';

class FakeRunner implements GoRunner {
  readonly calls: { args: readonly string[]; options: RunOptions }[] = [];

  constructor(private readonly result: RunResult) {}

  async run(args: readonly string[], options: RunOptions): Promise<RunResult> {
    this.calls.push({ args, options });
    return this.result;
  }
}

let workspace: string | undefined;

afterEach(() => {
  if (workspace !== undefined) {
    rmSync(workspace, { recursive: true, force: true });
    workspace = undefined;
  }
});

function manifest(): string {
  workspace = mkdtempSync(join(tmpdir(), 'gmm-tidy-'));
  const path = join(workspace, 'go.mod');
  writeFileSync(path, 'module example.com/a\n');
  return path;
}

describe('tidying a project', () => {
  it('runs go mod tidy in the owning project with workspace mode off', async () => {
    const manifestPath = manifest();
    const runner = new FakeRunner({ stdout: '', stderr: '', exitCode: 0 });

    await tidyProject(manifestPath, runner);

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.args).toEqual(['mod', 'tidy']);
    expect(runner.calls[0]?.options.cwd).toBe(dirname(manifestPath));
    expect(runner.calls[0]?.options.env.GOWORK).toBe('off');
  });

  it('reports a typed failure', async () => {
    const manifestPath = manifest();
    const runner = new FakeRunner({
      stdout: '',
      stderr: 'go: errors parsing go.mod',
      exitCode: 1,
    });

    await expect(tidyProject(manifestPath, runner)).rejects.toMatchObject({
      message: expect.stringMatching(/go mod tidy failed/),
    });
  });
});
