import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GoRunner, RunOptions, RunResult } from './runner';
import { isVendored, vendorProject } from './vendor';

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

function vendoredManifest(): string {
  workspace = mkdtempSync(join(tmpdir(), 'gmm-vendor-'));
  const manifestPath = join(workspace, 'go.mod');
  writeFileSync(manifestPath, 'module example.com/a\n');
  mkdirSync(join(workspace, 'vendor'));
  writeFileSync(join(workspace, 'vendor', 'modules.txt'), '# example.com/a\n');
  return manifestPath;
}

describe('vendorProject', () => {
  it('runs go mod vendor only when vendor/modules.txt exists', async () => {
    const manifestPath = vendoredManifest();
    const runner = new FakeRunner({ stdout: '', stderr: '', exitCode: 0 });

    await vendorProject(manifestPath, runner);

    expect(isVendored(manifestPath)).toBe(true);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.args).toEqual(['mod', 'vendor']);
    expect(runner.calls[0]?.options.cwd).toBe(dirname(manifestPath));
    expect(runner.calls[0]?.options.env.GOWORK).toBe('off');
  });

  it('refuses to invent a vendor tree', async () => {
    workspace = mkdtempSync(join(tmpdir(), 'gmm-vendor-'));
    const manifestPath = join(workspace, 'go.mod');
    writeFileSync(manifestPath, 'module example.com/a\n');
    const runner = new FakeRunner({ stdout: '', stderr: '', exitCode: 0 });

    await expect(vendorProject(manifestPath, runner)).rejects.toMatchObject({
      message: expect.stringMatching(/refusing to create/),
    });
    expect(runner.calls).toHaveLength(0);
  });
});
