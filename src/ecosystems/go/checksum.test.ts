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

function caches(): { cache: string; goPath: string } {
  workspace = mkdtempSync(join(tmpdir(), 'gmm-sumdb-'));
  const cache = join(workspace, 'mod');
  const goPath = join(workspace, 'gopath');

  mkdirSync(join(cache, 'cache', 'download', 'sumdb', 'sum.golang.org'), {
    recursive: true,
  });
  mkdirSync(join(cache, 'cache', 'download', 'rsc.io'), { recursive: true });
  writeFileSync(join(cache, 'cache', 'download', 'sumdb', 'sum.golang.org', 'note'), 'broken');
  writeFileSync(join(cache, 'cache', 'download', 'rsc.io', 'keep'), 'module');

  mkdirSync(join(cache, 'cache', 'download', 'rsc.io', 'quote', '@v'), { recursive: true });
  writeFileSync(join(cache, 'cache', 'download', 'rsc.io', 'quote', '@v', 'v1.5.2.mod'), 'module rsc.io/quote');
  writeFileSync(join(cache, 'cache', 'download', 'rsc.io', 'quote', '@v', 'v1.5.1.mod'), '\0\0\0\0');

  mkdirSync(join(goPath, 'pkg', 'sumdb', 'sum.golang.org'), { recursive: true });
  writeFileSync(join(goPath, 'pkg', 'sumdb', 'sum.golang.org', 'latest'), '\0\0\0');
  writeFileSync(join(goPath, 'pkg', 'sumdb', 'sum.golang.org', 'key'), 'key');

  return { cache, goPath };
}

describe('cleanChecksumCache', () => {
  it('removes both sumdb caches and keeps downloaded modules', async () => {
    const { cache, goPath } = caches();

    await cleanChecksumCache(new FakeRunner(`${cache}\n${goPath}\n`));

    expect(existsSync(join(cache, 'cache', 'download', 'sumdb'))).toBe(false);
    expect(existsSync(join(goPath, 'pkg', 'sumdb'))).toBe(false);
    expect(existsSync(join(cache, 'cache', 'download', 'rsc.io', 'keep'))).toBe(true);
    expect(
      existsSync(join(cache, 'cache', 'download', 'rsc.io', 'quote', '@v', 'v1.5.2.mod')),
    ).toBe(true);
    expect(
      existsSync(join(cache, 'cache', 'download', 'rsc.io', 'quote', '@v', 'v1.5.1.mod')),
    ).toBe(false);
  });

  it('still clears the lookup cache when GOPATH is not reported', async () => {
    const { cache } = caches();

    await cleanChecksumCache(new FakeRunner(`${cache}\n`));

    expect(existsSync(join(cache, 'cache', 'download', 'sumdb'))).toBe(false);
  });

  it('fails when go env cannot report the module cache', async () => {
    await expect(cleanChecksumCache(new FakeRunner('', 1))).rejects.toThrow(
      /GOMODCACHE/,
    );
  });
});
