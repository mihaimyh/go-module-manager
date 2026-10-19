# Browse discovers modules via `pkg.go.dev` and resolves versions via `go`

Keyword search in Browse queries `https://pkg.go.dev/v1/search`, deduplicates package hits by `modulePath`, and filters out the standard library (`std`). Selectable versions in the inspector and exact lookups for private or unindexed module paths always come from `go list -m -versions -json` under the user's `GOPROXY` and `GOPRIVATE` environment. Queries matching `GOPRIVATE` or `GONOPROXY` never contact `pkg.go.dev`.

The `go` command, `proxy.golang.org`, and `index.golang.org` do not offer a keyword search endpoint, so discovering an unknown module by keyword requires a public index. Once a module path is known, however, `pkg.go.dev` is no longer authoritative: it does not know the user's proxy, private credentials, or live retraction view. Handing off from `pkg.go.dev` discovery to `go list` for versions and `go get` for installation preserves ADR 0004 and ADR 0005 while keeping private module paths off the public search API.

## Considered Options

- **Use `pkg.go.dev/v1/versions` for the Browse version picker** — rejected: creates a second version catalog that can disagree with the user's `GOPROXY` and retraction rules.
- **Send all Browse queries to `pkg.go.dev` regardless of `GOPRIVATE`** — rejected: leaks private module paths to a public service that cannot resolve them anyway.
- **Show raw package rows from `/v1/search` without grouping by `modulePath`** — rejected: `go get` adds requirements at module granularity, so listing ten sub-packages of one module as separate install targets misleads the user.

## Consequences

Browse requires network access to `pkg.go.dev` for keyword search, while exact module paths (including private modules matching `GOPRIVATE`/`GONOPROXY`) resolve directly through the local `go` toolchain. When a search matches a sub-package (`packagePath !== modulePath`), the row surfaces the owning `modulePath` as the install target and notes the matched package path alongside it.
