import type { Advisory } from './model';
import { compareVersions, isPrerelease, parseVersion } from './version';

export type AdvisoryFixOffer =
  | { readonly offered: true; readonly version: string }
  | { readonly offered: false; readonly reason: string };

/**
 * Whether the advisory card may offer "update to the fixed version".
 *
 * The same-path invariant is enforced upstream: `matchAdvisories` only matches
 * a range against its own module, so a fix can never point at another module.
 * Here we refuse anything the update flow must not do: a downgrade, a
 * prerelease (ADR-0004 hides those by default), or a different major (which in
 * Go is a different module path entirely).
 */
export function advisoryFixOffer(
  advisory: Advisory,
  resolvedVersion: string | undefined,
): AdvisoryFixOffer {
  if (resolvedVersion === undefined) {
    return { offered: false, reason: 'The resolved version is unknown.' };
  }
  if (advisory.fixedIn === undefined) {
    return { offered: false, reason: 'No fixed version is published for this module.' };
  }

  const fixed = parseVersion(advisory.fixedIn);
  const resolved = parseVersion(resolvedVersion);
  if (fixed === undefined || resolved === undefined) {
    return { offered: false, reason: 'The fixed version cannot be compared.' };
  }
  if (compareVersions(advisory.fixedIn, resolvedVersion) <= 0) {
    return {
      offered: false,
      reason: 'The advisory data is out of date for the resolved version.',
    };
  }
  if (isPrerelease(advisory.fixedIn)) {
    return { offered: false, reason: 'The fix is only available as a prerelease.' };
  }
  if (fixed.major !== resolved.major) {
    return { offered: false, reason: 'The fix is a different major module path.' };
  }

  return { offered: true, version: advisory.fixedIn };
}
