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

  const text = await fetchText(
    `${PROXY_LIST}${encodeModulePath(modulePath)}/@v/list`,
  );

  return [...new Set(text.split(/\r?\n/).map((line) => line.trim()))]
    .filter((version) => version !== '' && parseVersion(version) !== undefined)
    .sort((left, right) => compareVersions(right, left));
}

export { VERSIONS_TIMEOUT_MS };
