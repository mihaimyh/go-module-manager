import { dirname } from 'node:path';
import type { ScanFinding } from '../../core/scan';
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
): Promise<readonly ScanFinding[]> {
  const result = await runner.run(['run', GOVULNCHECK_TARGET, '-json', './...'], {
    cwd: dirname(manifestPath),
    env: goEnv(),
    timeoutMs: SCAN_TIMEOUT_MS,
  });

  if (result.exitCode !== 0) {
    throw new GoCommandError(
      failureKindFor(result.exitCode, result.stderr),
      `govulncheck failed: ${firstLine(result.stderr)}`,
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
 * govulncheck writes one JSON object per line. Only findings with a non-empty
 * trace are reachable; an advisory without a trace is reported by the module
 * but not called by this project.
 */
export function parseScanOutput(stdout: string): readonly ScanFinding[] {
  const findings: ScanFinding[] = [];
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
    if (seen.has(finding.osv)) {
      continue;
    }
    seen.add(finding.osv);

    const frame = finding.trace[0] as
      | { function?: unknown; package?: unknown }
      | undefined;

    findings.push({
      id: finding.osv,
      ...(typeof frame?.function === 'string' ? { symbol: frame.function } : {}),
      ...(typeof frame?.package === 'string' ? { package: frame.package } : {}),
    });
  }

  return findings;
}
