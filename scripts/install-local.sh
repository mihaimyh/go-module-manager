#!/usr/bin/env bash
# Build a local VSIX and install it into Cursor / VS Code / Insiders when present.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

editors=(cursor code code-insiders)
found=()
missing=()

for editor in "${editors[@]}"; do
  if command -v "$editor" >/dev/null 2>&1; then
    found+=("$editor")
  else
    missing+=("$editor")
  fi
done

if ((${#found[@]} == 0)); then
  echo "error: none of ${editors[*]} are on PATH" >&2
  exit 1
fi

echo "Building VSIX…"
npm run package

version="$(node -p "require('./package.json').version")"
name="$(node -p "require('./package.json').name")"
vsix="$root/${name}-${version}.vsix"

if [[ ! -f "$vsix" ]]; then
  echo "error: expected VSIX at $vsix" >&2
  exit 1
fi

echo "VSIX: $vsix"
echo

for editor in "${found[@]}"; do
  echo "Installing into $editor…"
  "$editor" --install-extension "$vsix" --force
done

if ((${#missing[@]} > 0)); then
  echo
  echo "Skipped (not on PATH): ${missing[*]}"
fi

echo
echo "Installed ${name}@${version} into: ${found[*]}"
echo "Reload each window (or restart) to pick up the build."
