import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createGoAdapter } from './adapter';
import { execGoRunner } from './runner';
import { isVendored } from './vendor';

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

describe.skipIf(process.env.GMM_SMOKE !== '1')('live update / tidy / vendor (smoke)', () => {
  let workspace: string | undefined;

  afterEach(() => {
    if (workspace !== undefined) {
      rmSync(workspace, { recursive: true, force: true });
      workspace = undefined;
    }
  });

  it('updates with go get, tidies with undo snapshot, and gates vendor', async () => {
    workspace = mkdtempSync(join(tmpdir(), 'gmm-smoke-update-'));
    const manifestPath = join(workspace, 'go.mod');
    writeFileSync(
      manifestPath,
      'module example.com/smoke\n\ngo 1.22\n\nrequire rsc.io/quote v1.5.1\n',
    );

    const adapter = createGoAdapter(execGoRunner);
    const before = await adapter.manifestMeta?.(manifestPath);
    expect(before?.requires.some((entry) => entry.name === 'rsc.io/quote')).toBe(true);

    const updated = await adapter.update?.({
      manifestPath,
      changes: [{ name: 'rsc.io/quote', version: 'v1.5.2' }],
    });
    expect(updated?.status).toBe('updated');
    expect(readFileSync(manifestPath, 'utf8')).toMatch(/rsc\.io\/quote v1\.5\.2/);

    const after = await adapter.manifestMeta?.(manifestPath);
    expect(after?.requires.find((entry) => entry.name === 'rsc.io/quote')?.version).toBe(
      'v1.5.2',
    );

    await adapter.tidy?.(manifestPath);
    expect(await adapter.undo?.(manifestPath)).toBe(true);
    // Undo tidy restores the post-update / pre-tidy bytes.
    expect(readFileSync(manifestPath, 'utf8')).toMatch(/rsc\.io\/quote v1\.5\.2/);

    expect(isVendored(manifestPath)).toBe(false);
    await expect(adapter.vendor?.(manifestPath)).rejects.toThrow(/refusing to create/);

    mkdirSync(join(workspace, 'vendor'));
    writeFileSync(join(workspace, 'vendor', 'modules.txt'), '# example.com/smoke\n');
    expect(isVendored(manifestPath)).toBe(true);
    await adapter.vendor?.(manifestPath);
    expect(readFileSync(join(workspace, 'vendor', 'modules.txt'), 'utf8').length).toBeGreaterThan(
      0,
    );
  }, 180_000);
});
