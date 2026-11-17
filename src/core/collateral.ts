/** A project's language / toolchain directives from its manifest. */
export interface ManifestDirectives {
  readonly go?: string;
  readonly toolchain?: string;
}

/** One require line used to spot collateral MVS moves. */
export interface ManifestRequire {
  readonly name: string;
  readonly version: string;
}

export interface DirectiveChange {
  readonly field: 'go' | 'toolchain';
  readonly from?: string;
  readonly to?: string;
}

export interface RequireChange {
  readonly name: string;
  readonly kind: 'added' | 'removed' | 'raised' | 'lowered';
  readonly from?: string;
  readonly to?: string;
}

export interface ManifestCollateral {
  readonly directives: readonly DirectiveChange[];
  readonly unselectedRequires: readonly RequireChange[];
}

/**
 * Compares pre/post manifest snapshots. Directive bumps are always reported;
 * require changes skip names the user explicitly asked to move.
 */
export function diffManifestCollateral(
  before: {
    readonly directives: ManifestDirectives;
    readonly requires: readonly ManifestRequire[];
  },
  after: {
    readonly directives: ManifestDirectives;
    readonly requires: readonly ManifestRequire[];
  },
  selectedNames: ReadonlySet<string>,
): ManifestCollateral {
  const directives: DirectiveChange[] = [];
  if (before.directives.go !== after.directives.go) {
    directives.push({
      field: 'go',
      ...(before.directives.go === undefined ? {} : { from: before.directives.go }),
      ...(after.directives.go === undefined ? {} : { to: after.directives.go }),
    });
  }
  if (before.directives.toolchain !== after.directives.toolchain) {
    directives.push({
      field: 'toolchain',
      ...(before.directives.toolchain === undefined
        ? {}
        : { from: before.directives.toolchain }),
      ...(after.directives.toolchain === undefined ? {} : { to: after.directives.toolchain }),
    });
  }

  const beforeByName = new Map(before.requires.map((entry) => [entry.name, entry.version]));
  const afterByName = new Map(after.requires.map((entry) => [entry.name, entry.version]));
  const unselectedRequires: RequireChange[] = [];

  for (const [name, version] of afterByName) {
    if (selectedNames.has(name)) {
      continue;
    }
    const previous = beforeByName.get(name);
    if (previous === undefined) {
      unselectedRequires.push({ name, kind: 'added', to: version });
      continue;
    }
    if (previous === version) {
      continue;
    }
    unselectedRequires.push({
      name,
      kind: compareVersionStrings(previous, version) < 0 ? 'raised' : 'lowered',
      from: previous,
      to: version,
    });
  }

  for (const [name, version] of beforeByName) {
    if (selectedNames.has(name) || afterByName.has(name)) {
      continue;
    }
    unselectedRequires.push({ name, kind: 'removed', from: version });
  }

  unselectedRequires.sort((left, right) => left.name.localeCompare(right.name));
  return { directives, unselectedRequires };
}

/** Formats go/toolchain bumps for a completion toast body. */
export function formatDirectiveNotice(
  changes: readonly DirectiveChange[],
): string | undefined {
  if (changes.length === 0) {
    return undefined;
  }
  return changes
    .map((change) => {
      const label = change.field === 'go' ? 'go' : 'toolchain';
      if (change.from === undefined && change.to !== undefined) {
        return `${label} set to ${change.to}`;
      }
      if (change.from !== undefined && change.to === undefined) {
        return `${label} ${change.from} removed`;
      }
      return `${label} ${change.from} → ${change.to}`;
    })
    .join('; ');
}

/**
 * Lexicographic SemVer-ish compare good enough for logging collateral bumps.
 * Unknown shapes fall back to string compare.
 */
function compareVersionStrings(left: string, right: string): number {
  const leftParts = left.replace(/^v/, '').split(/[.+-]/);
  const rightParts = right.replace(/^v/, '').split(/[.+-]/);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const a = leftParts[index] ?? '';
    const b = rightParts[index] ?? '';
    const aNum = Number(a);
    const bNum = Number(b);
    if (Number.isFinite(aNum) && Number.isFinite(bNum) && a !== '' && b !== '') {
      if (aNum !== bNum) {
        return aNum < bNum ? -1 : 1;
      }
      continue;
    }
    if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return 0;
}
