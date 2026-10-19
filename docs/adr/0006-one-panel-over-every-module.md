# One panel over every module, resolved per module

The panel lists the requirements of every `go.mod` in the workspace in a single table, with the owning module shown per row and a module filter once there is more than one. Each row's versions are resolved in its own module's build context. The only cross-module feature is the read-only Consolidate view.

This mirrors a NuGet solution view — solution, projects, `PackageReference` — because the underlying shapes match: one file per module, one requirement per line, one version per requirement, written per file. It does not mirror NuGet's central package management, which has no Go equivalent: `go.work` groups modules for development but does not declare versions.

## Consequences

Actions are always scoped to exactly one file, which keeps the confirmation copy honest ("this changes `services/api/go.mod`"). The workspace build list is never displayed, so a user who thinks in workspace terms may be surprised that two rows for the same module show different versions; the Consolidate view exists to explain exactly that.
