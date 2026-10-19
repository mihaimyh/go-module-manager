import type { FailureKind } from '../../core/model';

/** A failed go invocation, carrying the kind that decides the recovery action. */
export class GoCommandError extends Error {
  readonly kind: FailureKind;

  constructor(kind: FailureKind, message: string) {
    super(message);
    this.name = 'GoCommandError';
    this.kind = kind;
  }
}

const PRIVATE_PATTERNS =
  /terminal prompts disabled|could not read Username|authentication required|403 Forbidden|410 Gone|permission denied|access denied/i;

/** Exit code 124 is ours: the runner killed a command that ran out of time. */
export function failureKindFor(exitCode: number, stderr: string): FailureKind {
  if (exitCode === 124) {
    return 'timeout';
  }
  if (/missing go\.sum entry/i.test(stderr)) {
    return 'missing-lock-entry';
  }
  if (PRIVATE_PATTERNS.test(stderr)) {
    return 'auth-required';
  }
  return 'unknown';
}
