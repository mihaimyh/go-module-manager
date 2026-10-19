import { dirname } from 'node:path';
import type { CallGraphFinding } from '../../core/scan';
import { failureKindFor, GoCommandError } from './errors';
import { firstLine, goEnv, type GoRunner } from './runner';

const SCAN_TIMEOUT_MS = 300_000;

/**
 * The scanner is run through the toolchain, not from PATH: `@latest` means a
 * missing or stale installed binary cannot affect the result, and no manual
 * install is required.
 */
export const GOVULNCHECK_TARGET = 'golang.org/x/vuln/cmd/govulncheck@latest';

export async function scanProject(
  manifestPath: string,
  runner: GoRunner,
): Promise<readonly CallGraphFinding[]> {
  const result = await runner.run(['run', GOVULNCHECK_TARGET, '-json', './...'], {
    cwd: dirname(manifestPath),
    env: goEnv(),
    timeoutMs: SCAN_TIMEOUT_MS,
  });

  if (result.exitCode !== 0) {
    throw new GoCommandError(
      failureKindFor(result.exitCode, result.stderr),
      `govulncheck failed: ${diagnosticLine(result.stderr)}`,
    );
  }

  return parseScanOutput(result.stdout);
}

/** Optional: install the CLI for terminal use. Scans never depend on it. */
export async function installScanner(cwd: string, runner: GoRunner): Promise<void> {
  const result = await runner.run(['install', GOVULNCHECK_TARGET], {
    cwd,
    env: goEnv(),
    timeoutMs: SCAN_TIMEOUT_MS,
  });

  if (result.exitCode !== 0) {
    throw new GoCommandError(
      failureKindFor(result.exitCode, result.stderr),
      `go install govulncheck failed: ${firstLine(result.stderr)}`,
    );
  }
}

/**
 * govulncheck writes one JSON object per line. A module-level finding has a
 * one-frame trace without a function: it says the module is affected, not that
 * the project calls the vulnerable symbol. Only a frame with a function is a
 * call-graph finding.
 */
export function parseScanOutput(stdout: string): readonly CallGraphFinding[] {
  const findings: CallGraphFinding[] = [];
  const seen = new Set<string>();

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }

    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const finding = (value as { finding?: unknown } | null)?.finding as
      | { osv?: unknown; trace?: unknown }
      | undefined;
    if (finding === undefined || typeof finding.osv !== 'string') {
      continue;
    }
    if (!Array.isArray(finding.trace) || finding.trace.length === 0) {
      continue;
    }

    const frame = finding.trace[0] as
      | { function?: unknown; receiver?: unknown; package?: unknown }
      | undefined;
    if (typeof frame?.function !== 'string') {
      continue;
    }
    if (seen.has(finding.osv)) {
      continue;
    }
    seen.add(finding.osv);

    const symbol =
      typeof frame.receiver === 'string' && frame.receiver !== ''
        ? `${frame.receiver}.${frame.function}`
        : frame.function;

    findings.push({
      id: finding.osv,
      symbol,
      ...(typeof frame.package === 'string' ? { packagePath: frame.package } : {}),
    });
  }

  return findings;
}

/** Drops the module-download chatter so a failure shows the real cause. */
function diagnosticLine(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^go: downloading\b/.test(line));
  return lines.at(-1) ?? firstLine(stderr);
}
