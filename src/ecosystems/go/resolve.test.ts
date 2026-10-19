import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProjectResolver } from './resolve';
import type { GoRunner, RunOptions, RunResult } from './runner';

class FakeRunner implements GoRunner {
  readonly calls: { args: readonly string[]; options: RunOptions }[] = [];
  gate: Promise<void> = Promise.resolve();

  constructor(private readonly respond: (cwd: string) => RunResult) {}

  async run(args: readonly string[], options: RunOptions): Promise<RunResult> {
    this.calls.push({ args, options });
    await this.gate;
    return this.respond(options.cwd);
  }
}

const LIST_JSON = [
  JSON.stringify({
    Path: 'rsc.io/quote',
    Version: 'v1.5.1',
    Update: { Path: 'rsc.io/quote', Version: 'v1.5.2', Time: '2018-02-14T15:44:20Z' },
  }),
  JSON.stringify({
    Path: 'golang.org/x/text',
    Version: 'v0.0.0-20170915032832-14c0d48ead0c',
    Update: { Path: 'golang.org/x/text', Version: 'v0.0.0-20200101000000-abcdef123456' },
  }),
  '',
].join('\n');

let workspace: string | undefined;

afterEach(() => {
  if (workspace !== undefined) {
    rmSync(workspace, { recursive: true, force: true });
    workspace = undefined;
  }
});

function moduleWithFiles(goMod: string, goSum = 'example.com/x v1.0.0 h1:abc=\n'): string {
  workspace = mkdtempSync(join(tmpdir(), 'gmm-resolve-'));
  writeFileSync(join(workspace, 'go.mod'), goMod);
  writeFileSync(join(workspace, 'go.sum'), goSum);
  return join(workspace, 'go.mod');
}

describe('resolving a project', () => {
  it('reads the build list and the available update through the runner', async () => {
    const manifestPath = moduleWithFiles('module example.com/a\n');
    const runner = new FakeRunner(() => ({ stdout: LIST_JSON, stderr: '', exitCode: 0 }));

    const resolved = await createProjectResolver(runner).resolve(manifestPath);

    expect(resolved.manifestPath).toBe(manifestPath);
    expect(resolved.dependencies).toEqual([
      { name: 'rsc.io/quote', version: 'v1.5.1', candidate: 'v1.5.2', kind: 'patch' },
      { name: 'golang.org/x/text', version: 'v0.0.0-20170915032832-14c0d48ead0c' },
    ]);

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.args).toEqual(['list', '-m', '-u', '-json', 'all']);
    expect(runner.calls[0]?.options.cwd).toBe(dirname(manifestPath));
    expect(runner.calls[0]?.options.env.GOWORK).toBe('off');
  });

  it('caches by the content of go.mod and go.sum', async () => {
    const manifestPath = moduleWithFiles('module example.com/a\n');
    const runner = new FakeRunner(() => ({ stdout: LIST_JSON, stderr: '', exitCode: 0 }));
    const resolver = createProjectResolver(runner);

    await resolver.resolve(manifestPath);
    await resolver.resolve(manifestPath);
    expect(runner.calls).toHaveLength(1);

    writeFileSync(manifestPath, 'module example.com/a\n\nrequire rsc.io/quote v1.5.1\n');
    await resolver.resolve(manifestPath);
    expect(runner.calls).toHaveLength(2);

    await resolver.resolve(manifestPath, { fresh: true });
    expect(runner.calls).toHaveLength(3);
  });

  it('shares one in-flight lookup between concurrent callers', async () => {
    const manifestPath = moduleWithFiles('module example.com/a\n');
    const runner = new FakeRunner(() => ({ stdout: LIST_JSON, stderr: '', exitCode: 0 }));
    let release: () => void = () => undefined;
    runner.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resolver = createProjectResolver(runner);

    const first = resolver.resolve(manifestPath);
    const second = resolver.resolve(manifestPath);
    release();

    const [left, right] = await Promise.all([first, second]);
    expect(runner.calls).toHaveLength(1);
    expect(left).toEqual(right);
  });

  it('reports the toolchain error instead of an empty build list', async () => {
    const manifestPath = moduleWithFiles('module example.com/a\n');
    const runner = new FakeRunner(() => ({
      stdout: '',
      stderr: 'go: missing go.sum entry for go.mod file',
      exitCode: 1,
    }));

    await expect(createProjectResolver(runner).resolve(manifestPath)).rejects.toThrow(
      /missing go\.sum entry/,
    );
  });
});
