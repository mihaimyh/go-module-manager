import {
  classifyUpdate,
  isPseudoVersion,
  type UpdateKind,
} from '../../core/version';

export { isPseudoVersion };

export interface ModulePathInfo {
  readonly base: string;
  readonly major: number;
}

/**
 * From v2 onwards the major version is part of the module path: `example.com/m/v2`.
 * gopkg.in uses a dot form (`gopkg.in/yaml.v3`) for the same idea.
 */
export function splitModulePath(modulePath: string): ModulePathInfo {
  const lowered = /^(.*)\/v(\d+)$/.exec(modulePath);
  if (lowered && Number(lowered[2]) >= 2) {
    return { base: lowered[1] ?? modulePath, major: Number(lowered[2]) };
  }
  const gopkg = /^(.*)\.v(\d+)$/.exec(modulePath);
  if (gopkg && Number(gopkg[2]) >= 2) {
    return { base: gopkg[1] ?? modulePath, major: Number(gopkg[2]) };
  }
  return { base: modulePath, major: 1 };
}

export function isSameModulePath(a: string, b: string): boolean {
  const left = splitModulePath(a);
  const right = splitModulePath(b);
  return left.base === right.base && left.major === right.major;
}

export function classifyGoUpdate(from: string, to: string): UpdateKind {
  if (from === to) {
    return 'none';
  }
  const fromCommit = isPseudoVersion(from);
  const toCommit = isPseudoVersion(to);
  if (fromCommit || toCommit) {
    return fromCommit && !toCommit ? 'release' : 'none';
  }
  return classifyUpdate(from, to);
}
