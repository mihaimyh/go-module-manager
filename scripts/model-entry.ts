import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { advisoryTargets, mergeFailure, withAdvisories, type PanelModel } from '../src/core/model';
import { resolveProjects } from '../src/core/updates';
import {
  matchAdvisories,
  type AdvisoryDocument,
  type AdvisorySource,
} from '../src/ecosystems/go/advisory';
import { createGoAdapter } from '../src/ecosystems/go/adapter';
import type { GoRunner } from '../src/ecosystems/go/runner';

const root = join(process.cwd(), 'test', 'fixtures', 'workspace');
const advisoryFile = join(process.cwd(), 'test', 'fixtures', 'advisories', 'go.json');

const GOLDEN: Record<string, string> = {
  'mod edit -json': 'mod-edit.json',
  'list -m -u -e -json all': 'mod-list.json',
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

const documents = JSON.parse(readFileSync(advisoryFile, 'utf8')) as AdvisoryDocument[];
const recordedAdvisories: AdvisorySource = {
  async lookup(dependencies) {
    return {
      matches: matchAdvisories(documents, dependencies),
      unchecked: new Set(),
      stale: false,
    };
  },
};

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
    kind: 'missing-lock-entry',
    message: 'go: missing go.sum entry for module providing package rsc.io/quote',
  });
}

const adapter = createGoAdapter(recordedRunner, { advisories: recordedAdvisories });
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
  const matches = (await adapter.advisories?.(advisoryTargets(model))) ?? {
    matches: new Map(),
    unchecked: new Set<string>(),
    stale: false,
  };
  const withMatchedAdvisories = withAdvisories(model, matches);
  const withFailure = withFixtureFailure(withMatchedAdvisories);

  process.stdout.write(
    JSON.stringify({
      model: withFailure,
      progress: { done: model.projects.length, total: model.projects.length },
    }),
  );
})();
