# Discovery reads go.work and every workspace folder

Project discovery prefers the `use` directories of a `go.work` at the folder root (via `go work edit -json`, never with `GOWORK=off`), and falls back to the ADR 0009 tree walk when there is no work file or the command yields nothing. The VS Code host passes every workspace folder, not only the first.

Nested modules listed in `go.work` were invisible under ADR 0009's stop-at-module walk. Reading `go.work` finds exactly the modules the developer already grouped for local development, without writing the file (ADR 0003) and without inventing a second nested-walk policy. Multi-root windows previously silently ignored every folder after the first.

## Consequences

A `go.work` that lists `./api` and `./api/examples/demo` shows both projects. Modules absent from `go.work` still need the tree walk (sibling modules under a folder with no work file). Actions remain per owning `go.mod` with `GOWORK=off`. Detecting Go treats a root `go.work` as sufficient even before the walk runs.
