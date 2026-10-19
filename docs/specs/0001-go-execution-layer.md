# Spec 0001 — Live Go reads and updates

Status: draft, not yet published to a tracker (no tracker configured).

## Problem Statement

The panel renders recorded output from a fixture directory. A developer who installs GMM gets a toolbar button that reads the repository's own `test/fixtures/workspace` — meaningless for their project — or an error they cannot act on. They cannot see the dependencies of the module they are actually working in, cannot move one to another version, and cannot tell whether a failure came from a missing `go.sum` entry, a missing toolchain, or a private module their credentials cannot reach.

## Solution

The panel reads the workspace by running the `go` command in each owning module's directory, with workspace mode off, and completes the read in the background with the available updates. Updating a dependency runs `go get` in that module and nothing else. Every failure is shown as the toolchain's own words plus one recovery action. Nothing runs automatically: `tidy` stays a separate, confirmed button, and every write is undoable once per session.

## User Stories

1. As a Go developer, I want the panel to list the dependencies of every `go.mod` in my workspace, so that I can see what my project actually uses without opening a terminal.
2. As a Go developer, I want to see which dependencies are direct and which are indirect, so that I know what I can safely change.
3. As a Go developer, I want to see the declared version and the resolved version separately, so that I understand when another requirement is holding a version up.
4. As a Go developer, I want to see the available update for each dependency and whether it is a patch, minor, release or major move, so that I can judge the risk before clicking.
5. As a Go developer, I want prerelease versions hidden by default and shown only when I ask, so that I am not nudged into unreleased code.
6. As a Go developer, I want pseudo-versions never offered as an update target, so that I cannot accidentally pin to a commit.
7. As a Go developer, I want to update a single dependency from the inspector, so that the common case takes one click.
8. As a Go developer, I want to select several dependencies and update them in one action, so that routine maintenance is not twelve clicks.
9. As a Go developer, I want to be told which `go.mod` files an action will touch before it runs, so that a bulk update is not a surprise across modules.
10. As a Go developer, I want one level of undo after an update, so that a wrong click costs nothing.
11. As a Go developer, I want `go mod tidy` to be a separate, confirmed action, so that it never deletes a requirement I have not imported yet.
12. As a Go developer, I want the panel to open instantly with the declared versions and fill in available updates as they arrive, so that a large workspace does not feel broken.
13. As a Go developer, I want the update lookup to run once per module and be reused until `go.mod` or `go.sum` changes, so that switching tabs does not cost ten seconds each time.
14. As a Go developer, I want a Refresh button that actually re-runs the toolchain, so that I can see changes made outside the panel.
15. As a Go developer, I want the panel to notice when I edit `go.mod` in the editor and refresh itself, so that the two never disagree.
16. As a Go developer, I want a `missing go.sum entry` failure to offer the exact command that fixes it, so that I do not have to remember it.
17. As a Go developer, I want a missing `go` binary to be a first-class state with a link and a path setting, so that the panel never silently shows an empty list.
18. As a Go developer working with private modules, I want the extension to fail visibly instead of falling back to a public proxy, so that my module paths are not leaked.
19. As a Go developer, I want one broken module not to blank the whole panel, so that I can work on the healthy ones.
20. As a Go developer, I want no `go` process to survive closing the panel, so that a runaway lookup does not linger.
21. As a Go developer, I want no telemetry and no background polling, so that the extension is quiet by default.
22. As a maintainer, I want the Go adapter to keep its interface when the runner arrives, so that adding a second ecosystem later does not touch the panel.

## Implementation Decisions

### Seam

One seam: the Go adapter's dependency on a `GoRunner`. The adapter is constructed with a runner; production passes a `child_process.execFile` implementation, tests pass a fake that records calls and returns recorded output. No test mocks `child_process` directly, and no test needs a real `go` binary or network.

```ts
interface GoRunner {
  run(args: string[], options: {
    cwd: string;
    env: NodeJS.ProcessEnv;      // process.env plus GOWORK=off
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}
```

`EcosystemAdapter` gains one write method, because the write semantics are ecosystem-specific and the panel must not learn them:

```ts
read(workspaceRoot: string): Promise<PanelModel>;
update(requests: readonly UpdateRequest[]): Promise<readonly UpdateOutcome[]>;

interface UpdateRequest {
  manifestPath: string;
  changes: readonly { name: string; version: string }[];
}

type UpdateOutcome =
  | { manifestPath: string; name: string; status: 'updated' }
  | { manifestPath: string; name: string; status: 'failed'; message: string };
```

### Commands

- Read declared: `go mod edit -json`, run in the project directory. Offline, fast, no `go.sum` requirement.
- Read updates: `go list -m -u -json all`, same directory, network. Its `Update.Version` is the candidate; pseudo-version candidates are discarded.
- Write: `go get <name>@<version> [...]`, one invocation per project, several pairs on one line.
- Tidy: `go mod tidy`, one invocation per confirmed project.
- Never: `go work sync`, workspace-mode `go get`, builds, tests, `go mod download` without a click.

Every invocation sets `GOWORK=off` and inherits the user's environment (so `GOPRIVATE`, `GOPROXY`, `GOFLAGS` and credentials behave as in their terminal). Timeouts: 60s for reads, 120s for writes, cancellable.

### Reads

- Projects are discovered by manifest, one level deep, as today.
- `go mod edit -json` runs for every project in parallel; `go list -m -u -json all` runs with a concurrency cap of 4.
- The panel is usable as soon as declared versions exist; update data arrives per project.
- Concurrent reads of the same project share one in-flight promise.
- A project whose update lookup fails keeps its declared rows and gains an error, rather than disappearing.

### Cache

In-memory only, keyed by manifest path and the content hash of `go.mod` + `go.sum`. A hit returns the previous model immediately; a change to either file invalidates both the declared and the update result. Manual Refresh invalidates unconditionally. No disk cache, no TTL, no polling.

### Writes and undo

- Before writing, the adapter snapshots the bytes of `go.mod` and `go.sum` for every affected project.
- Groups are executed sequentially; within a group, one `go get` call.
- A failed group does not cancel the others; outcomes are reported per dependency.
- After the run, the adapter re-reads the affected projects so the panel shows what the toolchain actually wrote, not what the user asked for.
- One snapshot generation per project per session powers a single Undo action; it restores both files.

### Errors

Failures are classified before they reach the panel:

| Toolchain output | Panel state | Recovery offered |
| --- | --- | --- |
| `missing go.sum entry` | Project error, rows still listed | Run `go mod download`, then retry once |
| `executable file not found` / ENOENT | Extensions-level error | Link to install Go, `gmm.goPath` setting |
| Auth or 403/410 on a private path | Project marked unresolved | Show the command output; never fall back to a public proxy |
| Timeout | Project error | Retry |
| Any other non-zero exit | Project error | Show the first stderr line |

### Panel wiring

- `Check for updates`, per-row `Update`, bulk `Update selected` and `go mod tidy` become enabled.
- Update and tidy ask for confirmation naming the `go.mod` files involved; a single-row update may skip the dialog.
- Progress is shown in the tab strip (`checking 3 / 20`) and per project, not as a modal.
- A project error renders as a banner above the table with the recovery action.

## Testing Decisions

A good test asserts what a user or an adapter consumer can observe: the commands the adapter runs, the arguments and working directory, the model it returns, the files it snapshots and restores, and the errors it produces. Tests must not assert private helper calls or internal data shapes that the panel cannot see.

Modules tested:

- **Go adapter**: read and update, driven by a fake runner. These tests replace the current recorded-fixture tests and keep their golden JSON as fake runner output, so the assertions stay behavioural.
- **Core assembler**: unchanged; already covers declared vs resolved, candidate filtering and advisory attachment.
- **Cache and invalidation**: assert that a second read with an unchanged manifest does not invoke `go list -m -u`, and that a changed hash does.
- **Error mapping**: assert the state and the recovery action for each row of the table, from stderr text alone.

Prior art: the current fixture tests assert adapter output from recorded JSON and are the model for the fake-runner tests.

One opt-in smoke test, gated by an environment flag, creates a temporary module, reads it with the real toolchain and asserts a known module appears. It is excluded from CI.

## Out of Scope

- Advisory data, `govulncheck`, and the Vulnerabilities tab content.
- Consolidation writes and `go work sync`.
- Major-version migration and import rewriting.
- Downgrades below the resolved version.
- The Dart adapter.
- Marketplace publishing, icons, and the final product name.
- Multi-root workspaces: the panel keeps using the first workspace folder.
- Persisting undo across sessions, disk caches, and background refresh timers.

## Further Notes

- ADR 0001 (writes limited to `go.mod`/`go.sum`), ADR 0003 (per module, `GOWORK=off`), ADR 0005 (`go` is the parser) and ADR 0007 (adapter seam) are all load-bearing here.
- The `GOWORK=off` write behaviour was verified on one probe workspace; the fake-runner tests pin the commands, and the smoke test verifies the real toolchain.
- Windows path casing between a discovered manifest and the `go` output is the most likely source of a subtle bug; normalise before comparing.
- The adapter's `read` signature does not change in this work; only its body and the interface's new `update` method.
