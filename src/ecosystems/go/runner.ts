import { execFile } from 'node:child_process';

export interface RunOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * The only place the extension executes something. Everything above this
 * interface is testable with a fake runner and no toolchain.
 */
export interface GoRunner {
  run(args: readonly string[], options: RunOptions): Promise<RunResult>;
}

export class GoNotFoundError extends Error {
  constructor() {
    super('The go executable was not found on PATH.');
    this.name = 'GoNotFoundError';
  }
}

/**
 * Every go invocation gets the user's environment plus workspace mode off, so a
 * workspace file never changes which graph a read or a write touches.
 */
export function goEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, GOWORK: 'off' };
}

/** The first non-empty line of toolchain output, for error messages. */
export function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim() !== '');
  return line?.trim() ?? 'the go command failed without output';
}

export const execGoRunner: GoRunner = {
  run(args, options) {
    return new Promise<RunResult>((resolve, reject) => {
      execFile(
        'go',
        [...args],
        {
          cwd: options.cwd,
          env: options.env,
          timeout: options.timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
          ...(options.signal ? { signal: options.signal } : {}),
        },
        (error, stdout, stderr) => {
          if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(new GoNotFoundError());
            return;
          }
          const code = (error as { code?: unknown } | null)?.code;
          resolve({
            stdout,
            stderr,
            exitCode: error ? (typeof code === 'number' ? code : 1) : 0,
          });
        },
      );
    });
  },
};
