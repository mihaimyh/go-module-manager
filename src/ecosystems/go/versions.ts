import { compareVersions, parseVersion } from '../../core/version';
import { createPrivateMatcher, type PrivateMatcher } from './private';
import type { GoRunner } from './runner';

const PROXY_LIST = 'https://proxy.golang.org/';
const VERSIONS_TIMEOUT_MS = 15_000;

/** Go's proxy encodes every uppercase letter as `!` plus its lowercase form. */
export function encodeModulePath(modulePath: string): string {
  return modulePath.replace(/[A-Z]/g, (character) => `!${character.toLowerCase()}`);
}

export interface VersionsOptions {
  readonly fetchText: (url: string) => Promise<string>;
  readonly runner: GoRunner;
}

/**
 * All tagged versions of a module, newest first, from the public Go proxy.
 * Private module paths are never requested; pseudo-versions are never listed
 * by the proxy and stay as the rows already know them.
 */
export function createVersionsFetcher(options: VersionsOptions) {
  const cache = new Map<string, Promise<readonly string[]>>();
  const matcher: PrivateMatcher = createPrivateMatcher(options.runner);

  return {
    fetch(modulePath: string): Promise<readonly string[]> {
      const cached = cache.get(modulePath);
      if (cached !== undefined) {
        return cached;
      }

      const pending = load(modulePath, options.fetchText, matcher);
      cache.set(modulePath, pending);
      void pending.catch(() => cache.delete(modulePath));
      return pending;
    },
  };
}

async function load(
  modulePath: string,
  fetchText: (url: string) => Promise<string>,
  matcher: PrivateMatcher,
): Promise<readonly string[]> {
  if (await matcher.isPrivate(modulePath)) {
    return [];
  }

  const encoded = encodeModulePath(modulePath);
  const text = await fetchText(`${PROXY_LIST}${encoded}/@v/list`);
  const versions = [...new Set(text.split(/\r?\n/).map((line) => line.trim()))]
    .filter((version) => version !== '' && parseVersion(version) !== undefined)
    .sort((left, right) => compareVersions(right, left));

  const retracted = await retractedVersions(encoded, fetchText);
  return versions.filter((version) => !isRetracted(version, retracted));
}

interface RetractRange {
  readonly low: string;
  readonly high: string;
}

/**
 * Retractions are declared in the go.mod of the module's latest version, not in
 * the version list. Two requests (latest, then its .mod) avoid asking for every
 * version's file.
 */
async function retractedVersions(
  encodedPath: string,
  fetchText: (url: string) => Promise<string>,
): Promise<readonly RetractRange[]> {
  try {
    const latestRaw = await fetchText(`${PROXY_LIST}${encodedPath}/@latest`);
    const latest = (JSON.parse(latestRaw) as { Version?: unknown }).Version;
    if (typeof latest !== 'string') {
      return [];
    }
    const goMod = await fetchText(
      `${PROXY_LIST}${encodedPath}/@v/${latest}.mod`,
    );
    return parseRetracts(goMod);
  } catch {
    // No latest version, or no retraction data: keep the list.
    return [];
  }
}

export function parseRetracts(goMod: string): readonly RetractRange[] {
  const ranges: RetractRange[] = [];
  let inBlock = false;

  for (const rawLine of goMod.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (line === '') {
      continue;
    }
    if (/^retract\s*\(\s*$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock && line === ')') {
      inBlock = false;
      continue;
    }
    const body = inBlock ? line : /^retract\s+(.+)$/.exec(line)?.[1];
    if (body === undefined || body === null) {
      continue;
    }
    const single = /^(v\d+\.\d+\.\d+\S*)$/.exec(body);
    if (single?.[1] !== undefined) {
      ranges.push({ low: single[1], high: single[1] });
      continue;
    }
    const interval = /^\[\s*(\S+)\s*,\s*(\S+)\s*\]$/.exec(body);
    if (interval?.[1] !== undefined && interval[2] !== undefined) {
      ranges.push({ low: interval[1], high: interval[2] });
    }
  }

  return ranges;
}

function isRetracted(version: string, ranges: readonly RetractRange[]): boolean {
  return ranges.some(
    (range) =>
      compareVersions(version, range.low) >= 0 && compareVersions(version, range.high) <= 0,
  );
}

export { VERSIONS_TIMEOUT_MS };
