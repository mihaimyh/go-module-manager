# Changelog

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
