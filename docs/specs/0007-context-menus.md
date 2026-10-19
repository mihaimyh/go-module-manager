# Spec 0007 — Context menus across VS Code and the GMM webview

Status: published as [#17](https://github.com/mihaimyh/go-module-manager/issues/17), labelled `ready-for-agent`. This file is the repo-visible copy; the issue is the tracker record.

## Problem Statement

Developers working in a Go workspace cannot open GMM from the File Explorer context menu on a `go.mod` or `go.work` file, nor can they right-click a `require` line inside an open `go.mod` editor to jump directly to that dependency in the panel. Inside the GMM webview itself, right-clicking anywhere triggers the default Chromium context menu rather than domain actions, and the existing `⋯` action button only appears on two tables with a minimal subset of copy and external-link items. Common workflows — updating a dependency to its update candidate or advisory fixed version, removing a requirement, consolidating divergent versions across owning modules, targeting a single project in the checklist, copying advisory details, or inspecting failure logs — require moving back and forth between the table, toolbar, and inspector.

## Solution

Provide contextual right-click menus across both VS Code's native surfaces and every interactive surface inside the GMM webview:

1. **VS Code Native Context Menus**: Add an **Open in Go Module Manager** command to the Explorer context menu on `go.mod` and `go.work` files, and to the Editor context menu inside an open `go.mod`. Invoking it on a `go.mod` scopes the panel to that owning module; invoking it inside a `go.mod` editor when the cursor sits on a requirement line also switches to **Installed**, selects that dependency, and reveals indirect requirements if the target requirement is indirect.
2. **Unified Webview Context Menus & `⋯` Buttons**: Replace the browser's default right-click menu on non-text elements with a single floating, theme-aware context menu that opens on right-click, on keyboard (`ContextMenu` / `Shift+F10`), and from a visible `⋯` button on every supported surface:
   - Dependency rows (`Installed`, `Updates`, and `Vulnerabilities` tabs)
   - Search result rows (`Browse` tab)
   - Divergent module group headers and per-project rows (`Consolidate` tab)
   - Target project rows in the inspector checklist
   - Advisory cards in the inspector
   - Project failure banners above the workspace

## User Stories

1. As a Go developer, I want to right-click a `go.mod` file in the VS Code Explorer and choose **Open in Go Module Manager**, so that the panel opens immediately filtered to that owning module.
2. As a Go developer, I want to right-click a `go.work` file in the VS Code Explorer and choose **Open in Go Module Manager**, so that the panel opens showing all owning modules in the workspace.
3. As a Go developer, I want to right-click inside an open `go.mod` editor and choose **Open in Go Module Manager**, so that the panel opens scoped to that owning module.
4. As a Go developer, I want right-clicking on a specific `require` line inside an open `go.mod` editor and choosing **Open in Go Module Manager** to select that exact dependency in the **Installed** tab, so that I can inspect or move its version without searching for it again.
5. As a Go developer, I want right-clicking an `// indirect` requirement line in `go.mod` and choosing **Open in Go Module Manager** to automatically disable the **Direct only** filter if needed, so that the selected indirect requirement is visible in the list.
6. As a Go developer, I want right-clicking any dependency row in **Installed**, **Updates**, or **Vulnerabilities** to select that row and open a context menu at the cursor, so that I can act on a dependency in place.
7. As a Go developer, I want clicking the `⋯` button on any surface or pressing the `ContextMenu` / `Shift+F10` key on a focused item to open the exact same menu as right-clicking, so that every action is discoverable by mouse and accessible by keyboard.
8. As a Go developer, I want only one context menu open at a time in the webview, and I want it to close on `Escape`, outside click, scroll, or action selection, so that menus never overlap or linger.
9. As a Go developer, I want the floating context menu to clamp to the webview viewport edges, so that right-clicking near the bottom or right edge never clips menu items off screen.
10. As a Go developer, I want native right-click copy/paste preserved inside search inputs, code snippets, and `go mod why` / release-note blocks while suppressing the default browser context menu elsewhere, so that text selection still works normally.
11. As a Go developer, I want to right-click a checked dependency row when multiple rows are checked and see **Update selected (N)** and **Clear selection** at the top of the menu alongside the single-row actions, so that I can trigger a bulk update without scrolling to the tab bar.
12. As a Go developer, I want to update a dependency to its update candidate directly from its row context menu (`Update to <candidate>`), so that single-row updates take one click from the table.
13. As a Go developer, I want a dependency affected by an advisory whose fixed version differs from its latest update candidate to offer `Update to <fixedVersion> (fix advisory)` in its row context menu, so that I can apply the minimal security fix directly from the row.
14. As a Go developer, I want replaced dependencies to omit or disable version mutation actions in the row context menu, so that GMM respects replacement directives.
15. As a Go developer, I want to remove a dependency (`Uninstall`) from a dependency row or Browse row context menu and receive a native VS Code modal confirmation dialog if source packages still import the module or if other requirements would be dropped or downgraded, so that I can safely remove a requirement without moving my mouse to the inspector.
16. As a Go developer, I want to jump to the `require` line in `go.mod` from a dependency row, Browse row (when installed), or Consolidate row context menu (`Open go.mod at require`), so that I can inspect the manifest directly.
17. As a Go developer, I want to copy the module path, the `require` line (`<module> <declaredVersion>`), or the `go get` command (`go get <module>@<version>`) from a dependency row context menu, so that I can paste them into scripts, commits, or documentation.
18. As a Go developer, I want to open `pkg.go.dev` or the upstream source repository from a dependency row, Browse row, or Consolidate group header context menu when the module is public, so that I can read documentation or source code quickly.
19. As a Go developer, I want to right-click or click `⋯` on a search result row in **Browse** to install the latest version (`Install <version>`) or update installed projects (`Update to <version>`) across the default target projects, so that I can add or update a module directly from search results.
20. As a Go developer, I want to copy the module path, `import "<path>"` statement, or `go get <module>@<version>` command from a **Browse** row context menu, so that I can paste the import directly into my `.go` file.
21. As a Go developer, I want to right-click or click `⋯` on a module group header in **Consolidate** and choose `Consolidate all to <highestResolved>` (or `Consolidate all to <latestCandidate>` when a newer update candidate exists), so that I can align every diverging owning module in one action.
22. As a Go developer, I want to right-click or click `⋯` on an individual project row in **Consolidate** and choose `Consolidate other projects to <thisRowVersion>`, so that I can pick any project's resolved version as the standard for the workspace.
23. As a Go developer, I want to right-click or click `⋯` on a lagging project row in **Consolidate** and choose `Update <project> to <highestResolved>`, so that I can bring a single project in line with the rest of the workspace.
24. As a Go developer, I want to right-click or click `⋯` on a project row in the inspector's **Target projects** checklist to choose `Target only <project>`, `Target all projects`, `Open go.mod`, `Run go mod tidy in <project>`, or `Copy go.mod path`, so that I can manage individual projects in a multi-module workspace quickly.
25. As a Go developer, I want to right-click or click `⋯` on an advisory card in the inspector to choose `Update to <fixedVersion>`, `Open advisory on pkg.go.dev`, `Copy advisory ID`, or `Copy advisory details`, so that I can act on or share security findings effortlessly.
26. As a Go developer, I want to right-click or click `⋯` on a project failure banner to run its recovery action, open `go.mod`, open the **Go Module Manager** output log (`Show output log`), or copy the failure message, so that I can diagnose and recover from toolchain failures quickly.
27. As a Go developer, I want all mutation items in any context menu to be disabled while the workspace is busy or resolving updates, so that concurrent writes cannot collide.

## Implementation Decisions

### VS Code Native Menu Contributions and Focus Routing

- Register the open-panel command in `explorer/context` when `(resourceFilename == go.mod || resourceFilename == go.work) && resourceScheme == file` and in `editor/context` when `resourceFilename == go.mod && resourceScheme == file`.
- When the command is invoked with a resource URI (from Explorer) or with an active `go.mod` text editor (from Editor context or title button):
  - If the URI points to a `go.mod` belonging to a known workspace project, post a focus message from the extension host to the webview carrying the target `manifestPath` and an optional `moduleName`.
  - If invoked from `editor/context` inside `go.mod`, inspect the active cursor line using the `go.mod` requirement-line parser. If the cursor line declares a requirement on a module path, include that `moduleName` in the focus message.
  - If the URI points to `go.work`, post a focus message that resets the owning-module filter to all modules.
- When the webview receives a focus message (or when the model finishes loading with a pending focus target):
  - Set the owning-module filter to the target project's name (or `'all'` for `go.work`).
  - If a `moduleName` is present and matches a dependency row in that project, switch to the **Installed** tab, select that row, and if the row is an indirect requirement, set **Direct only** to `false` so the row is visible.

### Pure Context Menu Builder

- Introduce a pure core module that constructs menu sections and items for each of the six webview surfaces from domain state, returning a serializable descriptor structure:

```ts
type ContextMenuAction =
  | { readonly type: 'update'; readonly manifestPath: string; readonly name: string; readonly version: string }
  | { readonly type: 'apply-targets'; readonly targets: readonly TargetChange[] }
  | { readonly type: 'bulk-update'; readonly selection: readonly DependencySelection[] }
  | { readonly type: 'clear-selection' }
  | { readonly type: 'uninstall'; readonly targets: readonly { readonly manifestPath: string; readonly name: string }[] }
  | { readonly type: 'open-manifest'; readonly manifestPath: string; readonly name?: string }
  | { readonly type: 'tidy'; readonly manifests: readonly string[] }
  | { readonly type: 'recover'; readonly manifestPath: string; readonly action: RecoveryAction }
  | { readonly type: 'show-output' }
  | { readonly type: 'target-only-project'; readonly manifestPath: string }
  | { readonly type: 'target-all-projects' }
  | { readonly type: 'copy'; readonly text: string }
  | { readonly type: 'open-external'; readonly url: string };

interface ContextMenuItem {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly action: ContextMenuAction;
}

interface ContextMenuSection {
  readonly id: string;
  readonly items: readonly ContextMenuItem[];
}
```

- Menu items are grouped into logical sections separated by visual dividers:
  1. **Multi-select actions** (on a checked dependency row when more than one row is checked): `Update selected (N)` and `Clear selection`.
  2. **Mutations**: single-row or group updates (`Update to <candidate>`, `Update to <fixedIn> (fix advisory)`, `Install <version>`, `Consolidate all to <highestResolved>`, `Consolidate all to <latestCandidate>`, `Consolidate other projects to <version>`, `Update <project> to <highestResolved>`), project recovery actions, `Run go mod tidy in <project>`, and `Uninstall`.
  3. **Selection & navigation**: `Target only <project>`, `Target all projects`, `Open go.mod at require` / `Open go.mod`, and `Show output log`.
  4. **Copy actions**: `Copy module path`, `Copy require line`, `Copy import statement`, `Copy go get command`, `Copy go.mod path`, `Copy advisory ID`, `Copy advisory details`, and `Copy error message`.
  5. **External links**: `Open on pkg.go.dev`, `Open repository`, and `Open advisory on pkg.go.dev`.
- Include a pure viewport-clamping helper `clampMenuPosition(anchor, menuSize, viewportSize)` so the floating menu stays within the viewport with a small margin.

### Modal Uninstall from Context Menus and Host Messages

- Extend the webview-to-host message contract with:
  - `show-output`: reveals the extension's output channel.
  - `uninstall`: accepts one or more `{ manifestPath, name }` targets from a context menu. For each target, the host runs `why` and `@none` preview (when supported by the adapter) and evaluates `removeSafety`. If `needsConfirm` is true (source code imports the module or collateral requirements change/drop), the host shows a native modal warning dialog detailing the impact before executing `go get <name>@none`; if safe, it removes the requirement immediately.
  - `open-manifest` with an optional `name`: when `name` is omitted or empty, or when the module is not yet present in `go.mod`, the host opens `go.mod` at the top of the file.
- Extend the host-to-webview message contract with:
  - `focus`: `{ type: 'focus', manifestPath?: string, moduleName?: string }` to scope the owning module and select a dependency row when launched from Explorer or Editor context menus.

### Webview Floating Menu and `⋯` Trigger

- Replace `<details className="row-menu">` with a shared `<MoreButton>` trigger and a single portal/root-level `<ContextMenu>` component in the webview.
- Add a visible `⋯` button to:
  - Dependency table rows
  - Browse table rows
  - Consolidate group headers and Consolidate project rows
  - Inspector target-project checklist rows
  - Inspector advisory cards
  - Project failure banners
- Suppress the browser's default `contextmenu` event at the app root except when the event target is inside an `<input>`, `<textarea>`, `<code>`, or `<pre>` element.
- Support keyboard navigation inside the open menu (`ArrowDown`, `ArrowUp`, `Home`, `End`, `Enter`, `Escape`) and opening a focused surface's menu via the `ContextMenu` key or `Shift+F10`.

## Testing Decisions

A good test verifies observable behavior at the module boundary — the menu sections, labels, disabled states, and action payloads produced for a given domain state, the module path parsed from a cursor line in `go.mod`, and the host handler calls produced by webview messages — without coupling to internal React component state or DOM markup.

Three seams will be tested:

1. **Pure context menu builder and viewport clamping** (new core module):
   - Given dependency rows (direct, indirect, replaced, with update candidate, with advisory fixed version, checked in a multi-selection, or while `busy` is true), asserts the exact sections, labels, disabled flags, and action payloads.
   - Given Browse rows (uninstalled, installed at older version, installed at latest version, private module), asserts install/update/uninstall targets, copy commands, and external links.
   - Given Consolidate groups and rows, asserts `Consolidate all to <highestResolved>`, `Consolidate all to <latestCandidate>`, `Consolidate other projects to <version>`, and `Update <project> to <highestResolved>`.
   - Given project checklist rows, advisory cards, and project failure banners, asserts their respective sections and actions.
   - Given anchor coordinates near viewport boundaries, asserts `clampMenuPosition` keeps the menu within the viewport.
2. **`go.mod` requirement-line resolution** (existing Go manifest line helper):
   - Given `go.mod` text and a 1-based cursor line number (single-line `require`, block `require ( ... )`, lines with `// indirect` comments, blank lines, `module` / `go` / `replace` lines), asserts that the helper returns the required module path on `require` lines and `undefined` elsewhere.
3. **Webview message validation and routing** (existing message router):
   - Asserts validation and forwarding for `show-output`, `uninstall` (filtering to known workspace manifests and rows), and `open-manifest` both with a required module name and for manifest-only opens.

Prior art: existing unit tests in `src/core/browse.test.ts`, `src/core/consolidate.test.ts`, `src/ecosystems/go/requireLine.test.ts`, and `src/extension/webviewMessages.test.ts`.

## Out of Scope

- Context menus inside `.go` source files (for example on `import` statements).
- Context menus on workspace folders in the VS Code Explorer.
- Editing or removing `replace` directives from a context menu (per ADR 0001 and `GLOSSARY.md`, GMM never edits `replace` directives).
- Running `go work sync` or modifying `go.work` files.

## Further Notes

- ADR 0001 (writes limited to `go.mod` and `go.sum`), ADR 0003 (per-module writes with `GOWORK=off`), ADR 0006 (one panel over every module), and ADR 0008 (undo restores bytes) govern all write actions triggered from context menus.
- Every write initiated from a context menu (`Update`, `Install`, `Consolidate`, `Uninstall`, `go mod tidy`) flows through the same busy gate and undo snapshot pipeline as toolbar and inspector buttons.
