# An update writes only `go.mod` and `go.sum`

An update runs exactly one `go get` per project — `<path>@<version>` for a single row, or several pairs for a selected group — and nothing else. `go mod tidy` and `go mod vendor` are never chained onto it automatically, builds and tests are never run, and `.go` files are edited only by a separate major-version migration that shows a diff and requires confirmation.

After a successful write, the completion toast may offer **Run go mod tidy** and (when `vendor/modules.txt` already exists) **Sync vendor** as explicit follow-ups. Those still require a click; they are never implied by Update. Tidy is omitted when the write added a module that was not declared beforehand, because tidy would delete that unimported require.

The alternative — a NuGet-style one-click that also tidies — silently changes code the user did not ask to change. `go mod tidy` removes `require` lines for modules whose packages are not imported *yet*, which is exactly the state of a repository mid-feature. A dependency tool that surprises its user loses trust once and never gets it back.

## Considered Options

- **`go get` + `tidy` in one action** — rejected: deletes work-in-progress requirements.
- **`go get` + `go mod vendor` in one action** — rejected: invents or rewrites `vendor/` without an explicit click; Sync vendor is toast-only when `vendor/modules.txt` already exists.
- **Editing `go.mod` text directly instead of running `go`** — rejected: bypasses MVS, produces graphs and `go.sum` entries the toolchain rejects.
- **Running `go build`/`go test` after an update** — rejected: the extension cannot know the project's real test invocation, and a failed build is not a reason to block a version change.

## Consequences

After an update, `go.mod` may keep requirements nothing imports until the user runs tidy from the toolbar or the post-write toast. A project with `vendor/modules.txt` may report inconsistent vendoring until the user clicks Sync vendor. A major upgrade is deliberately two steps: change the requirement, then migrate imports.
