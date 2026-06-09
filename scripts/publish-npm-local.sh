#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

cd "$repo_root"

dry_run="${DRY_RUN:-true}"
if [[ "$dry_run" != "true" && "$dry_run" != "false" ]]; then
  echo "DRY_RUN must be true or false." >&2
  exit 1
fi

if ! npm whoami >/dev/null 2>&1; then
  echo "Not logged in to npm. Run: npm login" >&2
  exit 1
fi

rm -rf .release
mkdir -p .release

pnpm install --frozen-lockfile

pnpm --filter @expn/sdk typecheck
pnpm --filter @expn/sdk test
pnpm --filter @expn/sdk build

pnpm --filter @expn/cli typecheck
pnpm --filter @expn/cli test
pnpm --filter @expn/cli build

pnpm --filter @expn/sdk pack --pack-destination "$PWD/.release"
pnpm --filter @expn/cli pack --pack-destination "$PWD/.release"

sdk_tarballs=(.release/expn-sdk-*.tgz)
cli_tarballs=(.release/expn-cli-*.tgz)

if [[ "${#sdk_tarballs[@]}" -ne 1 || "${#cli_tarballs[@]}" -ne 1 ]]; then
  echo "Expected exactly one SDK tarball and one CLI tarball in .release." >&2
  ls -la .release >&2
  exit 1
fi

publish_args=(--access public)
if [[ "$dry_run" == "true" ]]; then
  publish_args+=(--dry-run)
fi

echo "Publishing ${sdk_tarballs[0]} with DRY_RUN=$dry_run"
npm publish "${sdk_tarballs[0]}" "${publish_args[@]}"

echo "Publishing ${cli_tarballs[0]} with DRY_RUN=$dry_run"
npm publish "${cli_tarballs[0]}" "${publish_args[@]}"

if [[ "$dry_run" == "false" ]]; then
  npm view @expn/sdk version
  npm view @expn/cli version
fi
