import { execFile } from 'node:child_process';
import { GoCommandError } from './errors';

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

export class GoNotFoundError extends GoCommandError {
  constructor(goPath: string) {
    super('toolchain-missing', `The ${goPath} executable was not found on PATH.`);
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

/** One finished go invocation, emitted for the Output channel. */
export interface GoInvocation {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
}

let invocationSink: ((invocation: GoInvocation) => void) | undefined;
let sessionSignal: AbortSignal | undefined;

/** Host-owned cancellation for in-flight go work when every surface closes. */
export function setGoSessionSignal(signal: AbortSignal | undefined): void {
  sessionSignal = signal;
}

/**
 * Diagnostics only: the host installs a sink so every go command and its
 * failure output lands in Output → Go Module Manager. A broken sink must never
 * break a command.
 */
export function setGoInvocationSink(
  sink: ((invocation: GoInvocation) => void) | undefined,
): void {
  invocationSink = sink;
}

function emit(invocation: GoInvocation): void {
  try {
    invocationSink?.(invocation);
  } catch {
    // Diagnostics cannot fail the operation they observe.
  }
}

export function createExecGoRunner(goPath = 'go'): GoRunner {
  return {
    run(args, options) {
      const startedAt = Date.now();
      return new Promise<RunResult>((resolve, reject) => {
        execFile(
          goPath,
          [...args],
          {
            cwd: options.cwd,
            env: options.env,
            timeout: options.timeoutMs,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true,
            ...((options.signal ?? sessionSignal)
              ? { signal: options.signal ?? sessionSignal }
              : {}),
          },
          (error, stdout, stderr) => {
            if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
              emit({
                args,
                cwd: options.cwd,
                exitCode: -1,
                timedOut: false,
                durationMs: Date.now() - startedAt,
                stdout,
                stderr: `executable not found: ${goPath}`,
              });
              reject(new GoNotFoundError(goPath));
              return;
            }
            const code = (error as { code?: unknown } | null)?.code;
            // maxBuffer kills the child with SIGTERM too; that is not a timeout.
            const timedOut =
              code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' &&
              error !== null &&
              (error.killed === true || error.signal === 'SIGTERM');

            emit({
              args,
              cwd: options.cwd,
              exitCode: error ? (timedOut ? 124 : typeof code === 'number' ? code : 1) : 0,
              timedOut,
              durationMs: Date.now() - startedAt,
              stdout,
              stderr,
            });

            resolve({
              stdout,
              stderr,
              exitCode: error ? (timedOut ? 124 : typeof code === 'number' ? code : 1) : 0,
            });
          },
        );
      });
    },
  };
}

export const execGoRunner: GoRunner = createExecGoRunner();
