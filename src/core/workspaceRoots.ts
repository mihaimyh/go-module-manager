/** Folder paths the panel should load. A development override replaces them. */
export function workspaceRoots(
  folders: readonly { readonly uri: { readonly fsPath: string } }[] | undefined,
  developmentRoot: string | undefined,
): readonly string[] {
  if (developmentRoot !== undefined && developmentRoot !== '') {
    return [developmentRoot];
  }
  return (folders ?? []).map((folder) => folder.uri.fsPath);
}
