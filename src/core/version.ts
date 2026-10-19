export type UpdateKind =
  | 'none'
  | 'patch'
  | 'minor'
  | 'major'
  | 'prerelease'
  | 'release';

export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string;
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(version: string): ParsedVersion | undefined {
  const match = VERSION_RE.exec(version);
  if (!match) {
    return undefined;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? '',
  };
}

export function isPrerelease(version: string): boolean {
  const parsed = parseVersion(version);
  return parsed !== undefined && parsed.prerelease !== '';
}

/**
 * Classifies a move between two versions of the same dependency.
 * A major-version path change is never an update, so it cannot appear here.
 * Ecosystems where a resolved version can be a commit classify that case
 * before calling this, because a commit is not a SemVer version.
 */
export function classifyUpdate(from: string, to: string): UpdateKind {
  if (from === to) {
    return 'none';
  }
  if (isPrerelease(to) && !isPrerelease(from)) {
    return 'prerelease';
  }
  const before = parseVersion(from);
  const after = parseVersion(to);
  if (!before || !after) {
    return 'none';
  }
  if (after.major !== before.major) {
    return 'major';
  }
  if (after.minor !== before.minor) {
    return 'minor';
  }
  if (after.patch !== before.patch) {
    return 'patch';
  }
  return 'prerelease';
}
