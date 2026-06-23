# Publishing the CLI

This repo publishes two npm packages for the CLI distribution path:

- `@namuh-eng/expn-sdk`
- `@namuh-eng/expn-cli`

The CLI package depends on the SDK package, so publish the SDK first and the CLI
second. The publish workflow does this ordering automatically.

## One-time npm setup

The workflow uses npm trusted publishing from GitHub Actions. In npm, configure
trusted publishing for both packages with:

- Organization/user: `expn`
- Repository: `exponential`
- Workflow file: `publish-cli.yml`
- Allowed action: `npm publish`

The package `repository.url` fields must continue to point at
`https://github.com/namuh-eng/exponential.git`.

## Dry run

Run the workflow manually from GitHub Actions with `dry_run: true`. This builds,
tests, packs, and runs `npm publish --dry-run` for both tarballs.

## Publish

After the dry run succeeds and npm trusted publishing is configured, rerun the
workflow with `dry_run: false`.

The workflow:

1. Installs dependencies with Bun.
2. Typechecks, tests, and builds `@namuh-eng/expn-sdk`.
3. Typechecks, tests, and builds `@namuh-eng/expn-cli`.
4. Creates release tarballs with `scripts/pack-release-tarballs.mjs`, which rewrites
   `workspace:*` dependencies to the package version inside the tarball.
5. Publishes the SDK tarball first, then the CLI tarball.

## Local package verification

From a source checkout:

```bash
bun run --filter @namuh-eng/expn-sdk build
bun run --filter @namuh-eng/expn-cli build
node scripts/pack-release-tarballs.mjs .release
```

Inspect the tarballs:

```bash
tar -tf .release/namuh-eng-expn-sdk-*.tgz
tar -tf .release/namuh-eng-expn-cli-*.tgz
```

The CLI tarball should contain `bin/exponential`, `dist/`, and `README.md`.
Its package manifest should expose both `expn` and `exponential` binaries.

## Local manual publish

If publishing from a local checkout instead of GitHub Actions, authenticate with
npm first:

```bash
npm login
```

Then run the same verification, pack, and publish flow:

```bash
DRY_RUN=true scripts/publish-npm-local.sh
DRY_RUN=false scripts/publish-npm-local.sh
```

The script publishes the packed tarballs instead of the workspace directories so
the CLI package depends on the published SDK version instead of `workspace:*`.
