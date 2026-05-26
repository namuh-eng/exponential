import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertPatToken,
  configPath,
  readConfig,
  resolveBaseUrl,
  resolveToken,
  writeConfig,
} from "./config.js";

let tempDirs: string[] = [];

function envWithConfigHome() {
  const dir = mkdtempSync(join(tmpdir(), "exponential-cli-"));
  tempDirs.push(dir);
  return { EXPONENTIAL_CONFIG_HOME: dir } as NodeJS.ProcessEnv;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("cli config", () => {
  it("stores login PAT config with user-only permissions", () => {
    const env = envWithConfigHome();

    writeConfig(
      { token: "pat_secret", baseUrl: "https://api.example/v1" },
      env,
    );

    expect(readConfig(env)).toEqual({
      token: "pat_secret",
      baseUrl: "https://api.example/v1",
    });
    expect(readFileSync(configPath(env), "utf8")).toContain("pat_secret");
  });

  it("prefers environment token and API URL over stored login config", () => {
    const env = {
      ...envWithConfigHome(),
      EXPONENTIAL_TOKEN: "pat_env",
      EXPONENTIAL_API_URL: "https://env.example/v1",
    } as NodeJS.ProcessEnv;
    writeConfig(
      { token: "pat_stored", baseUrl: "https://stored.example/v1" },
      env,
    );

    expect(resolveToken(env)).toBe("pat_env");
    expect(resolveBaseUrl(env)).toBe("https://env.example/v1");
  });

  it("rejects non-PAT login tokens", () => {
    expect(() => assertPatToken("lin_api_legacy")).toThrow(
      "--token must be a personal access token starting with pat_",
    );
    expect(assertPatToken("pat_valid")).toBe("pat_valid");
  });
});
