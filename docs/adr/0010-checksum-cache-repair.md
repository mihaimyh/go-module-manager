# A verification failure may clear the toolchain's checksum state

When `go list` or `go run` fails with a checksum error (`malformed note`, `malformed record data`, `checksum mismatch`), GMM offers **Repair checksum cache**. The action deletes three kinds of toolchain state and retries:

- `<GOPATH>/pkg/sumdb/<name>/latest`, the signed tree note Go reads when it initializes the checksum client. A truncated or zeroed note fails every lookup with `reading tree note: malformed note`.
- `<GOMODCACHE>/cache/download/sumdb`, the lookup and tile cache.
- Metadata files under `<GOMODCACHE>/cache/download` (`.mod`, `.info`, `.ziphash`) whose bytes are all zero but whose length is not. Go trusts these files instead of refetching, producing `malformed record data` or `checksum mismatch`.

It never disables verification (`GOSUMDB=off`, `GONOSUMDB=*`) and never deletes downloaded modules.

A corrupt signed tree note or a zero-filled `.mod` survives restarts, so retrying alone cannot recover; a user would otherwise be told "check your network" for a local file problem.

## Consequences

This is the only action that writes outside the project. It is user-initiated, confirmed by a modal, and bounded to directories the toolchain refetches on demand. If the corruption comes from a proxy rewriting responses, the repair fails again and the banner reports the same error — the honest outcome.
