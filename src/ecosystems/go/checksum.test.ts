import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanChecksumCache } from './checksum';
import type { GoRunner, RunOptions, RunResult } from './runner';

class FakeRunner implements GoRunner {
  constructor(private readonly stdout: string, private readonly exitCode = 0) {}

  async run(_args: readonly string[], _options: RunOptions): Promise<RunResult> {
    return { stdout: this.stdout, stderr: '', exitCode: this.exitCode };
  }
}

let workspace: string | undefined;

afterEach(() => {
  if (workspace !== undefined) {
    rmSync(workspace, { recursive: true, force: true });
    workspace = undefined;
  }
});

function moduleCache(): string {
  workspace = mkdtempSync(join(tmpdir(), 'gmm-sumdb-'));
  mkdirSync(join(workspace, 'cache', 'download', 'sumdb', 'sum.golang.org'), {
    recursive: true,
  });
  mkdirSync(join(workspace, 'cache', 'download', 'rsc.io'), { recursive: true });
  writeFileSync(join(workspace, 'cache', 'download', 'sumdb', 'sum.golang.org', 'note'), 'broken');
  writeFileSync(join(workspace, 'cache', 'download', 'rsc.io', 'keep'), 'module');
  return workspace;
}

describe('cleanChecksumCache', () => {
  it('removes the sumdb cache and keeps downloaded modules', async () => {
    const cache = moduleCache();

    await cleanChecksumCache(new FakeRunner(`${cache}\n`));

    expect(existsSync(join(cache, 'cache', 'download', 'sumdb'))).toBe(false);
    expect(existsSync(join(cache, 'cache', 'download', 'rsc.io', 'keep'))).toBe(true);
  });

  it('fails when go env cannot report the module cache', async () => {
    await expect(cleanChecksumCache(new FakeRunner('', 1))).rejects.toThrow(
      /GOMODCACHE/,
    );
  });
});
