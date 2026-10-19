# Writes are per module, with workspace mode off

Every read and every write runs in the directory of the `go.mod` that owns the requirement, with `GOWORK=off`. GMM never creates or edits a `go.work` file.

Workspace mode changes which build list is reported, not which file `go get` edits: in a probe workspace where module `a` required `rsc.io/quote v1.5.1` and module `b` required `v1.5.2`, `go get quote@v1.5.1` inside `a` edited only `a/go.mod` and left `go.work` and `b` untouched — but the workspace build list reported `v1.5.2`, while `a` on its own reported `v1.5.1`. A panel built on the workspace context would show a version that acting on the row cannot produce. Turning workspace mode off makes the displayed version and the written version come from the same context.

## Considered Options

- **Workspace-mode reads and writes** — rejected: the workspace build list masks each module's own selection, so "selected version" in the UI would not be the version the module resolves.
- **`go work sync` as the update mechanism** — deferred to the consolidation write flow, which is cross-module by design.
- **Refusing to open when a workspace is detected** — rejected: reading across modules is safe and is the point of the aggregated view.

## Consequences

A workspace can hold different versions of the same module in different `go.mod` files; v1 shows that divergence (Consolidate) without fixing it. Every action needs a known owning module. Opening a 20-module workspace costs 20 process spawns, so reads are parallelised and cached per file content hash.
