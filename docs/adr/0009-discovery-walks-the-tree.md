# Discovery walks the tree, with skips, and stops at a module

`go.mod` files are found by walking down from the workspace root with three rules: skip dependency and tooling directories (`node_modules`, `vendor`, `.venv`, `dist`, `build`, `target`, and any dot-directory), stop descending once a directory holds a manifest, and cap the walk at six levels and 5000 directories.

Root-plus-one-level was a guess that fails on ordinary monorepos: `src/backend/server/go.mod` is two levels down, and a user's first attempt to open such a repository produced "no supported manifest". Walking gives up a little predictability to work on real layouts; the skips keep it from indexing `node_modules` or a `.kilo` worktree copy, and stopping at a manifest treats a module as the project boundary it is in Go.

## Consequences

A repository that keeps Go fixtures or example modules inside its own tree will list them as projects. The walk is bounded, so a pathological tree degrades to "not found" instead of hanging. The panel's project list can grow beyond what a single `go.mod` describes, and the existing per-project actions keep every write scoped to one file.
