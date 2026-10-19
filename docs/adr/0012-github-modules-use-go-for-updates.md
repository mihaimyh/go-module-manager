# `github.com/...` modules discover updates through `go`, not GitHub

Module paths under `github.com/` are not a special case for version discovery. Whether a dependency has an update is whatever `go list -m -u` reports under the user's `GOPROXY`, `GOPRIVATE`, and credentials — the same rule as every other module path (ADR 0005). The GitHub Releases and tags APIs are never a second catalog of candidates; they only enrich release notes for versions the toolchain already surfaced.

Pseudo-versions and commit pins still appear in the UI so the declared and resolved state is honest. They are never chased as newer-commit candidates (ADR 0004); when the pin is a pseudo-version and `go list -m -u` offers nothing, the inspector says so instead of inventing a target.

## Considered Options

- **Treat GitHub Releases/tags as the update source for `github.com/...`** — rejected: a second catalog that diverges from Go's view, ignores proxy and private-module auth, and invents candidates the toolchain will not select.
- **Install-from-GitHub browser or timer polling of GitHub** — rejected: outside discovery; GMM does not browse or poll GitHub for versions.
- **Force `GOPROXY=direct` inside GMM to dodge proxy lag** — rejected: overrides the user's module environment; lag is not GMM's problem to paper over.
- **Ship a GMM GitHub token for private version discovery** — rejected: private modules use the user's existing `go` auth, not an extension-owned credential.
- **Surface `replace` rows in Updates** — rejected: a replace is local wiring, not an upstream update candidate.

## Consequences

Update badges and the Updates list stay identical for GitHub-hosted and other modules. Release notes may be missing when GitHub has no matching Release for a go-visible version; that is enrichment failure, not a missing update. Private `github.com/...` modules work only when the user's Go environment already can. There is no background poll — candidates refresh when the panel loads, on Check for updates, or when watched manifests change.
