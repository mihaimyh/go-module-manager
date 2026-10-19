#!/usr/bin/env bash
# Bump the extension version from the latest git tag, commit, tag, push, and
# publish to the VS Marketplace (Entra ID via `az login`).
#
# Usage:
#   bash scripts/publish-local.sh              # patch bump (default)
#   bash scripts/publish-local.sh minor
#   bash scripts/publish-local.sh major
#   bash scripts/publish-local.sh 0.2.0        # explicit version
#   bash scripts/publish-local.sh patch --dry-run
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

dry_run=0
bump=patch

for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    patch|minor|major) bump=$arg ;;
    [0-9]*.[0-9]*.[0-9]*) bump=$arg ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "error: unknown argument '$arg' (use patch|minor|major|x.y.z [--dry-run])" >&2
      exit 1
      ;;
  esac
done

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: '$1' is not on PATH" >&2
    exit 1
  fi
}

need git
need node
need npm
need npx

if [[ "$(git rev-parse --is-inside-work-tree 2>/dev/null)" != "true" ]]; then
  echo "error: not inside a git repository" >&2
  exit 1
fi

bump_semver() {
  local version="$1" part="$2"
  local major minor patch
  IFS=. read -r major minor patch <<<"$version"
  case "$part" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
    *)
      echo "error: invalid bump '$part'" >&2
      return 1
      ;;
  esac
}

version_gt() {
  # Returns 0 when $1 > $2 (semver x.y.z).
  printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n 1 | grep -qx "$1" && [[ "$1" != "$2" ]]
}

echo "Fetching tags from origin…"
git fetch origin --tags --quiet

latest_tag="$(git tag -l 'v*.*.*' | sort -V | tail -n 1 || true)"
if [[ -z "$latest_tag" ]]; then
  latest_version="0.0.0"
else
  latest_version="${latest_tag#v}"
fi

if [[ "$bump" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  next_version="$bump"
else
  next_version="$(bump_semver "$latest_version" "$bump")"
fi

if ! [[ "$next_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: invalid version '$next_version'" >&2
  exit 1
fi

next_tag="v${next_version}"
pkg_version="$(node -p "require('./package.json').version")"

echo
echo "Latest tag:   ${latest_tag:-none} (${latest_version})"
echo "package.json: ${pkg_version}"
echo "Next release: ${next_version} (tag ${next_tag})"
echo

if ((dry_run)); then
  if git rev-parse -q --verify "refs/tags/${next_tag}" >/dev/null; then
    echo "note: tag ${next_tag} already exists"
  fi
  if ! grep -qE "^## ${next_version}\$" CHANGELOG.md; then
    echo "note: CHANGELOG.md has no '## ${next_version}' section yet"
  fi
  echo "Dry run only — no commit, tag, push, or marketplace publish."
  exit 0
fi

need az

branch="$(git branch --show-current)"
if [[ "$branch" != "main" ]]; then
  echo "error: publish from main (currently on '$branch')" >&2
  exit 1
fi

# Allow uncommitted CHANGELOG / package.json edits (release notes + version);
# anything else must be committed first.
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  path="${line:3}"
  case "$path" in
    CHANGELOG.md|package.json) ;;
    *)
      echo "error: uncommitted changes beyond CHANGELOG.md / package.json:" >&2
      git status --short >&2
      exit 1
      ;;
  esac
done < <(git status --porcelain)

echo "Checking Azure login…"
if ! az account show >/dev/null 2>&1; then
  echo "error: not logged into Azure — run 'az login' first" >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/${next_tag}" >/dev/null; then
  echo "error: tag ${next_tag} already exists" >&2
  exit 1
fi

if ! version_gt "$next_version" "$latest_version"; then
  echo "error: next version ${next_version} must be greater than latest tag ${latest_tag:-none}" >&2
  exit 1
fi

if ! grep -qE "^## ${next_version}\$" CHANGELOG.md; then
  echo "error: CHANGELOG.md has no '## ${next_version}' section" >&2
  echo "Add release notes under that heading, then re-run." >&2
  exit 1
fi

if [[ "$pkg_version" != "$next_version" ]]; then
  echo "Updating package.json to ${next_version}…"
  node -e "
    const fs = require('fs');
    const path = 'package.json';
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    pkg.version = process.argv[1];
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  " "$next_version"
fi

echo "Building…"
npm run typecheck
npm test
npm run build

echo "Committing…"
git add package.json CHANGELOG.md
if [[ -n "$(git status --porcelain)" ]]; then
  git commit -m "$(cat <<EOF
chore: release ${next_version}

EOF
)"
else
  echo "Nothing to commit (package.json already at ${next_version})."
fi

echo "Tagging ${next_tag}…"
git tag "$next_tag"

echo "Pushing main and ${next_tag}…"
git push origin HEAD
git push origin "$next_tag"

echo "Publishing to Marketplace…"
npx vsce publish --no-dependencies --azure-credential

name="$(node -p "require('./package.json').name")"
echo
echo "Published ${name}@${next_version}"
echo "Marketplace: https://marketplace.visualstudio.com/items?itemName=mihaimyh.go-module-manager"
echo "CI will attach the VSIX to the GitHub release for ${next_tag}."
