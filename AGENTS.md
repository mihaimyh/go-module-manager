# GMM

A VS Code extension that reads and moves the dependencies of a Go workspace. The core speaks in cross-ecosystem terms (project, dependency, declared version, resolved version); Go is the first adapter.

- `README.md` — what it does and how to build it.
- `GLOSSARY.md` — the vocabulary used in code, issues and specs.
- `docs/adr/` — decisions that were hard to reverse.
- `docs/specs/` — specs, mirrored to GitHub issues.
- `docs/design.md` — scope and the 0.1 ship bar.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `mihaimyh/go-module-manager`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles use their default names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
