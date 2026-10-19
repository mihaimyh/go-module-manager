# The `go` command is the source of truth, never a `go.mod` parser

Requirements are read from `go mod edit -json`; the build list and available updates come from `go list -m -u -json`. GMM never parses `go.mod` text itself.

A hand-written parser is the classic way to get this wrong: single-line versus block `require` forms, quoted module paths, `replace`, `exclude`, `retract`, `toolchain` lines, comments, and CRLF. The toolchain already produces a documented JSON shape for each of these, and the extension needs a working `go` binary anyway to do anything.

## Considered Options

- **A TypeScript `go.mod` parser** — rejected: correctness burden with no upside beyond saving one subprocess spawn of a few tens of milliseconds.
- **`golang.org/x/mod` compiled to something callable from Node** — rejected: a build pipeline for a solved problem.

## Consequences

Opening the panel requires a working `go` on `PATH` (or a configured path), so a missing toolchain is a first-class state rather than an afterthought. Every read costs one process spawn, which is why reads are cached per `go.mod` content hash.
