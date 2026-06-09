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

pnpm --filter @namuh-eng/exponential-sdk typecheck
pnpm --filter @namuh-eng/exponential-sdk test
pnpm --filter @namuh-eng/exponential-sdk build

pnpm --filter @namuh-eng/exponential-cli typecheck
pnpm --filter @namuh-eng/exponential-cli test
pnpm --filter @namuh-eng/exponential-cli build

pnpm --filter @namuh-eng/exponential-sdk pack --pack-destination "$PWD/.release"
pnpm --filter @namuh-eng/exponential-cli pack --pack-destination "$PWD/.release"

sdk_tarballs=(.release/namuh-eng-exponential-sdk-*.tgz)
cli_tarballs=(.release/namuh-eng-exponential-cli-*.tgz)

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
  npm view @namuh-eng/exponential-sdk version
  npm view @namuh-eng/exponential-cli version
fi
