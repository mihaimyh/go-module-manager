# Changelog

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
