# A verification failure may clear the toolchain's checksum cache

When `go list` or `go run` fails with a checksum-database error (`malformed note`, bad signature), GMM offers **Repair checksum cache**. The action deletes `<GOMODCACHE>/cache/download/sumdb` and retries. It never disables verification (`GOSUMDB=off`, `GONOSUMDB=*`) and never deletes downloaded modules.

A corrupted signed tree note in the module cache fails every lookup and survives restarts, so retrying alone cannot recover; a user would otherwise be told "check your network" for a local cache problem. Disabling verification would "fix" it by removing the guarantee, which is not GMM's decision to make.

## Consequences

This is the only action that writes outside the project. It is user-initiated, confirmed by a modal, and bounded to a cache directory that the toolchain refetches on demand. If the corruption comes from a proxy rewriting responses, the repair fails again and the banner reports the same error — the honest outcome.
