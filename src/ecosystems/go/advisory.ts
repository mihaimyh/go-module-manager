import type { Advisory } from '../../core/model';
import { compareVersions, parseVersion } from '../../core/version';

export interface AffectedRange {
  readonly module: string;
  readonly introduced?: string;
  readonly fixed?: string;
}

/** The subset of an advisory document the matcher needs. */
export interface AdvisoryDocument {
  readonly id: string;
  readonly summary: string;
  readonly ranges: readonly AffectedRange[];
}

export interface AdvisorySource {
  lookup(
    dependencies: readonly { readonly name: string; readonly version: string }[],
  ): Promise<ReadonlyMap<string, readonly Advisory[]>>;
}

/**
 * Pure: matches declarations against affected ranges. A version is affected
 * when it is at or above `introduced` and below `fixed`; a range without a
 * `fixed` bound is open-ended.
 */
export function matchAdvisories(
  documents: readonly AdvisoryDocument[],
  dependencies: readonly { readonly name: string; readonly version: string }[],
): ReadonlyMap<string, readonly Advisory[]> {
  const byModule = new Map<string, AdvisoryDocument[]>();
  for (const document of documents) {
    for (const range of document.ranges) {
      const documentsForModule = byModule.get(range.module) ?? [];
      if (!documentsForModule.includes(document)) {
        documentsForModule.push(document);
      }
      byModule.set(range.module, documentsForModule);
    }
  }

  const result = new Map<string, readonly Advisory[]>();

  for (const dependency of dependencies) {
    if (parseVersion(dependency.version) === undefined) {
      continue;
    }

    const matches: Advisory[] = [];
    for (const document of byModule.get(dependency.name) ?? []) {
      const ranges = document.ranges.filter((range) => range.module === dependency.name);
      const affecting = ranges.find((range) => affects(range, dependency.version));
      if (affecting === undefined) {
        continue;
      }

      const fixedIn = fixedVersionOf(ranges, dependency.version);
      matches.push({
        id: document.id,
        summary: document.summary,
        ...(fixedIn === undefined ? {} : { fixedIn }),
      });
    }

    if (matches.length > 0) {
      result.set(dependency.name, dedupeById(matches));
    }
  }

  return result;
}

function affects(range: AffectedRange, version: string): boolean {
  const introduced = normalizeBound(range.introduced);
  if (introduced !== undefined && compareVersions(version, introduced) < 0) {
    return false;
  }
  if (range.fixed !== undefined && compareVersions(version, range.fixed) >= 0) {
    return false;
  }
  return true;
}

/** The lowest fixed bound above the resolved version, if the advisory has one. */
function fixedVersionOf(
  ranges: readonly AffectedRange[],
  version: string,
): string | undefined {
  const fixes = ranges
    .flatMap((range) => (range.fixed === undefined ? [] : [range.fixed]))
    .filter((fixed) => compareVersions(fixed, version) > 0)
    .sort(compareVersions);
  return fixes[0];
}

/** Go's database writes "0" for "from the first version". */
function normalizeBound(bound: string | undefined): string | undefined {
  if (bound === undefined || bound === '0') {
    return undefined;
  }
  return bound;
}

function dedupeById(advisories: readonly Advisory[]): Advisory[] {
  const seen = new Set<string>();
  return advisories.filter((advisory) => {
    if (seen.has(advisory.id)) {
      return false;
    }
    seen.add(advisory.id);
    return true;
  });
}
