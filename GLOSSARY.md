# GMM

A VS Code extension that shows the dependencies of a Go workspace — which are direct, indirect, outdated or affected by a known advisory — and moves them to other versions safely.

## Dependencies

**Module**:
A versioned unit of Go code, identified by a module path. The thing a version is chosen for, and the thing GMM manages.
_Avoid_: package, library, NuGet package

**Package**:
An importable directory of Go source files. Many packages live inside one module.
_Avoid_: using "package" for a row in the dependency list

**Requirement**:
A `require` line in a `go.mod`: module path, minimum version, optional `// indirect` marker. The unit GMM lists, edits and updates.
_Avoid_: dependency entry, installed package

**Direct requirement**:
A requirement whose module provides at least one package imported by the main module's own packages.

**Indirect requirement**:
A requirement marked `// indirect` because no package from that module is imported by the main module's own packages; it is needed to build packages of other requirements.
_Avoid_: transitive dependency as a synonym in Go (a module can be imported transitively and still be a direct requirement)

**Build list**:
The modules and versions the go command will actually use, computed from every requirement.

**Selected version**:
The version of a module in the build list of a given build context. Never lower than any requirement on that module, and not necessarily equal to the version written in `go.mod`.
_Avoid_: installed version, current version, locked version

**Replacement**:
The target of a `replace` directive: another module path and version, or a local directory. The replacement, not the declared requirement, decides which code and selected version build. GMM shows it but never edits the directive.
_Avoid_: override, fork (a replacement can be a fork, but a fork is not necessarily a replacement)

**Build context**:
The set of modules a version is resolved against: one module on its own, or every module listed in `go.work`. The same module can have a different selected version in each.
_Avoid_: environment

**Minimum Version Selection (MVS)**:
Go's rule that the selected version of a module is the highest minimum version any requirement asks for. It is why a single requirement line cannot be lowered on its own.

**Update**:
Raising a requirement so that a higher version is selected. The build list keeps every module it had.

**Downgrade**:
Selecting a version lower than some requirement asks for. Only achievable by also lowering or dropping those dependents, so it can remove modules from the build list. Never equivalent to editing one version number.
_Avoid_: rollback (implies restoring a previous state)

**Update candidate**:
A newer version of the same module path that the toolchain reports as available, excluding prereleases and retracted versions.
_Avoid_: latest version, newest version

**Prerelease**:
A version carrying a SemVer suffix such as `-rc.1` or `-beta.2`. Excluded from "latest".

**Pseudo-version**:
A synthetic version naming a commit, such as `v0.0.0-20240101120000-abcdef123456`. Neither a release nor a prerelease.

**Retraction**:
An author marking a published version as not to be used, declared in their own `go.mod`.

**Major version suffix**:
From v2 onwards the module path itself carries `/v2`. A major upgrade changes the requirement path and every import of that module's packages.
_Avoid_: major version bump (implies a number change only)

**Workspace**:
A `go.work` file grouping several modules for local development. It does not align their versions.
_Avoid_: solution, multi-project (NuGet words)

**Owning module**:
The Go module whose `go.mod` contains a given requirement; the project that owns a dependency in the cross-ecosystem model.
_Avoid_: host module

**Consolidation**:
Comparing, across the modules of one workspace, the versions they require of the same module path. Divergence is shown, not rewritten.
_Avoid_: sync, alignment (that is the write action, not the view)

**Workspace sync**:
Writing the workspace build list's versions back into every member module's `go.mod` in one operation. A bulk write, distinct from consolidation.

## Cross-ecosystem core

**Project**:
One manifest and the code it governs — a `go.mod`, a `pubspec.yaml`. The owning unit of every action.
_Avoid_: workspace, solution

**Dependency**:
A declared need on another unit of code, carrying a declared version and a resolved version. The row in the panel.
_Avoid_: package (in Go that is a directory of source; in Dart it is the dependency unit itself)

**Declared version**:
The version written in the manifest.
_Avoid_: required version (Go-only wording, kept only in UI copy)

**Resolved version**:
The version the ecosystem's resolver picked. At least the declared version in Go; the lockfile's pin in Dart.
_Avoid_: selected version (Go-only), locked version

**Scope**:
Why a dependency is needed: at runtime, only for development, or optionally. Go only ever fills this with runtime.

**Failure**:
A project state where the toolchain could not read or resolve it. Shown with the toolchain's own words, never as a silent gap.
_Avoid_: error (that is the toolchain's message), warning

**Failure kind**:
The classification that decides the recovery action: missing lock entry, missing toolchain, authentication required, timeout, unknown.
_Avoid_: error code

**Recovery action**:
The single action a failure offers: repair the lock file, install the toolchain, or retry.
_Avoid_: fix, auto-repair

## Security

**Advisory**:
A published report that specific package symbols within a version range of a module are vulnerable. Identified by a GO ID (`GO-2024-00001`) which may map to one or more CVEs.
_Avoid_: CVE (that is an identifier an advisory may reference), vulnerability (unnamed)

**Call-graph finding**:
An advisory whose vulnerable symbols are reachable from the code being built. Reported by symbol-level scanning, not by module-level lookup.

**Fixed version**:
The lowest version outside an advisory's affected range for a module.

## Product

**GMM**:
Go Module Manager, this extension.
