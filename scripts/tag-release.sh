#!/usr/bin/env bash
# ABOUTME: Create and push a semver release tag to trigger the release workflow.
#
# Usage:
#   bash scripts/tag-release.sh <version>
#
# Examples:
#   bash scripts/tag-release.sh 0.2.0
#   bash scripts/tag-release.sh 1.0.0-beta.1
#
# This script:
#   1. Verifies you are on main and the working tree is clean.
#   2. Checks that package.json versions in packages/sdk and apps/cli match
#      the requested version (update them first if not).
#   3. Creates an annotated git tag v<version>.
#   4. Pushes the tag to origin, which triggers the release.yml workflow.
#
# Prerequisites:
#   - git configured with push access to origin
#   - packages/sdk/package.json and apps/cli/package.json both set to <version>

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
cd "$repo_root"

# ── 1. Parse and validate the version argument ──────────────────────────────

if [[ $# -lt 1 ]]; then
  echo "Usage: bash scripts/tag-release.sh <version>" >&2
  echo "  e.g: bash scripts/tag-release.sh 0.2.0" >&2
  exit 1
fi

VERSION="$1"
TAG="v${VERSION}"

# Validate semver format (major.minor.patch with optional pre-release)
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9._-]+)?$'; then
  echo "Error: version must be in semver format (e.g. 0.2.0 or 1.0.0-beta.1)" >&2
  exit 1
fi

echo "Preparing release tag: $TAG"

# ── 2. Guard: must be on main and have a clean working tree ─────────────────

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "Error: you must be on the main branch to cut a release (currently on '$CURRENT_BRANCH')" >&2
  exit 1
fi

if ! git diff --quiet HEAD; then
  echo "Error: working tree has uncommitted changes. Commit or stash them first." >&2
  exit 1
fi

# ── 3. Verify package.json versions match the requested version ─────────────

SDK_VERSION="$(node -p "require('./packages/sdk/package.json').version")"
CLI_VERSION="$(node -p "require('./apps/cli/package.json').version")"

MISMATCH=0
if [[ "$SDK_VERSION" != "$VERSION" ]]; then
  echo "Error: packages/sdk/package.json has version '$SDK_VERSION', expected '$VERSION'" >&2
  echo "  Run: node -e \"const f='packages/sdk/package.json',p=JSON.parse(require('fs').readFileSync(f));p.version='$VERSION';require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\\n')\"" >&2
  MISMATCH=1
fi
if [[ "$CLI_VERSION" != "$VERSION" ]]; then
  echo "Error: apps/cli/package.json has version '$CLI_VERSION', expected '$VERSION'" >&2
  echo "  Run: node -e \"const f='apps/cli/package.json',p=JSON.parse(require('fs').readFileSync(f));p.version='$VERSION';require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\\n')\"" >&2
  MISMATCH=1
fi
if [[ "$MISMATCH" -eq 1 ]]; then
  echo "" >&2
  echo "Update the package.json files, commit the bump, then re-run this script." >&2
  exit 1
fi

# ── 4. Check the tag does not already exist ──────────────────────────────────

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: tag $TAG already exists locally. Did you mean to release a different version?" >&2
  exit 1
fi

# ── 5. Create the annotated tag ──────────────────────────────────────────────

git tag -a "$TAG" -m "Release $TAG"
echo "Created annotated tag: $TAG"

# ── 6. Push the tag (triggers release.yml) ───────────────────────────────────

echo "Pushing $TAG to origin..."
git push origin "$TAG"

echo ""
echo "Release tag $TAG pushed."
echo "Monitor the release workflow at:"
echo "  https://github.com/namuh-eng/exponential/actions/workflows/release.yml"
