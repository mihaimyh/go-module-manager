# An update writes only `go.mod` and `go.sum`

An update runs exactly `go get <path>@<version>` and nothing else. `go mod tidy` is never chained onto it, builds and tests are never run, and `.go` files are edited only by a separate major-version migration that shows a diff and requires confirmation.

The alternative — a NuGet-style one-click that also tidies — silently changes code the user did not ask to change. `go mod tidy` removes `require` lines for modules whose packages are not imported *yet*, which is exactly the state of a repository mid-feature. A dependency tool that surprises its user loses trust once and never gets it back.

## Considered Options

- **`go get` + `tidy` in one action** — rejected: deletes work-in-progress requirements.
- **Editing `go.mod` text directly instead of running `go`** — rejected: bypasses MVS, produces graphs and `go.sum` entries the toolchain rejects.
- **Running `go build`/`go test` after an update** — rejected: the extension cannot know the project's real test invocation, and a failed build is not a reason to block a version change.

## Consequences

After an update, `go.mod` may keep requirements nothing imports until the user runs tidy from the toolbar. A major upgrade is deliberately two steps: change the requirement, then migrate imports.
