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
    const trimmed = (lines[index] ?? '').replace(/\/\/.*$/, '').trim();
    if (
      trimmed === modulePath ||
      trimmed.startsWith(`${modulePath} `) ||
      trimmed.startsWith(`require ${modulePath} `)
    ) {
      return index + 1;
    }
  }
  return undefined;
}
