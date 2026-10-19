import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunOptions, RunResult, GoRunner } from './runner';
import { createUpdater } from './update';

class FakeRunner implements GoRunner {
  readonly calls: { args: readonly string[]; options: RunOptions }[] = [];

  constructor(private readonly respond: (cwd: string) => RunResult) {}

  async run(args: readonly string[], options: RunOptions): Promise<RunResult> {
    this.calls.push({ args, options });
    return this.respond(options.cwd);
  }
}

let workspace: string | undefined;

afterEach(() => {
  if (workspace !== undefined) {
    rmSync(workspace, { recursive: true, force: true });
    workspace = undefined;
  }
});

const BEFORE = 'module example.com/a\n\nrequire rsc.io/quote v1.5.1\n';
const AFTER = 'module example.com/a\n\nrequire rsc.io/quote v1.5.2\n';

function module(goSum: string | undefined): string {
  workspace = mkdtempSync(join(tmpdir(), 'gmm-update-'));
  const manifestPath = join(workspace, 'go.mod');
  writeFileSync(manifestPath, BEFORE);
  if (goSum !== undefined) {
    writeFileSync(join(workspace, 'go.sum'), goSum);
  }
  return manifestPath;
}

describe('updating one dependency', () => {
  it('runs one go get in the owning project with workspace mode off', async () => {
    const manifestPath = module('rsc.io/quote v1.5.1 h1:old=\n');
    const runner = new FakeRunner(() => ({ stdout: '', stderr: '', exitCode: 0 }));

    const outcome = await createUpdater(runner).update({
      manifestPath,
      name: 'rsc.io/quote',
      version: 'v1.5.2',
    });

    expect(outcome).toMatchObject({ status: 'updated', name: 'rsc.io/quote', version: 'v1.5.2' });
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.args).toEqual(['get', 'rsc.io/quote@v1.5.2']);
    expect(runner.calls[0]?.options.cwd).toBe(dirname(manifestPath));
    expect(runner.calls[0]?.options.env.GOWORK).toBe('off');
  });

  it('restores go.mod and go.sum exactly as they were', async () => {
    const manifestPath = module('rsc.io/quote v1.5.1 h1:old=\n');
    const runner = new FakeRunner(() => {
      writeFileSync(manifestPath, AFTER);
      writeFileSync(join(dirname(manifestPath), 'go.sum'), 'rsc.io/quote v1.5.2 h1:new=\n');
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const updater = createUpdater(runner);

    await updater.update({ manifestPath, name: 'rsc.io/quote', version: 'v1.5.2' });
    expect(readFileSync(manifestPath, 'utf8')).toBe(AFTER);

    expect(await updater.undo(manifestPath)).toBe(true);
    expect(readFileSync(manifestPath, 'utf8')).toBe(BEFORE);
    expect(readFileSync(join(dirname(manifestPath), 'go.sum'), 'utf8')).toBe(
      'rsc.io/quote v1.5.1 h1:old=\n',
    );

    expect(await updater.undo(manifestPath)).toBe(false);
  });

  it('removes a go.sum that did not exist before the update', async () => {
    const manifestPath = module(undefined);
    const runner = new FakeRunner(() => {
      writeFileSync(join(dirname(manifestPath), 'go.sum'), 'created by go get\n');
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const updater = createUpdater(runner);

    await updater.update({ manifestPath, name: 'rsc.io/quote', version: 'v1.5.2' });
    await updater.undo(manifestPath);

    expect(() => readFileSync(join(dirname(manifestPath), 'go.sum'))).toThrow();
  });

  it('reports the toolchain message and leaves the files as it left them', async () => {
    const manifestPath = module('rsc.io/quote v1.5.1 h1:old=\n');
    const runner = new FakeRunner((cwd) => {
      writeFileSync(join(cwd, 'go.mod'), 'module example.com/a\n\n// partially written\n');
      return { stdout: '', stderr: 'go: missing go.sum entry', exitCode: 1 };
    });

    const outcome = await createUpdater(runner).update({
      manifestPath,
      name: 'rsc.io/quote',
      version: 'v1.5.2',
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.message).toMatch(/missing go\.sum entry/);
    expect(readFileSync(manifestPath, 'utf8')).toBe('module example.com/a\n\n// partially written\n');
  });
});
