import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Advisory } from '../../core/model';
import { mergeResolution } from '../../core/model';
import type { AdvisorySource } from './advisory';
import { createGoAdapter } from './adapter';
import type { GoRunner, RunOptions, RunResult } from './runner';

class FakeRunner implements GoRunner {
  constructor(private readonly respond: (args: readonly string[]) => RunResult) {}

  async run(args: readonly string[], _options: RunOptions): Promise<RunResult> {
    return this.respond(args);
  }
}

let workspace: string | undefined;

afterEach(() => {
  if (workspace !== undefined) {
    rmSync(workspace, { recursive: true, force: true });
    workspace = undefined;
  }
});

describe('advisory wiring', () => {
  it('attaches advisories from the injected source to resolved rows', async () => {
    workspace = mkdtempSync(join(tmpdir(), 'gmm-advisory-'));
    const project = join(workspace, 'a');
    mkdirSync(project);
    writeFileSync(join(project, 'go.mod'), 'module example.com/a\n');

    const runner = new FakeRunner((args) => {
      if (args.join(' ') === 'mod edit -json') {
        return {
          stdout: JSON.stringify({
            Module: { Path: 'example.com/a' },
            Require: [{ Path: 'rsc.io/quote', Version: 'v1.5.1' }],
          }),
          stderr: '',
          exitCode: 0,
        };
      }
      if (args.join(' ') === 'list -m -u -json all') {
        return {
          stdout: JSON.stringify({ Path: 'rsc.io/quote', Version: 'v1.5.1' }),
          stderr: '',
          exitCode: 0,
        };
      }
      return { stdout: '', stderr: `unexpected: ${args.join(' ')}`, exitCode: 1 };
    });

    const advisory: Advisory = { id: 'GO-0000-00001', summary: 'x', fixedIn: 'v1.5.2' };
    const queried: { name: string; version: string }[][] = [];
    const source: AdvisorySource = {
      async lookup(dependencies) {
        queried.push([...dependencies]);
        return new Map([['rsc.io/quote', [advisory]]]);
      },
    };

    const adapter = createGoAdapter(runner, { advisories: source });
    const declared = await adapter.read(workspace);
    const manifestPath = declared.projects[0]?.manifestPath;
    const resolve = adapter.resolve;
    const attach = adapter.advisories;
    if (manifestPath === undefined || resolve === undefined || attach === undefined) {
      throw new Error('the Go adapter must expose resolve and advisories');
    }

    const resolved = await resolve(manifestPath);
    const model = await attach(mergeResolution(declared, resolved));

    expect(queried).toEqual([[{ name: 'rsc.io/quote', version: 'v1.5.1' }]]);
    expect(model.rows[0]?.advisories).toEqual([advisory]);
  });
});
