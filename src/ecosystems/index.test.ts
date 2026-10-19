import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectAdapters } from './index';
import { findManifestDirectories } from './discovery';

let workspace: string | undefined;

afterEach(() => {
  if (workspace !== undefined) {
    rmSync(workspace, { recursive: true, force: true });
    workspace = undefined;
  }
});

function newWorkspace(): string {
  workspace = mkdtempSync(join(tmpdir(), 'gmm-detect-'));
  return workspace;
}

describe('detectAdapters', () => {
  it('reports nothing when the workspace has no supported manifest', () => {
    const root = newWorkspace();
    mkdirSync(join(root, 'src'));

    expect(detectAdapters(root)).toEqual([]);
  });

  it('detects Go from a nested go.mod', () => {
    const root = newWorkspace();
    const module = join(root, 'api');
    mkdirSync(module, { recursive: true });
    writeFileSync(join(module, 'go.mod'), 'module example.com/api\n');

    expect(detectAdapters(root).map((adapter) => adapter.id)).toEqual(['go']);
  });

  it('finds a manifest several levels down', () => {
    const root = newWorkspace();
    const module = join(root, 'src', 'backend', 'server');
    mkdirSync(module, { recursive: true });
    writeFileSync(join(module, 'go.mod'), 'module example.com/server\n');

    expect(detectAdapters(root).map((adapter) => adapter.id)).toEqual(['go']);
  });

  it('skips dependency, tooling and dot directories', () => {
    const root = newWorkspace();
    const skipped = join(root, 'node_modules', 'pkg');
    const worktree = join(root, '.kilo', 'worktrees', 'copy');
    mkdirSync(skipped, { recursive: true });
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(skipped, 'go.mod'), 'module example.com/pkg\n');
    writeFileSync(join(worktree, 'go.mod'), 'module example.com/copy\n');

    expect(detectAdapters(root)).toEqual([]);
  });

  it('stops descending below a module', () => {
    const root = newWorkspace();
    const module = join(root, 'api');
    const nested = join(module, 'examples', 'demo');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(module, 'go.mod'), 'module example.com/api\n');
    writeFileSync(join(nested, 'go.mod'), 'module example.com/demo\n');

    expect(findManifestDirectories(root, 'go.mod')).toEqual([module]);
  });

  it('detects Go from a go.work even when the walk would miss nested modules', () => {
    const root = newWorkspace();
    const module = join(root, 'api');
    const nested = join(module, 'examples', 'demo');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, 'go.work'), 'go 1.21\nuse ./api/examples/demo\n');
    writeFileSync(join(module, 'go.mod'), 'module example.com/api\n');
    writeFileSync(join(nested, 'go.mod'), 'module example.com/demo\n');

    expect(detectAdapters(root).map((adapter) => adapter.id)).toEqual(['go']);
  });

  it('detects Go when any workspace folder has a manifest', () => {
    const empty = newWorkspace();
    mkdirSync(join(empty, 'docs'));
    const other = mkdtempSync(join(tmpdir(), 'gmm-detect-b-'));
    mkdirSync(join(other, 'api'), { recursive: true });
    writeFileSync(join(other, 'api', 'go.mod'), 'module example.com/api\n');

    try {
      expect(detectAdapters([empty, other]).map((adapter) => adapter.id)).toEqual(['go']);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('reuses the adapter so its cache and undo snapshot survive a reload', () => {
    const root = newWorkspace();
    const module = join(root, 'api');
    mkdirSync(module, { recursive: true });
    writeFileSync(join(module, 'go.mod'), 'module example.com/api\n');

    expect(detectAdapters(root)[0]).toBe(detectAdapters(root)[0]);
  });
});
