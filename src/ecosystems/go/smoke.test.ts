import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createGoAdapter } from './adapter';
import { execGoRunner } from './runner';

const fixtureRoot = fileURLToPath(new URL('../../../test/fixtures/workspace', import.meta.url));

// Opt-in: needs a real `go` on PATH. Excluded from CI, run with GMM_SMOKE=1.
describe.skipIf(process.env.GMM_SMOKE !== '1')('live read (smoke)', () => {
  it('reads the fixture workspace with the real toolchain', async () => {
    const model = await createGoAdapter(execGoRunner).read(fixtureRoot);

    expect(model.projects.map((project) => project.name).sort()).toEqual([
      'example.com/a',
      'example.com/b',
    ]);
    expect(
      model.rows.some(
        (row) => row.name === 'rsc.io/quote' && row.declaredVersion === 'v1.5.1',
      ),
    ).toBe(true);
  });
});
