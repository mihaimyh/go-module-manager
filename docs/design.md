# GMM — shared understanding

A VS Code extension that shows the dependencies of a Go workspace and moves them to other versions safely. It deliberately looks like the NuGet Package Manager because the shapes match: one file per module, one requirement per line, one version per requirement, written per file.

## Non-goals in v1

No package browsing, no installing new modules, no running builds or tests, no writing `go.work`, no hand-written `go.mod` parser, no telemetry, no central version file (Go has no `Directory.Packages.props`).

## Decisions

| Decision | Consequence | Record |
| --- | --- | --- |
| An update is `go get` and nothing else | tidy is a separate button; v2 migration is its own confirmed action | ADR 0001 |
| Advisory badge is yellow, call-graph finding is red | UI must say "not scanned" instead of implying "clean" | ADR 0002 |
| Every read and write runs per module with `GOWORK=off` | workspace build list is never shown; divergence is visible, not fixed | ADR 0003 |
| Candidates are stable versions of the same path | no commit pinning from the UI; major upgrade is a different path | ADR 0004 |
| The `go` command is the parser | `go` on PATH is mandatory; one spawn per read, cached by file hash | ADR 0005 |
| One panel over every module | actions name their owning `go.mod`; reads are parallel per module | ADR 0006 |

## 0.1 ship bar

1. `editor/title` button on `go.mod` plus a palette command.
2. Dependency list: direct/indirect, search, module filter.
3. Update badge, single and bulk update (one `go get` per owning module), separate tidy button.
4. Advisory badge per module and a detail panel with the fixed version.
5. Error banner for missing `go`, missing `go.sum`, inaccessible private module.

## 1.0

Read-only Consolidate view, version dropdown including downgrades with an impact preview, `go mod why -m`, GitHub release notes, precise `govulncheck` scan, one-level undo, 24h advisory cache.

## v2

Browse (pkg.go.dev `/v1/search`), consolidation writes (`go work sync`), major-version migration with import rewriting, downgrade with graph rewrite.

## Known unknowns

- `GOWORK=off` write behaviour was verified on one probe workspace; re-verify on fixtures before trusting it in CI.
- Publisher id, icon and README screenshot are required before publishing.
- `govulncheck` run cost and failure modes on projects that do not currently build.
- Windows path casing when matching module directories to `go.mod` files.
