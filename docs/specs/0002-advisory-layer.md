# Spec 0002 — Advisory layer

Status: published as [#2](https://github.com/mihaimyh/go-module-manager/issues/2), labelled `ready-for-agent`. This file is the repo-visible copy; the issue is the tracker record.

Depends on #1 (live Go reads and updates): the runner, the update engine and the resolved versions this layer matches against.

## Problem Statement

The panel shows versions but says nothing about whether a dependency is known to be vulnerable. A developer who wants that answer today has to leave the editor, remember the module path, search a vulnerability database, work out whether the advisory affects the version they resolved, and then work out which version fixes it. The Vulnerabilities tab exists but is empty, and the one thing it could show — "this module has a published advisory" — is indistinguishable from "your program can actually reach the vulnerable code" unless the UI says which is which.

## Solution

The panel attaches advisories to dependencies by module path and resolved version, from the official Go vulnerability database, and shows them as an informational amber badge with the GO ID, the affected range and the version that fixes it. A second, deliberate action runs `govulncheck` to find advisories that are reachable from the project's own code; only those are red. The panel never claims a project is clean before the precise scan has run, and it never sends a private module path to a public service.

## User Stories

1. As a Go developer, I want to see which of my dependencies have a published advisory, so that I can judge the state of the project without leaving the editor.
2. As a Go developer, I want the badge to say "advisory affects this module" rather than "you are vulnerable", so that I understand it is not a reachability claim.
3. As a Go developer, I want to see the advisory's GO ID, a one-line summary, and the version that fixes it, so that I can decide whether to act.
4. As a Go developer, I want a button that moves a dependency to the fixed version, so that acting on the advisory is the same flow as any other update.
5. As a Go developer, I want the fixed version to be offered only when it is a real upgrade on the same module path, so that I am not sent to a different major version by accident.
6. As a Go developer, I want to run a precise scan that reports only advisories reachable from my code, so that I can tell a real problem from an irrelevant one.
7. As a Go developer, I want a reachable finding to show the symbol and package in the trace, so that I can find the call site.
8. As a Go developer, I want to see whether a precise scan has not run, is running, or failed, so that I never read an empty list as "clean".
9. As a Go developer, I want the Vulnerabilities tab to count unique advisories across projects, so that the tab badge means something.
10. As a Go developer, I want the count to become red only when a reachable finding exists, so that the two severities cannot be confused.
11. As a Go developer, I want advisory data to be cached for a day and usable offline, so that opening the tab does not hit the network every time.
12. As a Go developer, I want to force a refresh of advisory data, so that I can get today's advisories when I need them.
13. As a Go developer, I want the panel to tell me how old the cached data is, so that I can judge staleness.
14. As a Go developer, I want a failed database fetch to leave my dependency rows untouched, so that a network problem does not blank the panel.
15. As a developer with private modules, I want module paths matching `GOPRIVATE`/`GONOPROXY` to be excluded from public lookups and labelled as unchecked, so that my private names never leave the machine.
16. As a developer with private modules, I want the exclusion to be derived from my own `go env`, so that I do not have to configure it twice.
17. As a Go developer, I want advisories to disappear when I update to a fixed version, so that the list reflects the files on disk.
18. As a Go developer, I want a settled advisory to stay visible for the version I resolved, even if a newer version exists, so that I am not shown a badge for code I do not build.
19. As a Go developer, I want a failed precise scan (a project that does not build) to report the toolchain's error rather than findings, so that I know the difference between "nothing found" and "could not look".
20. As a Go developer, I want scanning to be manual only, so that no compile of my project starts without my click.
21. As a maintainer, I want the advisory source behind an injected seam, so that the tests run on recorded documents with no network.
22. As a maintainer, I want advisory matching to be pure and table-tested, so that range boundaries do not regress silently.

## Implementation Decisions

### Seam

One new injected dependency, one reused one:

```ts
interface AdvisorySource {
  /** One index fetch, then one document per matched advisory. */
  lookup(modules: readonly { name: string; version: string }[]): Promise<AdvisoryLookup>;
}

interface AdvisoryLookup {
  readonly advisories: ReadonlyMap<string, readonly Advisory[]>;
  readonly fetchedAt: string;          // ISO timestamp of the data actually used
  readonly stale: boolean;             // served from cache past its TTL
}
```

Production implements it with the official Go vulnerability database over HTTPS; tests pass recorded index and document JSON. `govulncheck` does **not** get a new seam: it runs through the existing `GoRunner`, so its arguments, working directory, environment and timeout are observable in the same place as every other command.

The Go adapter gains two methods, both optional on the neutral interface because not every ecosystem has both signals:

```ts
advisories?(model: PanelModel): Promise<PanelModel>;
preciseScan?(project: ProjectSummary): Promise<ScanResult>;
```

`advisories` filtering (private paths, TTL, dedupe) and `preciseScan` parsing stay in the Go adapter. The pure merge of advisories into rows lives in the core and is unit-tested without IO.

### Data and matching

- Source of truth: the official Go vulnerability database. One index request maps module paths to advisory IDs; one document per matched advisory supplies the affected ranges. The exact index shape is verified against the published schema during implementation; the seam keeps that detail out of the panel and the tests.
- Cache: the index and matched documents go to extension `globalStorage`, 24h TTL, one fetch in flight at a time. A manual refresh bypasses the TTL. A stale cache is served with `stale: true` when the network fails.
- Matching: a dependency is affected when its resolved version falls inside an affected range for its module path. Both bounds are exclusive/inclusive exactly as the advisory states (`introduced`, `fixed`); prereleases sort below their release, pseudo-versions are matched against the range that contains their base version.
- Only the resolved version is matched. The declared version is irrelevant once the resolver has picked.
- Fixed version = the lowest version at or above the resolved version that is not in an affected range for the same module path. It is offered only when it is strictly greater than the resolved version and the module path is unchanged.
- Private modules: before any request, module paths are matched against the globs from `go env GOPRIVATE` and `GONOPROXY`, read once per session through the runner. Matched paths are never looked up and are marked unchecked in the model.
- No file contents, import paths or source ever leave the machine for the module-level layer. Only module path and resolved version are sent.

### Precise scan

- Runs `go run golang.org/x/vuln/cmd/govulncheck@latest -json ./...` in the project directory with `GOWORK=off`, through the runner, with a 300s timeout and cancellation.
- Manual only: a button in the Vulnerabilities tab. Never on open, never on a timer.
- Output is a stream of JSON objects; the adapter parses findings and keeps only those with a non-empty trace, which is what makes a finding reachable.
- A finding upgrades the matching advisory on the matching dependency to `reachable: true` and records the first trace frame's symbol and package. It never invents advisories that the module-level layer did not return.
- Scan state is stored per project: `not-run` | `running` | `complete` | `failed`, with the timestamp and, on failure, the toolchain's message. It is invalidated when that project's `go.mod` or `go.sum` changes.
- Scan results are session-only. `govulncheck` contacts the vulnerability database itself; that is documented in the UI copy.

### Model

`Advisory` gains two optional fields: `reachable` and `symbol`. `ProjectSummary` gains `scan` (status, timestamp, message). Nothing else in the neutral model changes; Dart or any later ecosystem can populate the same shape or leave `scan` empty.

### Panel

- Vulnerabilities tab: rows with at least one advisory, an explicit "not scanned yet" line when every project is `not-run`, and a scan button.
- Badge vocabulary: `advisory` (amber) and `reachable` (red). The tab count is unique advisory IDs across rows; it turns red only when at least one row is reachable.
- Inspector card: GO ID, summary, affected range, fixed version, link to the public advisory page, and "Update to fixed version" routed through the update flow from #1.
- Data age: "advisories from 2 hours ago" next to the refresh control; stale data says so.
- A failed database fetch is a single banner; dependency rows stay as they were.

## Testing Decisions

A good test asserts what a consumer sees: the advisory attached to a dependency, the fixed version offered, the state after a failed fetch, the commands the scan runs, and the findings it produces. Tests must not assert HTTP call order beyond the seam, cache file layout, or parser internals.

Modules tested:

- **Advisory source client** against recorded index and document JSON, covering hit, miss, malformed document, and network failure with a stale cache.
- **Matcher** as a pure table: version inside and outside each range, `introduced` boundary, `fixed` boundary, prerelease below its release, pseudo-version, and two advisories on one module.
- **Go adapter advisory merge**: private paths excluded, unchecked label applied, dedupe by GO ID across projects.
- **govulncheck parser**: recorded `-json` output in three shapes — reachable finding, advisory with no trace, and a non-zero exit with a build error.
- **Core merge**: advisories attached to the right rows without touching versions; existing assembler tests stay as they are.

Prior art: the fixture tests that drive the adapter from recorded toolchain output, and the table-driven version tests in the core. The same fake-runner pattern extends to scanning.

One opt-in smoke test, gated by an environment flag, queries the real database for a known module and asserts an advisory is found; excluded from CI.

## Out of Scope

- Severity scores, CVSS, and sorting by severity.
- Suppressing or dismissing advisories, and per-advisory ignore files.
- Automatic fixing of several advisories in one action.
- Bundling the vulnerability database for offline use beyond the 24h cache.
- Advisory support for other ecosystems, including Dart.
- Scanning on open, on save, or on a timer.
- SBOM export and CI integration.

## Further Notes

- ADR 0002 is the governing decision: amber is module-level, red is call-graph. This spec implements it, and the UI copy is part of the contract.
- ADR 0005 applies to `govulncheck` output: the tool is the parser, the adapter only reads its JSON.
- ADR 0007 keeps the source behind the adapter; the panel never learns about GO IDs' transport.
- The 24h TTL and the manual refresh were decided during design (round 4), and the private-path rule extends the existing `GOPRIVATE` decision into the advisory layer.
- The index shape and the exact `govulncheck` JSON fields are the two facts to verify first; both are isolated by the seam.
