/**
 * 1-based line of a `require` for `modulePath`, or undefined if the module
 * is not in this go.mod text. Used to reveal the row in the editor.
 */
export function requireLineNumber(
  goMod: string,
  modulePath: string,
): number | undefined {
  const lines = goMod.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (requiredModuleAtLineFromLines(lines, index) === modulePath) {
      return index + 1;
    }
  }
  return undefined;
}

/**
 * Module path required on the given 1-based line of `goMod`, or undefined
 * when the line is not a `require` entry. Used only for editor cursor
 * navigation; the dependency graph itself comes from `go mod edit -json` (ADR 0005).
 */
export function requiredModuleAtLine(
  goMod: string,
  lineNumber: number,
): string | undefined {
  const lines = goMod.split(/\r?\n/);
  if (lineNumber < 1 || lineNumber > lines.length) {
    return undefined;
  }
  return requiredModuleAtLineFromLines(lines, lineNumber - 1);
}

function requiredModuleAtLineFromLines(
  lines: readonly string[],
  targetIndex: number,
): string | undefined {
  let inRequireBlock = false;
  for (let index = 0; index <= targetIndex; index += 1) {
    const trimmed = (lines[index] ?? '').replace(/\/\/.*$/, '').trim();
    if (inRequireBlock) {
      if (trimmed === ')') {
        inRequireBlock = false;
        continue;
      }
      if (index === targetIndex) {
        return parseModuleVersionPair(trimmed);
      }
      continue;
    }

    if (/^require\s*\($/.test(trimmed)) {
      inRequireBlock = true;
      continue;
    }

    if (index === targetIndex && trimmed.startsWith('require ')) {
      return parseModuleVersionPair(trimmed.slice('require '.length).trim());
    }
  }
  return undefined;
}

function parseModuleVersionPair(text: string): string | undefined {
  if (text === '' || text.includes('=>')) {
    return undefined;
  }
  const parts = text.split(/\s+/);
  const rawToken = parts[0];
  if (rawToken === undefined || rawToken === '' || rawToken === '(' || rawToken === ')') {
    return undefined;
  }
  const unquoted =
    (rawToken.startsWith('"') && rawToken.endsWith('"')) ||
    (rawToken.startsWith('`') && rawToken.endsWith('`'))
      ? rawToken.slice(1, -1)
      : rawToken;
  return unquoted === '' ? undefined : unquoted;
}

