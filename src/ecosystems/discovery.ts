import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MAX_DEPTH = 6;
const MAX_DIRECTORIES = 5000;

const SKIPPED = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'target',
  'coverage',
]);

/**
 * Finds project directories by walking down from the workspace root.
 *
 * Skips dependency and tooling directories (and every dot-directory), stops
 * descending once a directory holds a manifest — a Go module is the project
 * boundary — and caps the walk so a pathological tree cannot hang the panel.
 */
export function findManifestDirectories(
  workspaceRoot: string,
  manifestFile: string,
): readonly string[] {
  const found: string[] = [];
  let visited = 0;

  const walk = (directory: string, depth: number): void => {
    if (visited >= MAX_DIRECTORIES) {
      return;
    }
    visited += 1;

    if (existsSync(join(directory, manifestFile))) {
      found.push(directory);
      return;
    }
    if (depth >= MAX_DEPTH) {
      return;
    }

    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIPPED.has(entry.name)) {
        continue;
      }
      walk(join(directory, entry.name), depth + 1);
    }
  };

  walk(workspaceRoot, 0);
  return found.sort();
}
