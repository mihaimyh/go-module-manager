import { advisoryKey, type Advisory } from '../../core/model';
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
 * Pure: matches resolved versions against affected ranges. A version is
 * affected when it is at or above `introduced` and below `fixed`; a range
 * without a parseable `fixed` bound is open-ended. Results are keyed by
 * `name@version` so two projects at different versions do not share a match.
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
      const affecting = document.ranges
        .filter((range) => range.module === dependency.name)
        .find((range) => affects(range, dependency.version));
      if (affecting === undefined) {
        continue;
      }

      const fixedIn =
        affecting.fixed !== undefined && parseVersion(affecting.fixed) !== undefined
          ? affecting.fixed
          : undefined;

      matches.push({
        id: document.id,
        summary: document.summary,
        ...(fixedIn === undefined ? {} : { fixedIn }),
      });
    }

    if (matches.length > 0) {
      result.set(advisoryKey(dependency.name, dependency.version), matches);
    }
  }

  return result;
}

function affects(range: AffectedRange, version: string): boolean {
  const introduced = normalizeBound(range.introduced);
  if (introduced !== undefined && compareVersions(version, introduced) < 0) {
    return false;
  }
  if (range.fixed === undefined) {
    return true;
  }
  // An unparseable bound cannot be trusted to clear the advisory.
  if (parseVersion(range.fixed) === undefined) {
    return true;
  }
  return compareVersions(version, range.fixed) < 0;
}

/** Go's database writes "0" for "from the first version". */
function normalizeBound(bound: string | undefined): string | undefined {
  if (bound === undefined || bound === '0') {
    return undefined;
  }
  return bound;
}
