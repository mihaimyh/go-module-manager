# Undo restores bytes; it does not run the toolchain

Undo writes back the `go.mod` and `go.sum` bytes captured immediately before the last update, and deletes a `go.sum` the update created. It never runs `go get` or `go mod tidy` to "undo" a version.

ADR-0001 rejects hand-editing `go.mod` because a hand-edited file can hold a graph the toolchain would never produce. Restoring a snapshot is the opposite situation: the bytes are known-good, they are the exact bytes the toolchain itself wrote moments earlier, and replaying a command to reach them would be slower, ambiguous (what is the inverse of `go get`?) and could touch unrelated requirements.

## Consequences

Undo is one level, per project, in memory and per session; closing the window forgets it. Because the snapshot belongs to the adapter instance, adapters are memoised per toolchain path rather than rebuilt on every load.
