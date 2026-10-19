import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { previewUpdate } from './preview';
import type { GoRunner, RunOptions, RunResult } from './runner';

let workspace: string | undefined;

afterEach(() => {
  if (workspace !== undefined) {
    rmSync(workspace, { recursive: true, force: true });
    workspace = undefined;
  }
});

const BEFORE_MOD = [
  'module example.com/a',
  '',
  'require (',
  '\trsc.io/quote v1.5.2',
  '\trsc.io/sampler v1.3.0',
  ')',
  '',
].join('\n');

const AFTER_MOD = ['module example.com/a', '', 'require rsc.io/quote v1.5.1', ''].join('\n');

function goModJson(requires: readonly { path: string; version: string }[]): string {
  return JSON.stringify({
    Module: { Path: 'example.com/a' },
    Require: requires.map((require) => ({ Path: require.path, Version: require.version })),
  });
}

const BEFORE_JSON = goModJson([
  { path: 'rsc.io/quote', version: 'v1.5.2' },
  { path: 'rsc.io/sampler', version: 'v1.3.0' },
]);
const AFTER_JSON = goModJson([{ path: 'rsc.io/quote', version: 'v1.5.1' }]);

function module(): string {
  workspace = mkdtempSync(join(tmpdir(), 'gmm-preview-'));
  const manifestPath = join(workspace, 'go.mod');
  writeFileSync(manifestPath, BEFORE_MOD);
  writeFileSync(join(workspace, 'go.sum'), 'rsc.io/quote v1.5.2 h1:old=\n');
  return manifestPath;
}

class FakeRunner implements GoRunner {
  readonly calls: { args: readonly string[] }[] = [];

  constructor(
    private readonly get: (cwd: string) => void = () => {
      /* go get writes files */
    },
  ) {}

  async run(args: readonly string[], options: RunOptions): Promise<RunResult> {
    this.calls.push({ args });
    if (args[0] === 'mod' && args[1] === 'edit') {
      const goMod = readFileSync(join(options.cwd, 'go.mod'), 'utf8');
      return {
        stdout: goMod === AFTER_MOD ? AFTER_JSON : BEFORE_JSON,
        stderr: '',
        exitCode: 0,
      };
    }
    if (args[0] === 'get') {
      this.get(options.cwd);
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    return { stdout: '', stderr: '', exitCode: 1 };
  }
}

describe('previewUpdate', () => {
  it('diffs require lines then restores the snapshot', async () => {
    const manifestPath = module();
    const runner = new FakeRunner((cwd) => {
      writeFileSync(join(cwd, 'go.mod'), AFTER_MOD);
      writeFileSync(join(cwd, 'go.sum'), 'rsc.io/quote v1.5.1 h1:new=\n');
    });

    const result = await previewUpdate(
      { manifestPath, changes: [{ name: 'rsc.io/quote', version: 'v1.5.1' }] },
      runner,
    );

    expect(result.status).toBe('ready');
    expect(result.impact).toEqual([
      { name: 'rsc.io/quote', kind: 'lowered', from: 'v1.5.2', to: 'v1.5.1' },
      { name: 'rsc.io/sampler', kind: 'removed', from: 'v1.3.0' },
    ]);
    expect(runner.calls.map((call) => call.args[0])).toEqual(['mod', 'get', 'mod']);
    expect(readFileSync(manifestPath, 'utf8')).toBe(BEFORE_MOD);
    expect(readFileSync(join(dirname(manifestPath), 'go.sum'), 'utf8')).toBe(
      'rsc.io/quote v1.5.2 h1:old=\n',
    );
  });

  it('restores files and reports stderr when go get fails', async () => {
    const manifestPath = module();
    const runner: GoRunner = {
      async run(args) {
        if (args[0] === 'get') {
          return { stdout: '', stderr: 'missing go.sum entry for rsc.io/quote', exitCode: 1 };
        }
        return { stdout: BEFORE_JSON, stderr: '', exitCode: 0 };
      },
    };

    const result = await previewUpdate(
      { manifestPath, changes: [{ name: 'rsc.io/quote', version: 'v1.5.1' }] },
      runner,
    );

    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/missing go.sum entry/);
    expect(result.impact).toEqual([]);
    expect(readFileSync(manifestPath, 'utf8')).toBe(BEFORE_MOD);
  });
});
