import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { downloadModules } from './download';
import type { GoRunner, RunOptions, RunResult } from './runner';

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
  workspace = mkdtempSync(join(tmpdir(), 'gmm-download-'));
  const path = join(workspace, 'go.mod');
  writeFileSync(path, 'module example.com/a\n');
  return path;
}

describe('downloading modules', () => {
  it('runs go mod download in the owning module with workspace mode off', async () => {
    const manifestPath = manifest();
    const runner = new FakeRunner({ stdout: '', stderr: '', exitCode: 0 });

    await downloadModules(manifestPath, runner);

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.args).toEqual(['mod', 'download']);
    expect(runner.calls[0]?.options.cwd).toBe(dirname(manifestPath));
    expect(runner.calls[0]?.options.env.GOWORK).toBe('off');
  });

  it('reports a typed failure the panel can turn into an action', async () => {
    const manifestPath = manifest();
    const runner = new FakeRunner({
      stdout: '',
      stderr: 'terminal prompts disabled',
      exitCode: 1,
    });

    await expect(downloadModules(manifestPath, runner)).rejects.toMatchObject({
      kind: 'auth-required',
      message: expect.stringMatching(/go mod download failed/),
    });
  });
});
