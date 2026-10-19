# Ecosystems sit behind an adapter; the core speaks in neutral terms

The core model names things every ecosystem has — project, dependency, declared version, resolved version, scope, candidate, advisory — and each ecosystem implements one `EcosystemAdapter` that reads a workspace into that model. The Go adapter is the only implementation until 0.1 ships; Dart is the second, added as a read-only spike before any write support.

Adding a second language to a Go-shaped core means touching every screen, every test and the glossary. Doing the rename now costs one afternoon; doing it after the UI, the runner and the advisory client exist costs a rewrite of the parts users see. The adapter boundary is deliberately small — one `read` method today — because the other operations (plan, apply, advisories) do not exist yet and inventing their signatures now would be guessing.

## Considered Options

- **Feature flags inside a shared model** — rejected: the model would still expose Go concepts (`module`, build list) that Dart cannot populate honestly.
- **Separate panels per ecosystem** — rejected for now: one panel is the product; a second panel is a different product decision.
- **Full adapter interface up front** (`plan`, `apply`, `advisories`) — rejected: signatures without implementations become wrong signatures.

## Consequences

Go-specific vocabulary stays in the adapter and in UI copy until a second ecosystem justifies changing labels. The neutral row is a *dependency*, never a *package*, because "package" already means a directory of Go source and would collide. Adding Dart will introduce a scope dimension (runtime / dev / optional) that Go only ever fills with "runtime"; the UI must learn to show it without pretending Go has dev dependencies.
