import * as vscode from 'vscode';

export const GMM_VIEW_ID = 'gmm.dependencies';

/**
 * Activity Bar entry. VS Code requires a side-bar view for the icon; this empty
 * tree is only a trigger. On show we open the editor panel and leave the GMM
 * side bar so the welcome shell does not stay on screen.
 */
export function registerActivityBarLauncher(openPanel: () => void): vscode.Disposable {
  const tree = vscode.window.createTreeView(GMM_VIEW_ID, {
    treeDataProvider: {
      getChildren: () => [],
      getTreeItem: () => new vscode.TreeItem(''),
    },
  });

  const launch = (): void => {
    // Let VS Code finish switching the activity-bar container before creating
    // an editor webview; doing it inline with the visibility change is flaky.
    setTimeout(() => {
      openPanel();
      // Drop the empty GMM side bar and show Explorer again (or close the side
      // bar if Explorer is unavailable).
      void vscode.commands.executeCommand('workbench.view.explorer').then(
        undefined,
        () => vscode.commands.executeCommand('workbench.action.closeSidebar'),
      );
    }, 0);
  };

  if (tree.visible) {
    launch();
  }

  return vscode.Disposable.from(
    tree,
    tree.onDidChangeVisibility((event) => {
      if (event.visible) {
        launch();
      }
    }),
  );
}
