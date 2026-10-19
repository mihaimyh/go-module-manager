import type { Advisory } from './model';
import { compareVersions, parseVersion } from './version';

export type AdvisoryFix =
  | { readonly offered: true; readonly version: string }
  | { readonly offered: false; readonly reason: string };

/**
 * Whether the advisory card may offer "update to the fixed version". The fix
 * must be a SemVer strictly above the resolved version; the module path is the
 * same by construction, so a major-version migration can never hide here.
 */
export function advisoryFix(
  advisory: Advisory,
  resolvedVersion: string | undefined,
): AdvisoryFix {
  if (resolvedVersion === undefined) {
    return { offered: false, reason: 'The resolved version is unknown.' };
  }
  if (advisory.fixedIn === undefined) {
    return { offered: false, reason: 'No fixed version is published for this module.' };
  }
  if (parseVersion(advisory.fixedIn) === undefined || parseVersion(resolvedVersion) === undefined) {
    return { offered: false, reason: 'The fixed version cannot be compared.' };
  }
  if (compareVersions(advisory.fixedIn, resolvedVersion) <= 0) {
    return { offered: false, reason: 'The resolved version is already at or above the fix.' };
  }
  return { offered: true, version: advisory.fixedIn };
}
