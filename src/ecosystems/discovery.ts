import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Project directories are the workspace root (when it holds a manifest) and its
 * immediate children. Deeper layouts would need a workspace file, which the
 * adapter does not read.
 */
export function findManifestDirectories(
  workspaceRoot: string,
  manifestFile: string,
): readonly string[] {
  const directories: string[] = [];

  if (existsSync(join(workspaceRoot, manifestFile))) {
    directories.push(workspaceRoot);
  }

  for (const entry of readdirSync(workspaceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const directory = join(workspaceRoot, entry.name);
    if (existsSync(join(directory, manifestFile))) {
      directories.push(directory);
    }
  }

  return directories;
}
