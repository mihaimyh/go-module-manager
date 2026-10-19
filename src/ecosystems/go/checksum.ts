import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { delimiter, extname, join } from 'node:path';
import { failureKindFor, GoCommandError } from './errors';
import { firstLine, goEnv, type GoRunner } from './runner';

/** Metadata Go can refetch; a NUL-filled one breaks every command that reads it. */
const REPAIRABLE_EXTENSIONS = new Set(['.mod', '.info', '.ziphash']);
const MAX_METADATA_BYTES = 4 * 1024 * 1024;

/**
 * A checksum failure can come from three places:
 * - `$GOPATH/pkg/sumdb/<name>/latest`, the signed tree note read at startup;
 *   a truncated or zeroed file makes every lookup fail with "malformed note";
 * - `$GOMODCACHE/cache/download/sumdb`, the lookup and tile cache;
 * - metadata such as `.mod` files that a crash or a scanner filled with NULs,
 *   which produce "malformed record data" or "checksum mismatch".
 *
 * All of them are refetched on demand. Downloaded modules live in a sibling
 * directory and are not touched.
 */
export async function cleanChecksumCache(runner: GoRunner): Promise<void> {
  const result = await runner.run(['env', 'GOMODCACHE', 'GOPATH'], {
    cwd: process.cwd(),
    env: goEnv(),
    timeoutMs: 10_000,
  });

  if (result.exitCode !== 0) {
    throw new GoCommandError(
      failureKindFor(result.exitCode, result.stderr),
      `go env GOMODCACHE GOPATH failed: ${firstLine(result.stderr)}`,
    );
  }

  const [moduleCacheLine = '', goPathLine = ''] = result.stdout.split(/\r?\n/);
  const moduleCache = moduleCacheLine.trim();
  if (moduleCache === '') {
    throw new GoCommandError('unknown', 'go env GOMODCACHE returned nothing.');
  }

  rmSync(join(moduleCache, 'cache', 'download', 'sumdb'), {
    recursive: true,
    force: true,
  });
  removeZeroedMetadata(moduleCache);

  // GOPATH may be a list; Go uses the first entry for $GOPATH/pkg/sumdb.
  const goPath = goPathLine.trim().split(delimiter)[0] ?? '';
  if (goPath !== '') {
    rmSync(join(goPath, 'pkg', 'sumdb'), {
      recursive: true,
      force: true,
    });
  }
}

/**
 * Deletes cache metadata whose bytes are all zero while the length is not.
 * Go never writes such a file; they are the residue of an interrupted write or
 * a scanner, and the toolchain trusts them instead of refetching.
 * Returns how many files were removed.
 */
export function removeZeroedMetadata(moduleCache: string): number {
  let removed = 0;
  walk(join(moduleCache, 'cache', 'download'), (path) => {
    if (!REPAIRABLE_EXTENSIONS.has(extname(path))) {
      return;
    }
    try {
      const size = statSync(path).size;
      if (size === 0 || size > MAX_METADATA_BYTES) {
        return;
      }
      if (readFileSync(path).every((byte) => byte === 0)) {
        rmSync(path);
        removed += 1;
      }
    } catch {
      // A file that vanished or cannot be read is not a repair failure.
    }
  });
  return removed;
}

function walk(dir: string, visit: (path: string) => void): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, visit);
    } else if (entry.isFile()) {
      visit(path);
    }
  }
}
