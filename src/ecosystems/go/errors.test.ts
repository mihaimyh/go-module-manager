import { describe, expect, it } from 'vitest';
import { failureKindFor } from './errors';

describe('classifying a go failure', () => {
  it.each([
    ['go: missing go.sum entry for module providing package x', 'missing-lock-entry'],
    ['fatal: could not read Username for https://github.com', 'auth-required'],
    ['terminal prompts disabled', 'auth-required'],
    ['403 Forbidden', 'auth-required'],
    ['dial tcp: lookup proxy.golang.org: getaddrinfow: This is usually a temporary error', 'network'],
    ['Get "https://proxy.golang.org/x/@v/list": dial tcp: i/o timeout', 'network'],
    ['reading tree note: malformed note', 'verification'],
    ['verifying go.mod: sumdb.Client: checksum database', 'verification'],
    ['something else entirely', 'unknown'],
  ])('maps %s to %s', (stderr, expected) => {
    expect(failureKindFor(1, stderr)).toBe(expected);
  });

  it('treats exit code 124 as a timeout regardless of output', () => {
    expect(failureKindFor(124, '')).toBe('timeout');
    expect(failureKindFor(124, 'missing go.sum entry')).toBe('timeout');
  });
});
