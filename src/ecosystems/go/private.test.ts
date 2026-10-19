import { describe, expect, it } from 'vitest';
import { createPrivateMatcher } from './private';
import type { GoRunner, RunOptions, RunResult } from './runner';

class FakeRunner implements GoRunner {
  constructor(private readonly env: string, private readonly exitCode = 0) {}

  async run(_args: readonly string[], _options: RunOptions): Promise<RunResult> {
    return { stdout: this.env, stderr: '', exitCode: this.exitCode };
  }
}

describe('createPrivateMatcher', () => {
  it('matches a prefix pattern and every nested path below it', async () => {
    const matcher = createPrivateMatcher(new FakeRunner('github.com/acme/*'));

    expect(await matcher.isPrivate('github.com/acme/lib')).toBe(true);
    expect(await matcher.isPrivate('github.com/acme/internal/sub')).toBe(true);
    expect(await matcher.isPrivate('github.com/other/lib')).toBe(false);
  });

  it('honours GOPRIVATE and GONOPROXY as a union', async () => {
    const matcher = createPrivateMatcher(
      new FakeRunner('git.corp.example.com/*\n*.internal.example.com'),
    );

    expect(await matcher.isPrivate('git.corp.example.com/team/lib')).toBe(true);
    expect(await matcher.isPrivate('api.internal.example.com/lib')).toBe(true);
    expect(await matcher.isPrivate('rsc.io/quote')).toBe(false);
  });

  it('supports the single-character wildcard', async () => {
    const matcher = createPrivateMatcher(new FakeRunner('example.com/v?/lib'));

    expect(await matcher.isPrivate('example.com/v2/lib')).toBe(true);
    expect(await matcher.isPrivate('example.com/v22/lib')).toBe(false);
  });

  it('fails closed when go env exits non-zero', async () => {
    const matcher = createPrivateMatcher(new FakeRunner('', 1));

    await expect(matcher.isPrivate('rsc.io/quote')).rejects.toThrow(/GOPRIVATE/);
  });
});
