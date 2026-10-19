import { describe, expect, it } from 'vitest';
import { failureKindFor } from './errors';

describe('classifying a go failure', () => {
  it.each([
    ['go: missing go.sum entry for module providing package x', 'missing-go-sum'],
    ['fatal: could not read Username for https://github.com', 'private-module'],
    ['terminal prompts disabled', 'private-module'],
    ['403 Forbidden', 'private-module'],
    ['something else entirely', 'unknown'],
  ])('maps %s to %s', (stderr, expected) => {
    expect(failureKindFor(1, stderr)).toBe(expected);
  });

  it('treats exit code 124 as a timeout regardless of output', () => {
    expect(failureKindFor(124, '')).toBe('timeout');
    expect(failureKindFor(124, 'missing go.sum entry')).toBe('timeout');
  });
});
