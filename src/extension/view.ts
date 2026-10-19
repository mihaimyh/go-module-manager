import * as vscode from 'vscode';

export const GMM_VIEW_ID = 'gmm.dependencies';

/**
 * Activity Bar entry. VS Code only lets an activity-bar icon open a side-bar
 * view, so this empty tree + welcome text is the required shell. When it
 * becomes visible we open the real UI in the editor.
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
