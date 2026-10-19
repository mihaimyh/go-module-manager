import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Advisory, PanelModel } from '../src/core/model';
import { createGoAdapter } from '../src/ecosystems/go/adapter';
import type { GoRunner } from '../src/ecosystems/go/runner';

const root = join(process.cwd(), 'test', 'fixtures', 'workspace');

/** Replays the recorded `go mod edit -json` output for the webview harness. */
const recordedRunner: GoRunner = {
  async run(args, options) {
    if (args.join(' ') !== 'mod edit -json') {
      return { stdout: '', stderr: `unexpected command: ${args.join(' ')}`, exitCode: 1 };
    }
    return {
      stdout: readFileSync(join(options.cwd, '__golden__', 'mod-edit.json'), 'utf8'),
      stderr: '',
      exitCode: 0,
    };
  },
};

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

void createGoAdapter(recordedRunner)
  .read(root)
  .then((model) =>
    process.stdout.write(
      JSON.stringify(
        withRecordedAdvisories(model, join(root, 'a', '__golden__', 'advisories.json')),
      ),
    ),
  );
