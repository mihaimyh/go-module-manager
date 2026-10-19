import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findProjectDirectories, parseWorkUseDirectories } from './projects';
import type { GoRunner, RunOptions, RunResult } from './runner';

let workspace: string | undefined;

afterEach(() => {
  if (workspace !== undefined) {
    rmSync(workspace, { recursive: true, force: true });
    workspace = undefined;
  }
});

function newRoot(): string {
  workspace = mkdtempSync(join(tmpdir(), 'gmm-projects-'));
  return workspace;
}

class FakeRunner implements GoRunner {
  readonly calls: { args: readonly string[]; options: RunOptions }[] = [];

  constructor(private readonly respond: (args: readonly string[]) => RunResult) {}

  async run(args: readonly string[], options: RunOptions): Promise<RunResult> {
    this.calls.push({ args, options });
    return this.respond(args);
  }
}

describe('parseWorkUseDirectories', () => {
  it('resolves relative use paths against the work file root', () => {
    const root = newRoot();
    expect(
      parseWorkUseDirectories(root, {
        Use: [{ DiskPath: './api' }, { DiskPath: 'web' }, { DiskPath: '../outside' }],
      }),
    ).toEqual(
      [resolve(root, './api'), resolve(root, 'web'), resolve(root, '../outside')].sort(),
    );
  });

  it('ignores entries without a disk path', () => {
    expect(parseWorkUseDirectories(newRoot(), { Use: [{}, { DiskPath: 1 }] })).toEqual([]);
  });
});

describe('findProjectDirectories', () => {
  it('falls back to the tree walk when there is no go.work', async () => {
    const root = newRoot();
    const api = join(root, 'api');
    mkdirSync(api, { recursive: true });
    writeFileSync(join(api, 'go.mod'), 'module example.com/api\n');
    const runner = new FakeRunner(() => ({ stdout: '', stderr: '', exitCode: 1 }));

    expect(await findProjectDirectories(root, runner)).toEqual([api]);
    expect(runner.calls).toEqual([]);
  });

  it('uses go.work use dirs, including nested modules the walk would miss', async () => {
    const root = newRoot();
    const api = join(root, 'api');
    const demo = join(api, 'examples', 'demo');
    mkdirSync(demo, { recursive: true });
    writeFileSync(join(root, 'go.work'), 'go 1.21\n\nuse (\n\t./api\n\t./api/examples/demo\n)\n');
    writeFileSync(join(api, 'go.mod'), 'module example.com/api\n');
    writeFileSync(join(demo, 'go.mod'), 'module example.com/demo\n');

    const runner = new FakeRunner(() => ({
      stdout: JSON.stringify({
        Use: [{ DiskPath: './api' }, { DiskPath: './api/examples/demo' }],
      }),
      stderr: '',
      exitCode: 0,
    }));

    expect(await findProjectDirectories(root, runner)).toEqual([api, demo].sort());
    expect(runner.calls[0]?.args).toEqual(['work', 'edit', '-json']);
    expect(runner.calls[0]?.options.cwd).toBe(root);
    // Discovery must not force GOWORK=off; that would hide the go.work file.
    if (process.env.GOWORK === undefined) {
      expect(runner.calls[0]?.options.env.GOWORK).toBeUndefined();
    }
  });

  it('falls back to the walk when go work edit fails', async () => {
    const root = newRoot();
    const api = join(root, 'api');
    mkdirSync(api, { recursive: true });
    writeFileSync(join(root, 'go.work'), 'go 1.21\nuse ./missing\n');
    writeFileSync(join(api, 'go.mod'), 'module example.com/api\n');
    const runner = new FakeRunner(() => ({
      stdout: '',
      stderr: 'go.work: no such file',
      exitCode: 1,
    }));

    expect(await findProjectDirectories(root, runner)).toEqual([api]);
  });

  it('skips use dirs that have no go.mod', async () => {
    const root = newRoot();
    const api = join(root, 'api');
    mkdirSync(api, { recursive: true });
    writeFileSync(join(root, 'go.work'), 'go 1.21\n');
    writeFileSync(join(api, 'go.mod'), 'module example.com/api\n');
    const runner = new FakeRunner(() => ({
      stdout: JSON.stringify({
        Use: [{ DiskPath: './api' }, { DiskPath: './ghost' }],
      }),
      stderr: '',
      exitCode: 0,
    }));

    expect(await findProjectDirectories(root, runner)).toEqual([api]);
  });
});
