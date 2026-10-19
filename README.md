# GMM — Go Module Manager

A VS Code extension that shows the dependencies of a Go workspace — direct, indirect, outdated, or affected by a known advisory — and moves them to other versions without touching code you did not ask it to touch.

Status: pre-0.1, skeleton only. Nothing is published yet.

## What it does today

- Opens a panel listing every requirement of every `go.mod` in the workspace, read live from the go toolchain, with the owning module per row.
- Shows the declared version and the indirect flag; resolved versions, update candidates and their patch/minor/major classification arrive with the update lookup.
- Shows available updates filling in per project after the panel opens, cached by the content of `go.mod` and `go.sum`.
- Writes and scans are the next tickets; nothing is modified yet.

## What it will not do

- Run `go mod tidy` for you as part of an update.
- Rewrite `.go` imports automatically.
- Write to `go.work`.
- Browse or install packages in v1.

## Development

```sh
npm install
npm run build     # bundles extension + webview into dist/
npm run typecheck
npm test
npm run package   # produces a .vsix
```

Press `F5` to launch the extension host against the fixture workspace.

Decisions live in `docs/adr/`, vocabulary in `GLOSSARY.md`, scope in `docs/design.md`.
