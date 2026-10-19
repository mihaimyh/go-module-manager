# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root.
- **`docs/adr/`**: read the ADRs that touch the area you are about to work in.
- **`docs/specs/`**: the spec for the slice you are implementing, if one exists.

If any of these files don't exist, **proceed silently**. Don't flag their absence and don't suggest creating them upfront; the domain-modeling skill creates them lazily when terms or decisions actually get resolved.

## Layout

Single-context repo:

```
/
├── GLOSSARY.md
├── AGENTS.md
├── docs/
│   ├── adr/
│   ├── agents/
│   └── specs/
└── src/
    ├── core/          ← ecosystem-neutral model
    ├── ecosystems/    ← one adapter per ecosystem
    ├── extension/     ← VS Code host
    └── webview/       ← panel UI
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids — notably "package" for a dependency, and "installed" for a resolved version.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for the domain-modeling skill).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0003 (writes are per module), but worth reopening because…_
