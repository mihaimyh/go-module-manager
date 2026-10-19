import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readWorkspace } from './read';
import type { GoRunner, RunOptions, RunResult } from './runner';

class FakeRunner implements GoRunner {
  constructor(private readonly stdout: string) {}

  async run(_args: readonly string[], _options: RunOptions): Promise<RunResult> {
    return { stdout: this.stdout, stderr: '', exitCode: 0 };
  }
}

let workspace: string | undefined;

afterEach(() => {
  if (workspace !== undefined) {
    rmSync(workspace, { recursive: true, force: true });
    workspace = undefined;
  }
});

function root(): string {
  workspace = mkdtempSync(join(tmpdir(), 'gmm-read-'));
  writeFileSync(join(workspace, 'go.mod'), 'module example.com/app\n');
  return workspace;
}

describe('reading replace directives', () => {
  it('attaches a wildcard replace to the declared dependency', async () => {
    const mod = JSON.stringify({
      Module: { Path: 'example.com/app' },
      Require: [{ Path: 'github.com/upstream/lib', Version: 'v1.2.0' }],
      Replace: [
        {
          Old: { Path: 'github.com/upstream/lib' },
          New: { Path: 'github.com/me/fork', Version: 'v1.3.0' },
        },
      ],
    });

    const model = await readWorkspace(root(), new FakeRunner(mod));

    expect(model.rows).toEqual([
      expect.objectContaining({
        name: 'github.com/upstream/lib',
        declaredVersion: 'v1.2.0',
        replacement: { path: 'github.com/me/fork', version: 'v1.3.0' },
      }),
    ]);
  });

  it('matches a version-pinned replace and keeps a local path local', async () => {
    const mod = JSON.stringify({
      Module: { Path: 'example.com/app' },
      Require: [{ Path: 'example.com/exact', Version: 'v1.0.0' }],
      Replace: [
        {
          Old: { Path: 'example.com/exact', Version: 'v1.0.0' },
          New: { Path: '../exact' },
        },
      ],
    });

    const model = await readWorkspace(root(), new FakeRunner(mod));

    expect(model.rows[0]?.replacement).toEqual({ path: '../exact' });
  });

  it('does not attach a replace pinned to another version', async () => {
    const mod = JSON.stringify({
      Module: { Path: 'example.com/app' },
      Require: [{ Path: 'example.com/lib', Version: 'v2.0.0' }],
      Replace: [
        {
          Old: { Path: 'example.com/lib', Version: 'v1.0.0' },
          New: { Path: 'github.com/me/lib', Version: 'v1.1.0' },
        },
      ],
    });

    const model = await readWorkspace(root(), new FakeRunner(mod));

    expect(model.rows[0]?.replacement).toBeUndefined();
  });
});
