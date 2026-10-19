import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Advisory, PanelModel } from '../src/core/model';
import { resolveProjects } from '../src/core/updates';
import { createGoAdapter } from '../src/ecosystems/go/adapter';
import type { GoRunner } from '../src/ecosystems/go/runner';

const root = join(process.cwd(), 'test', 'fixtures', 'workspace');

const GOLDEN: Record<string, string> = {
  'mod edit -json': 'mod-edit.json',
  'list -m -u -json all': 'mod-list.json',
};

/** Replays the recorded toolchain output for the webview harness. */
const recordedRunner: GoRunner = {
  async run(args, options) {
    const file = GOLDEN[args.join(' ')];
    if (file === undefined) {
      return { stdout: '', stderr: `unexpected command: ${args.join(' ')}`, exitCode: 1 };
    }
    return {
      stdout: readFileSync(join(options.cwd, '__golden__', file), 'utf8'),
      stderr: '',
      exitCode: 0,
    };
  },
};

/** Advisories are still fixture-only until the advisory pipeline lands. */
function withRecordedAdvisories(model: PanelModel, file: string): PanelModel {
  const recorded = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Advisory[]>;
  return {
    ...model,
    rows: model.rows.map((row) => ({
      ...row,
      advisories: recorded[row.name] ?? [],
    })),
  };
}

const adapter = createGoAdapter(recordedRunner);
const resolve = adapter.resolve;

if (resolve === undefined) {
  throw new Error('the Go adapter must expose resolve');
}

void (async () => {
  const declared = await adapter.read(root);
  const model = await resolveProjects(
    declared,
    (manifestPath, options) => resolve(manifestPath, options),
    () => undefined,
    { concurrency: 2 },
  );

  process.stdout.write(
    JSON.stringify({
      model: withRecordedAdvisories(model, join(root, 'a', '__golden__', 'advisories.json')),
      progress: { done: model.projects.length, total: model.projects.length },
    }),
  );
})();
