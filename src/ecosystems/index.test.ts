import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectAdapters } from './index';

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

  it('reuses the adapter so its cache and undo snapshot survive a reload', () => {
    const root = newWorkspace();
    const module = join(root, 'api');
    mkdirSync(module, { recursive: true });
    writeFileSync(join(module, 'go.mod'), 'module example.com/api\n');

    expect(detectAdapters(root)[0]).toBe(detectAdapters(root)[0]);
  });
});
