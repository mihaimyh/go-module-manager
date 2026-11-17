/**
 * Host-path smoke for the Update-selected follow-up pipeline (no VS Code UI).
 * Uses a copy of the fixture workspace and a real `go` toolchain.
 *
 * Run: node scripts/ui-path-smoke.mjs
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));

// Build the CJS model entry so we can require compiled sources via esbuild bundle.
const { build } = await import('esbuild');
const outfile = join(root, 'dist', 'ui-path-smoke.cjs');
await build({
  entryPoints: [join(root, 'scripts', 'ui-path-smoke-entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  logLevel: 'silent',
});

const { run } = require(outfile);
const code = await run(root);
process.exit(code);
