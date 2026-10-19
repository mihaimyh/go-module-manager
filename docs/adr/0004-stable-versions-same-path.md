# Update candidates are stable versions of the same module path

An update candidate is a stable version of the same module path. Prereleases appear only when the user enables them, pseudo-versions are never offered as a target, and a new major version is a different module path and therefore never an update candidate at all.

Go's own `@latest` quietly excludes prereleases and retracted versions, so a UI that lists "all tags" offers states the toolchain will not select by default. Treating v2 as a different module is not a detail to hide: the path changes, and so does every import.

## Considered Options

- **Offer every version returned by the proxy** — rejected: mixes four different things (releases, prereleases, pseudo-versions, retractions) under one label.
- **Treat a major upgrade as a normal update** — rejected: it requires an import rewrite, which is a separate, confirmed action.

## Consequences

Pinning to a commit hash is not possible from the UI; the user edits `go.mod` or runs the command themselves. Moving to a new major version always goes through the migration flow.
