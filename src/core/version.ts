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
 * A pseudo-version names a commit rather than a release, in one of the three
 * shapes the go command produces:
 *   v0.0.0-20240101120000-abcdef123456
 *   v1.2.3-0.20240101120000-abcdef123456
 *   v1.2.4-0.20240101120000-abcdef123456
 */
const PSEUDO_RE = /^v\d+\.\d+\.\d+-(?:0\.)?\d{14}-[0-9a-f]{12}$/;

export function isPseudoVersion(version: string): boolean {
  return PSEUDO_RE.test(version);
}

/**
 * Inspector copy when the row is a commit pin with no stable candidate
 * (ADR 0004 / ADR 0012). Silent when Updates already has a target, the row
 * is replaced, or the pin is not a pseudo-version.
 */
export function commitPinUpdateNote(input: {
  readonly resolvedVersion?: string;
  readonly declaredVersion: string;
  readonly candidate?: string;
  readonly replaced?: boolean;
}): string | undefined {
  if (input.replaced === true || input.candidate !== undefined) {
    return undefined;
  }
  const pin = input.resolvedVersion ?? input.declaredVersion;
  if (!isPseudoVersion(pin)) {
    return undefined;
  }
  return 'No tagged release newer than this commit.';
}

/**
 * SemVer precedence, including prerelease ordering. Unparseable versions
 * compare equal; callers that need certainty check `parseVersion` first.
 */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) {
    return 0;
  }
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  if (a.patch !== b.patch) {
    return a.patch - b.patch;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

function comparePrerelease(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  // A release outranks any prerelease of the same version.
  if (left === '') {
    return 1;
  }
  if (right === '') {
    return -1;
  }

  const a = left.split('.');
  const b = right.split('.');
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const ai = a[index];
    const bi = b[index];
    if (ai === undefined) {
      return -1;
    }
    if (bi === undefined) {
      return 1;
    }

    const aNumeric = /^\d+$/.test(ai);
    const bNumeric = /^\d+$/.test(bi);
    if (aNumeric && bNumeric) {
      const difference = Number(ai) - Number(bi);
      if (difference !== 0) {
        return difference;
      }
      continue;
    }
    if (aNumeric) {
      return -1;
    }
    if (bNumeric) {
      return 1;
    }
    if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }

  return 0;
}

/**
 * Classifies a move between two versions of the same dependency.
 * A major-version path change is never an update, so it cannot appear here.
 * Ecosystems where a resolved version can be a commit classify that case
 * before calling this, because a commit is not a SemVer version.
 */
export type VersionApplyOffer =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/**
 * Whether the inspector may run `go get` for the chosen version. Downgrades
 * need an impact preview first; prereleases stay hidden until the user asks.
 */
export function versionApplyOffer(
  resolved: string | undefined,
  chosen: string,
  options: { readonly includePrereleases?: boolean; readonly allowDowngrade?: boolean } = {},
): VersionApplyOffer {
  if (resolved !== undefined && chosen === resolved) {
    return { allowed: false, reason: 'Already resolved at this version' };
  }
  if (resolved !== undefined && compareVersions(chosen, resolved) < 0) {
    if (options.allowDowngrade === true) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: 'Preview the impact before downgrading.',
    };
  }
  if (options.includePrereleases !== true && isPrerelease(chosen)) {
    return {
      allowed: false,
      reason: 'Prereleases are hidden until you ask to show them.',
    };
  }
  return { allowed: true };
}

/** Versions shown in the picker; prereleases stay out until asked. */
export function pickerVersions(
  versions: readonly string[],
  options: { readonly includePrereleases?: boolean } = {},
): string[] {
  return versions.filter(
    (version) =>
      parseVersion(version) !== undefined &&
      (options.includePrereleases === true || !isPrerelease(version)),
  );
}

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
