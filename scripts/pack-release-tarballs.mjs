#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(repoRoot, process.argv[2] ?? ".release");
const packageDirs = ["packages/sdk", "apps/cli"];

function readManifest(packageDir) {
  const path = resolve(repoRoot, packageDir, "package.json");
  return { path, json: JSON.parse(readFileSync(path, "utf8")) };
}

function workspaceDependencyVersion(range, dependencyName, workspaceVersions) {
  if (!range.startsWith("workspace:")) return range;

  const version = workspaceVersions.get(dependencyName);
  if (!version) {
    throw new Error(`No workspace package version found for ${dependencyName}`);
  }

  const workspaceRange = range.slice("workspace:".length);
  if (workspaceRange === "*" || workspaceRange === "") return version;
  if (workspaceRange === "~" || workspaceRange === "^")
    return `${workspaceRange}${version}`;
  return workspaceRange;
}

function rewriteWorkspaceDependencies(manifest, workspaceVersions) {
  const rewritten = structuredClone(manifest);
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const dependencies = rewritten[field];
    if (!dependencies) continue;

    for (const [name, range] of Object.entries(dependencies)) {
      if (typeof range === "string") {
        dependencies[name] = workspaceDependencyVersion(
          range,
          name,
          workspaceVersions,
        );
      }
    }
  }
  return rewritten;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit ${result.status}`,
    );
  }
}

const manifests = packageDirs.map(readManifest);
const workspaceVersions = new Map(
  manifests.map(({ json }) => [json.name, json.version]),
);

mkdirSync(destination, { recursive: true });

for (const { path, json } of manifests) {
  const rewritten = rewriteWorkspaceDependencies(json, workspaceVersions);
  const original = readFileSync(path, "utf8");

  try {
    writeFileSync(path, `${JSON.stringify(rewritten, null, 2)}\n`);
    const packageDir = dirname(path);
    run("bun", [
      `--cwd=${packageDir}`,
      "pm",
      "pack",
      "--destination",
      destination,
    ]);
  } finally {
    writeFileSync(path, original);
  }
}
