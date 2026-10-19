import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GoRunner, RunOptions, RunResult } from './runner';
import { installScanner, parseScanOutput, scanProject } from './scan';

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
  workspace = mkdtempSync(join(tmpdir(), 'gmm-scan-'));
  const path = join(workspace, 'go.mod');
  writeFileSync(path, 'module example.com/a\n');
  return path;
}

const REACHABLE = JSON.stringify({
  finding: {
    osv: 'GO-0000-00001',
    fixed_version: 'v1.99.99',
    trace: [
      { module: 'rsc.io/sampler', package: 'rsc.io/sampler', function: 'DefaultText' },
      { module: 'example.com/a', package: 'example.com/a', function: 'main' },
    ],
  },
});

const NOT_REACHABLE = JSON.stringify({ finding: { osv: 'GO-0000-00002', trace: [] } });

describe('scanning a project', () => {
  it('runs govulncheck through the toolchain in the project directory', async () => {
    const manifestPath = manifest();
    const runner = new FakeRunner({ stdout: REACHABLE, stderr: '', exitCode: 0 });

    const findings = await scanProject(manifestPath, runner);

    expect(findings).toEqual([
      {
        id: 'GO-0000-00001',
        symbol: 'DefaultText',
        package: 'rsc.io/sampler',
      },
    ]);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.args).toEqual([
      'run',
      'golang.org/x/vuln/cmd/govulncheck@latest',
      '-json',
      './...',
    ]);
    expect(runner.calls[0]?.options.cwd).toBe(dirname(manifestPath));
    expect(runner.calls[0]?.options.env.GOWORK).toBe('off');
  });

  it('reports a typed failure instead of findings', async () => {
    const manifestPath = manifest();
    const runner = new FakeRunner({
      stdout: '',
      stderr: 'go: build failed',
      exitCode: 1,
    });

    await expect(scanProject(manifestPath, runner)).rejects.toMatchObject({
      message: expect.stringMatching(/govulncheck failed: go: build failed/),
    });
  });

  it('installs the CLI only when asked', async () => {
    const runner = new FakeRunner({ stdout: '', stderr: '', exitCode: 0 });

    await installScanner(process.cwd(), runner);

    expect(runner.calls[0]?.args).toEqual([
      'install',
      'golang.org/x/vuln/cmd/govulncheck@latest',
    ]);
  });
});

describe('parseScanOutput', () => {
  it('keeps reachable findings and skips advisories without a trace', () => {
    const findings = parseScanOutput(
      [REACHABLE, NOT_REACHABLE, 'not json', '', REACHABLE].join('\n'),
    );

    expect(findings).toEqual([
      { id: 'GO-0000-00001', symbol: 'DefaultText', package: 'rsc.io/sampler' },
    ]);
  });

  it('survives a frame without a function', () => {
    const output = JSON.stringify({
      finding: { osv: 'GO-0000-00003', trace: [{ package: 'example.com/a' }] },
    });

    expect(parseScanOutput(output)).toEqual([
      { id: 'GO-0000-00003', package: 'example.com/a' },
    ]);
  });
});
