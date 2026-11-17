import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planTargetChanges, tidyEligibleManifests } from '../src/core/bulk';
import { diffManifestCollateral, formatDirectiveNotice } from '../src/core/collateral';
import { createGoAdapter } from '../src/ecosystems/go/adapter';
import { createExecGoRunner } from '../src/ecosystems/go/runner';
import { isVendored } from '../src/ecosystems/go/vendor';

export async function run(repoRoot: string): Promise<number> {
  const fixture = join(repoRoot, 'test', 'fixtures', 'workspace');
  const workspace = mkdtempSync(join(tmpdir(), 'gmm-ui-path-'));
  cpSync(fixture, workspace, { recursive: true });

  const manifestA = join(workspace, 'a', 'go.mod');
  const manifestB = join(workspace, 'b', 'go.mod');
  const adapter = createGoAdapter(createExecGoRunner());

  console.log('workspace:', workspace);
  console.log('1) plan Update selected for rsc.io/quote@v1.5.2 in both projects');
  const targets = [
    { manifestPath: manifestA, name: 'rsc.io/quote', version: 'v1.5.2' },
    { manifestPath: manifestB, name: 'rsc.io/quote', version: 'v1.5.2' },
  ];
  const groups = planTargetChanges(targets);
  if (groups.length !== 2) {
    console.error('expected 2 groups, got', groups.length);
    return 1;
  }

  const declaredBefore = [
    { manifestPath: manifestA, name: 'rsc.io/quote' },
    { manifestPath: manifestA, name: 'rsc.io/sampler' },
    { manifestPath: manifestB, name: 'rsc.io/quote' },
  ];

  const beforeA = await adapter.manifestMeta!(manifestA);
  const beforeB = await adapter.manifestMeta!(manifestB);

  console.log('2) run go get per project (GOWORK=off via adapter)');
  for (const group of groups) {
    const result = await adapter.update!(group);
    console.log(`   ${group.manifestPath}: ${result.status}${result.message ? ` — ${result.message}` : ''}`);
    if (result.status !== 'updated') {
      return 1;
    }
  }

  const afterA = await adapter.manifestMeta!(manifestA);
  const afterB = await adapter.manifestMeta!(manifestB);
  const quoteA = afterA.requires.find((entry) => entry.name === 'rsc.io/quote')?.version;
  const quoteB = afterB.requires.find((entry) => entry.name === 'rsc.io/quote')?.version;
  console.log(`   a quote → ${quoteA}; b quote → ${quoteB}`);
  if (quoteA !== 'v1.5.2' || quoteB !== 'v1.5.2') {
    console.error('quote did not move to v1.5.2 in both modules');
    return 1;
  }

  const collateralA = diffManifestCollateral(beforeA, afterA, new Set(['rsc.io/quote']));
  const collateralB = diffManifestCollateral(beforeB, afterB, new Set(['rsc.io/quote']));
  const notice = formatDirectiveNotice([
    ...collateralA.directives,
    ...collateralB.directives,
  ]);
  console.log('3) collateral directives:', notice ?? '(none)');
  console.log(
    '   unselected requires A/B:',
    collateralA.unselectedRequires.length,
    collateralB.unselectedRequires.length,
  );

  const tidyTargets = tidyEligibleManifests(
    [manifestA, manifestB],
    targets,
    declaredBefore,
  );
  console.log('4) tidy-eligible manifests:', tidyTargets.length);
  if (tidyTargets.length !== 2) {
    console.error('expected both projects tidy-eligible (updates, not new installs)');
    return 1;
  }

  console.log('5) tidy a + Undo tidy (one-level snapshot)');
  const preTidy = readFileSync(manifestA, 'utf8');
  await adapter.tidy!(manifestA);
  const midTidy = readFileSync(manifestA, 'utf8');
  const undone = await adapter.undo!(manifestA);
  const postUndo = readFileSync(manifestA, 'utf8');
  console.log(`   undo=${undone}; restored pre-tidy bytes=${postUndo === preTidy}`);
  if (!undone || postUndo !== preTidy) {
    console.error('tidy undo failed to restore go.mod');
    console.error('preTidy===midTidy?', preTidy === midTidy);
    return 1;
  }

  console.log('6) vendor gate');
  if (isVendored(manifestA)) {
    console.error('fixture should not start vendored');
    return 1;
  }
  try {
    await adapter.vendor!(manifestA);
    console.error('vendor should refuse without modules.txt');
    return 1;
  } catch (error) {
    console.log('   refuse without modules.txt:', (error as Error).message);
  }

  mkdirSync(join(workspace, 'a', 'vendor'));
  writeFileSync(join(workspace, 'a', 'vendor', 'modules.txt'), '# example.com/a\n');
  await adapter.vendor!(manifestA);
  console.log(
    '   sync vendor ok; modules.txt bytes=',
    readFileSync(join(workspace, 'a', 'vendor', 'modules.txt'), 'utf8').length,
  );
  if (!existsSync(join(workspace, 'a', 'vendor', 'modules.txt'))) {
    return 1;
  }

  console.log('OK — host path for Update selected + follow-ups verified');
  rmSync(workspace, { recursive: true, force: true });
  return 0;
}
