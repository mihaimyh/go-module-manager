import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGoAdapter } from './adapter';
import type { GoRunner, RunOptions, RunResult } from './runner';

class FakeRunner implements GoRunner {
  readonly calls: { args: readonly string[]; options: RunOptions }[] = [];

  constructor(private readonly respond: (cwd: string) => RunResult) {}

  async run(args: readonly string[], options: RunOptions): Promise<RunResult> {
    this.calls.push({ args, options });
    return this.respond(options.cwd);
  }
}

interface RecordedRequire {
  readonly path: string;
  readonly version: string;
  readonly indirect?: boolean;
}

function goModJson(name: string, requires: readonly RecordedRequire[]): string {
  return JSON.stringify({
    Module: { Path: name },
    Go: '1.21',
    Require: requires.map((require) => ({
      Path: require.path,
      Version: require.version,
      ...(require.indirect === true ? { Indirect: true } : {}),
    })),
  });
}

let workspace: string | undefined;

afterEach(() => {
  if (workspace !== undefined) {
    rmSync(workspace, { recursive: true, force: true });
    workspace = undefined;
  }
});

function newWorkspace(): string {
  workspace = mkdtempSync(join(tmpdir(), 'gmm-read-'));
  return workspace;
}

function moduleAt(parent: string, directory: string): string {
  const path = join(parent, directory);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'go.mod'), `module example.com/${directory}\n`);
  return path;
}

describe('reading declared dependencies', () => {
  it('reads one project through the runner', async () => {
    const root = newWorkspace();
    const project = moduleAt(root, 'a');
    const runner = new FakeRunner(() => ({
      stdout: goModJson('example.com/a', [
        { path: 'rsc.io/quote', version: 'v1.5.1' },
        { path: 'rsc.io/sampler', version: 'v1.3.0', indirect: true },
      ]),
      stderr: '',
      exitCode: 0,
    }));

    const model = await createGoAdapter(runner).read(root);

    expect(model.projects.map((entry) => entry.name)).toEqual(['example.com/a']);
    expect(
      model.rows.map((row) => [row.name, row.declaredVersion, row.transitive]),
    ).toEqual([
      ['rsc.io/quote', 'v1.5.1', false],
      ['rsc.io/sampler', 'v1.3.0', true],
    ]);
    expect(model.rows.every((row) => row.candidate === undefined)).toBe(true);
    expect(model.rows.every((row) => row.resolvedVersion === undefined)).toBe(true);

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.args).toEqual(['mod', 'edit', '-json']);
    expect(runner.calls[0]?.options.cwd).toBe(project);
    expect(runner.calls[0]?.options.env).toMatchObject({ ...process.env, GOWORK: 'off' });
  });

  it('aggregates every project in the workspace', async () => {
    const root = newWorkspace();
    const first = moduleAt(root, 'a');
    const second = moduleAt(root, 'b');
    const runner = new FakeRunner((cwd) => ({
      stdout: goModJson(cwd === first ? 'example.com/a' : 'example.com/b', [
        { path: 'rsc.io/quote', version: cwd === first ? 'v1.5.1' : 'v1.5.2' },
      ]),
      stderr: '',
      exitCode: 0,
    }));

    const model = await createGoAdapter(runner).read(root);

    expect(model.projects.map((entry) => entry.name)).toEqual([
      'example.com/a',
      'example.com/b',
    ]);
    expect(model.rows.map((row) => [row.project, row.declaredVersion])).toEqual([
      ['example.com/a', 'v1.5.1'],
      ['example.com/b', 'v1.5.2'],
    ]);
    expect(runner.calls.map((call) => call.options.cwd).sort()).toEqual(
      [first, second].sort(),
    );
  });

  it('aggregates projects from every workspace folder', async () => {
    const firstRoot = newWorkspace();
    const first = moduleAt(firstRoot, 'a');
    const secondRoot = mkdtempSync(join(tmpdir(), 'gmm-read-b-'));
    moduleAt(secondRoot, 'b');
    const runner = new FakeRunner((cwd) => ({
      stdout: goModJson(cwd === first ? 'example.com/a' : 'example.com/b', [
        { path: 'rsc.io/quote', version: 'v1.5.1' },
      ]),
      stderr: '',
      exitCode: 0,
    }));

    try {
      const model = await createGoAdapter(runner).read([firstRoot, secondRoot]);
      expect(model.projects.map((entry) => entry.name).sort()).toEqual([
        'example.com/a',
        'example.com/b',
      ]);
    } finally {
      rmSync(secondRoot, { recursive: true, force: true });
    }
  });

  it('keeps a failed project visible beside the healthy ones', async () => {
    const root = newWorkspace();
    const healthy = moduleAt(root, 'a');
    moduleAt(root, 'broken');
    const runner = new FakeRunner((cwd) =>
      cwd === healthy
        ? {
            stdout: goModJson('example.com/a', [
              { path: 'rsc.io/quote', version: 'v1.5.1' },
            ]),
            stderr: '',
            exitCode: 0,
          }
        : { stdout: '', stderr: 'go: errors parsing go.mod:\nunknown directive', exitCode: 1 },
    );

    const model = await createGoAdapter(runner).read(root);

    expect(model.projects.map((entry) => entry.name)).toEqual(['broken', 'example.com/a']);
    expect(model.projects[0]?.failure?.kind).toBe('unknown');
    expect(model.projects[0]?.failure?.message).toMatch(/errors parsing/);
    expect(model.rows).toHaveLength(1);
  });

  it('reports every failing project without losing them', async () => {
    const root = newWorkspace();
    moduleAt(root, 'broken');
    const runner = new FakeRunner(() => ({
      stdout: '',
      stderr: 'go: errors parsing go.mod:\nunknown directive',
      exitCode: 1,
    }));

    const model = await createGoAdapter(runner).read(root);

    expect(model.projects).toHaveLength(1);
    expect(model.projects[0]?.failure?.kind).toBe('unknown');
    expect(model.rows).toHaveLength(0);
  });
});
