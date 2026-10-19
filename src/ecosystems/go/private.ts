import { goEnv, type GoRunner } from './runner';

export interface PrivateMatcher {
  isPrivate(modulePath: string): Promise<boolean>;
}

/**
 * Reads GOPRIVATE/GONOPROXY once per session. An unreadable configuration
 * fails closed: callers must not send module paths anywhere.
 */
export function createPrivateMatcher(runner: GoRunner): PrivateMatcher {
  let patterns: string[] | undefined;

  const load = async (): Promise<string[]> => {
    if (patterns !== undefined) {
      return patterns;
    }
    const result = await runner.run(['env', 'GOPRIVATE', 'GONOPROXY'], {
      cwd: process.cwd(),
      env: goEnv(),
      timeoutMs: 10_000,
    });
    if (result.exitCode !== 0) {
      throw new Error('GMM could not read GOPRIVATE/GONOPROXY from go env.');
    }
    patterns = result.stdout
      .split(/\r?\n/)
      .flatMap((line) => line.split(','))
      .map((pattern) => pattern.trim())
      .filter((pattern) => pattern !== '');
    return patterns;
  };

  return {
    async isPrivate(modulePath) {
      const globs = await load();
      const parts = modulePath.split('/');
      const prefixes = parts.map((_, index) => parts.slice(0, index + 1).join('/'));
      return globs.some((pattern) =>
        prefixes.some((prefix) => globMatches(pattern, prefix)),
      );
    },
  };
}

/**
 * Go's GOPRIVATE matching is prefix-based with path globs: `github.com/acme/*`
 * also covers `github.com/acme/internal/sub`.
 */
function globMatches(pattern: string, value: string): boolean {
  const source = [...pattern]
    .map((char) => {
      if (char === '*') {
        return '[^/]*';
      }
      if (char === '?') {
        return '[^/]';
      }
      return char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${source}$`).test(value);
}
