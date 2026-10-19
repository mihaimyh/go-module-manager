import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeFailure, type Advisory, type PanelModel } from '../src/core/model';
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

/** A failure state for the harness, so the recovery banner can be reviewed. */
function withFixtureFailure(model: PanelModel): PanelModel {
  if (process.env.GMM_HARNESS_FAILURE !== '1') {
    return model;
  }
  const project = model.projects[0];
  if (project === undefined) {
    return model;
  }
  return mergeFailure(model, {
    manifestPath: project.manifestPath,
    projectName: project.name,
    kind: 'missing-go-sum',
    message: 'go: missing go.sum entry for module providing package rsc.io/quote',
  });
}

void (async () => {
  const declared = await adapter.read(root);
  const resolved = await resolveProjects(
    declared,
    (manifestPath, options) => resolve(manifestPath, options),
    () => undefined,
    { concurrency: 2 },
  );
  const model = withFixtureFailure(resolved);

  process.stdout.write(
    JSON.stringify({
      model: withRecordedAdvisories(model, join(root, 'a', '__golden__', 'advisories.json')),
      progress: { done: model.projects.length, total: model.projects.length },
    }),
  );
})();
