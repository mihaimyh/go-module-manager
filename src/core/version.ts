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

/**
 * A pseudo-version names a commit rather than a release, in one of the three
 * shapes the go command produces:
 *   v0.0.0-20240101120000-abcdef123456
 *   v1.2.3-0.20240101120000-abcdef123456
 *   v1.2.4-0.20240101120000-abcdef123456
 */
const PSEUDO_RE = /^v\d+\.\d+\.\d+-(?:0\.)?\d{14}-[0-9a-f]{12}$/;

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

export function isPseudoVersion(version: string): boolean {
  return PSEUDO_RE.test(version);
}

export function isPrerelease(version: string): boolean {
  if (isPseudoVersion(version)) {
    return false;
  }
  const parsed = parseVersion(version);
  return parsed !== undefined && parsed.prerelease !== '';
}

/**
 * Classifies a move between two versions of the same module path.
 * A major-version module path change is never an update, so it cannot appear here.
 */
export function classifyUpdate(from: string, to: string): UpdateKind {
  if (from === to) {
    return 'none';
  }
  if (isPseudoVersion(from) && !isPseudoVersion(to)) {
    return 'release';
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

export interface ModulePathInfo {
  readonly base: string;
  readonly major: number;
}

/**
 * From v2 onwards the major version is part of the module path: `example.com/m/v2`.
 * gopkg.in uses a dot form (`gopkg.in/yaml.v3`) for the same idea.
 */
export function splitModulePath(modulePath: string): ModulePathInfo {
  const lowered = /^(.*)\/v(\d+)$/.exec(modulePath);
  if (lowered && Number(lowered[2]) >= 2) {
    return { base: lowered[1] ?? modulePath, major: Number(lowered[2]) };
  }
  const gopkg = /^(.*)\.v(\d+)$/.exec(modulePath);
  if (gopkg && Number(gopkg[2]) >= 2) {
    return { base: gopkg[1] ?? modulePath, major: Number(gopkg[2]) };
  }
  return { base: modulePath, major: 1 };
}

export function isSameModulePath(a: string, b: string): boolean {
  const left = splitModulePath(a);
  const right = splitModulePath(b);
  return left.base === right.base && left.major === right.major;
}
