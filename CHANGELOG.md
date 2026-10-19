# Changelog

## 0.1.26

### Added

- **Browse** tab (opened by default as the first tab) searches public Go modules via `pkg.go.dev/v1/search` and resolves selectable versions from `go list -m -versions -json` (ADR 0013).
- Private module paths matching `GOPRIVATE` / `GONOPROXY` never contact `pkg.go.dev` and resolve directly via `go list -m -versions -json`.
- Inspector in **Browse** and **Consolidate** includes a Visual Studio Solution-style per-project checklist (`[x] Project | Installed`) to install, update, consolidate, or uninstall (`@none`) across checked `go.mod` files in one click with single-level undo.
- **Uninstall** (`go get <module>@none`) in **Browse** and **Installed** inspectors, with safe one-click removal when unused and an impact confirmation when imported by workspace `.go` packages or when MVS reports collateral changes.
- Top-toolbar **Include prerelease** toggle filters candidate badges, **Updates** count/list, and inspector version pickers across all tabs.
- Inspector shows module license, publish date, repository link, one-click `Copy import`, and an `// indirect` note for newly added modules.

### Changed

- Renamed the **Dependencies** tab to **Installed** (`#installed` and `#dependencies` hashes both open it).

## 0.1.25

### Added

- Inspector explains commit pins: when the selected version is a pseudo-version and there is no tagged candidate, it says there is no newer tagged release (ADR 0012 — updates still come from `go list -m -u`, not GitHub).

## 0.1.24

### Fixed

- Panel actions stay disabled while any host work is in flight: confirm dialogs, Check for updates, single and bulk update (including Undo), go mod tidy, reachability scans, govulncheck install, impact preview, and recovery repairs.
- `go mod tidy` shows a success toast when it finishes, and is disabled when no project is in scope.

## 0.1.23

### Added

- `npm run install:local` / `scripts/install-local.sh` builds a VSIX and installs it into Cursor, VS Code, and Insiders when those CLIs are on PATH.

## 0.1.22

### Changed

- Clicking the Activity Bar icon opens the editor panel and switches back to Explorer, so the empty GMM side bar does not stay visible.

## 0.1.21

### Fixed

- The Activity Bar icon opens the editor panel immediately (loading state), instead of waiting for workspace discovery — and uses a side-bar welcome view rather than a webview shell, which was unreliable at creating the editor tab.

## 0.1.20

### Added

- Discovery prefers `go.work` `use` directories (including nested modules the tree walk would miss), then falls back to the existing walk.
- Every VS Code workspace folder is loaded, not only the first.

## 0.1.19

### Changed

- The Activity Bar icon opens the Go Module Manager in the editor area instead of embedding the full UI in the side bar. The side bar keeps a short launcher if it stays open.

## 0.1.18

### Added

- Inspector runs `go mod why -m` for the selected dependency and shows the toolchain's explanation.
- GitHub release notes for the chosen version on `github.com` modules (session-cached; muted when missing).
- Downgrade impact preview: dry-run `go get`, list lowered/dropped requirements, then confirm into the normal update/undo flow.
- Consolidate tab groups divergent module paths by owning module and selected version (read-only).

## 0.1.17

### Added

- `replace` directives are shown: a **replaced** chip, the replacement's version as selected, and **Replaced by** in the inspector with links to the replacement's pkg.go.dev page and repository. A local replacement shows its path and has no external link.
- Replaced rows are excluded from single, bulk and advisory updates; GMM never rewrites a `replace`.

### Fixed

- pkg.go.dev and repository links point to the module that actually builds (the replacement) instead of the declared path.
## 0.1.16

### Fixed

- The version picker and the owning-module filter use a themed listbox instead of the native `<select>` popup, which Chromium drew in the system light theme over the dark panel.
- Long version lists scroll inside a 320px menu, and the menu opens above the trigger when there is no room below.
- Keyboard control: arrows, Home/End, Enter/Space, Escape and Tab. Clicking outside or scrolling closes it.
- Native controls follow the VS Code theme through `color-scheme` on `vscode-dark` and `vscode-light`.
## 0.1.15

### Added

- Loading states for every async step: a spinner while the workspace is read, a progress strip with a bar while updates are checked, a busy strip with disabled actions during updates, `go mod tidy`, reachability scans, checksum repair and govulncheck install, and **Loading all versions…** in the inspector.

### Fixed

- Tab counts follow **Direct only** and the owning-module filter, so **Updates** no longer reports a number the list cannot show.
- An empty view says why: "N updates hidden by Direct only" with **Show indirect too**, or **Clear filter** when a search has no hits.
- The editor panel receives version lists and selection resets again; the shared-surface refactor had sent them only to the Activity Bar view.
## 0.1.14

### Fixed

- **Repair checksum cache** now removes the damaged signed tree note in `%GOPATH%\pkg\sumdb`, the file behind `reading tree note: malformed note`. It also removes zero-filled `.mod`/`.info`/`.ziphash` files under `GOMODCACHE`, which cause `malformed record data` and `checksum mismatch`. Before, it only cleared `GOMODCACHE\cache\download\sumdb`, so the error survived the repair.
- The startup log includes `GOMODCACHE`, `GOPATH` and `GOTOOLCHAIN`.
## 0.1.13

### Added

- **Output → Go Module Manager** now logs every `go` command: arguments, working directory, exit code, duration, and the full stdout/stderr when it fails. It also records the toolchain settings that decide whether a download works: `GOPROXY`, `GOSUMDB`, `GOFLAGS`, `GOPRIVATE`, `GONOPROXY` and the Go version.
- A failed update names its first error in the notification and offers **Show log**. Updating a single dependency now reports failure too, instead of failing silently.
## 0.1.12

### Added

- A **Go Modules** entry in the Activity Bar, with a dedicated icon and the same dependency list in a compact layout. Selecting **Open panel** (or the shortcut) opens the full editor panel.
- Keyboard shortcut **Ctrl+Alt+G** (**Cmd+Alt+G** on macOS) for **GMM: Open Go Module Manager**.
- A new extension icon: an isometric Go module with an update arrow.

### Changed

- The Activity Bar view and the editor panel share one model and one set of actions, so updates, scans and recovery stay in sync.
## 0.1.11

### Added

- A checksum-database failure now offers **Repair checksum cache**: it deletes Go's cached `sumdb` data (downloaded modules are kept) and retries, without ever disabling verification.

## 0.1.10

### Fixed

- A bulk update no longer fails as a whole when one module breaks the group's `go get`. The group is retried one dependency at a time, so the healthy modules move and only the broken one reports an error.
- One Undo still restores `go.mod`/`go.sum` to the state before the whole action, including after the per-module fallback.
- The success and failure notifications count dependencies instead of project groups.

## 0.1.9

### Fixed

- The version picker excludes retracted versions. Retractions are read from the latest version's `go.mod` (single versions, closed intervals and blocks), so the picker matches what `go get` would accept.
- A partial `go list` result is used even when the command exits non-zero, so one checksum-database failure no longer hides the whole update list.

## 0.1.8

### Added

- The version picker loads every tagged version from `proxy.golang.org` (case-encoded path, cached, private paths skipped) instead of only the required/selected/candidate versions.
- The inspector links to `pkg.go.dev` and to the repository on GitHub, GitLab or Bitbucket.
- Every column sorts: module, owning module, required, selected, update, and a new **Type** column for patch/minor/major/release.
- `Direct only` is checked by default.

### Changed

- The inspector follows the current view, so it cannot show a row hidden by the tab or filters.

## 0.1.7

### Fixed

- Tab counts use the current tab's total ("21 of 43" on Updates), not the workspace total.
- Bulk selection follows what is visible: hidden checked rows are reported as "hidden by filters" and are not part of the action or its button count.
- The `indirect` and `advisory` chips stay visible when a module path is long.

## 0.1.6

### Fixed

- Scan failures report the useful diagnostic instead of the control-character padding that the checksum database leaves in `stderr`, and explain checksum-database failures (`GOPROXY`/`GOSUMDB`). The scan bar clamps long messages.

## 0.1.5

### Changed

- The bulk confirmation now says how many selected rows have no update and will be skipped, and the button tooltip shows the same count.
- The selection clears after a successful bulk update, so the next action starts from a clean state.

## 0.1.4

### Fixed

- One module failing verification no longer blanks the whole update lookup. `go list -m -u -e` keeps the modules that resolved, and a checksum-database error is classified as `verification` with Retry.

## 0.1.3

### Fixed

- Network failures while checking updates (DNS lookup, unreachable proxy) are classified as `network` and offer Retry, instead of a generic failure.
- The webview CSP allows the host's worker registration, which Cursor sometimes aborts while loading the panel.

## 0.1.2

### Added

- A GMM button in the Explorer toolbar, so the panel opens without having a `go.mod` file in focus. The editor-title button stays scoped to `go.mod`.

## 0.1.1

### Fixed

- Find `go.mod` files deeper than one level. Discovery now walks the tree (up to six levels, skipping `node_modules` and dot-folders) and stops at a module, so layouts like `src/backend/server/go.mod` work.

## 0.1.0

First usable release.

### Added

- A panel listing every project and dependency in the workspace, read live with `go mod edit -json`.
- Background update lookup with `go list -m -u`, cached by the content hash of `go.mod` + `go.sum`.
- Classified failures with one recovery action per project: missing `go.sum`, missing Go, private module, timeout.
- Single update with one level of undo, bulk update grouped per project, and a separate, confirmed `go mod tidy`.
- Module-level advisories from the official Go vulnerability database, cached for 24 hours with a stale fallback.
- An on-demand call-graph scan with `govulncheck` that marks only reachable advisories red, with symbol and package.
- Update to the fixed version from an advisory card, when the fix is a stable version on the same major path.

### Security

- Module paths matching `GOPRIVATE` / `GONOPROXY` are never sent to the advisory database.
- No telemetry, no background builds, no edits to `.go` files.
