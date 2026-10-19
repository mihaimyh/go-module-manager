import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PreviewResult, UpdateRequest } from '../../core/adapter';
import { compareVersions } from '../../core/version';
import { parseGoModJson, type GoModRequire } from './goJson';
import { firstLine, goEnv, type GoRunner } from './runner';

const PREVIEW_TIMEOUT_MS = 120_000;
const READ_TIMEOUT_MS = 60_000;

interface Snapshot {
  readonly goMod: string;
  readonly goSum?: string;
}

/**
 * Runs `go get` so Minimum Version Selection is real, diffs require lines,
 * then restores the files. Does not consume the session Undo snapshot.
 */
export async function previewUpdate(
  request: UpdateRequest,
  runner: GoRunner,
): Promise<PreviewResult> {
  const change = request.changes[0];
  if (change === undefined) {
    return {
      manifestPath: request.manifestPath,
      name: '',
      version: '',
      status: 'failed',
      impact: [],
      message: 'Nothing to preview.',
    };
  }

  const snapshot = snapshotOf(request.manifestPath);
  const before = await editJson(request.manifestPath, runner);

  const targets = request.changes.map((entry) => `${entry.name}@${entry.version}`);
  const got = await runner.run(['get', ...targets], {
    cwd: dirname(request.manifestPath),
    env: goEnv(),
    timeoutMs: PREVIEW_TIMEOUT_MS,
  });

  if (got.exitCode !== 0) {
    restore(request.manifestPath, snapshot);
    return {
      manifestPath: request.manifestPath,
      name: change.name,
      version: change.version,
      status: 'failed',
      impact: [],
      message: firstLine(got.stderr),
    };
  }

  try {
    const after = await editJson(request.manifestPath, runner);
    return {
      manifestPath: request.manifestPath,
      name: change.name,
      version: change.version,
      status: 'ready',
      impact: diffRequires(before, after),
    };
  } finally {
    restore(request.manifestPath, snapshot);
  }
}

async function editJson(manifestPath: string, runner: GoRunner): Promise<readonly GoModRequire[]> {
  const result = await runner.run(['mod', 'edit', '-json'], {
    cwd: dirname(manifestPath),
    env: goEnv(),
    timeoutMs: READ_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    return [];
  }
  return parseGoModJson(result.stdout).Require ?? [];
}

function diffRequires(
  before: readonly GoModRequire[],
  after: readonly GoModRequire[],
): PreviewResult['impact'] {
  const previous = new Map(
    before
      .filter((entry) => typeof entry.Path === 'string' && typeof entry.Version === 'string')
      .map((entry) => [entry.Path as string, entry.Version as string]),
  );
  const next = new Map(
    after
      .filter((entry) => typeof entry.Path === 'string' && typeof entry.Version === 'string')
      .map((entry) => [entry.Path as string, entry.Version as string]),
  );

  const impact: PreviewResult['impact'][number][] = [];

  for (const [name, from] of previous) {
    const to = next.get(name);
    if (to === undefined) {
      impact.push({ name, kind: 'removed', from });
      continue;
    }
    if (to === from) {
      continue;
    }
    impact.push({
      name,
      kind: compareVersions(to, from) < 0 ? 'lowered' : 'raised',
      from,
      to,
    });
  }

  for (const [name, to] of next) {
    if (!previous.has(name)) {
      impact.push({ name, kind: 'raised', to });
    }
  }

  return impact.sort((left, right) => left.name.localeCompare(right.name));
}

function snapshotOf(manifestPath: string): Snapshot {
  const goMod = readFileSync(manifestPath, 'utf8');
  const sumPath = join(dirname(manifestPath), 'go.sum');
  return existsSync(sumPath) ? { goMod, goSum: readFileSync(sumPath, 'utf8') } : { goMod };
}

function restore(manifestPath: string, snapshot: Snapshot): void {
  writeFileSync(manifestPath, snapshot.goMod);
  const sumPath = join(dirname(manifestPath), 'go.sum');
  if (snapshot.goSum === undefined) {
    rmSync(sumPath, { force: true });
  } else {
    writeFileSync(sumPath, snapshot.goSum);
  }
}
