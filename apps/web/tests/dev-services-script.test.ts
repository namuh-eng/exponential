import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("dev services bootstrap script", () => {
  it("fails clearly with host database fallback instructions when Docker is unavailable", () => {
    const binDir = mkdtempSync(path.join(tmpdir(), "whetline-docker-"));
    try {
      const dockerPath = path.join(binDir, "docker");
      writeFileSync(
        dockerPath,
        "#!/bin/sh\necho 'permission denied while trying to connect to the Docker daemon socket' >&2\nexit 1\n",
        { mode: 0o755 },
      );

      const result = spawnSync(process.execPath, ["scripts/dev-services.mjs"], {
        cwd: process.cwd(),
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
        encoding: "utf8",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Docker is unavailable");
      expect(result.stderr).toContain("DATABASE_URL/REDIS_URL");
      expect(result.stderr).toContain("go run ./apps/api/cmd/migrate");
      expect(result.stderr).toContain("must fail before binding a listener");
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });
});
