import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readConfig } from "./config.js";
import { runCli } from "./run.js";

type CapturedRequest = {
  url: string;
  method: string;
  headers: Headers;
};

const commandGroups = [
  "login",
  "issues",
  "workspaces",
  "teams",
  "tokens",
  "projects",
  "project-statuses",
  "project-templates",
  "cycles",
  "comments",
  "issue-templates",
  "labels",
  "emojis",
  "documents",
  "integrations",
  "account",
  "notifications",
  "favorites",
];

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function env(overrides: NodeJS.ProcessEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), "exponential-cli-"));
  tempDirs.push(dir);
  return {
    EXPONENTIAL_CONFIG_HOME: dir,
    EXPONENTIAL_TOKEN: "pat_test",
    EXPONENTIAL_API_URL: "https://api.example/v1",
    ...overrides,
  } as NodeJS.ProcessEnv;
}

async function execute(input: {
  argv: string[];
  env?: NodeJS.ProcessEnv;
  isStdoutTTY?: boolean;
  fetch?: typeof fetch;
  openUrl?: (url: string) => Promise<boolean> | boolean;
  sleepMs?: (ms: number) => Promise<void>;
}) {
  let stdout = "";
  let stderr = "";
  const requests: CapturedRequest[] = [];
  const mockFetch: typeof fetch = async (requestInput, init) => {
    const request =
      requestInput instanceof Request
        ? requestInput
        : new Request(requestInput, init);
    requests.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
    });
    return responseFor(request);
  };
  const code = await runCli({
    argv: input.argv,
    env: input.env ?? env(),
    isStdoutTTY: input.isStdoutTTY ?? false,
    fetch: input.fetch ?? mockFetch,
    openUrl: input.openUrl,
    sleepMs: input.sleepMs,
    stdout: {
      write: (chunk) => {
        stdout += chunk;
      },
    },
    stderr: {
      write: (chunk) => {
        stderr += chunk;
      },
    },
  });
  return { code, stdout, stderr, requests };
}

describe("cli command runner", () => {
  it("prints help without a token and preserves the command inventory", async () => {
    const result = await execute({
      argv: ["--help"],
      env: env({ EXPONENTIAL_TOKEN: undefined }),
    });

    expect(result.code).toBe(0);
    for (const group of commandGroups) {
      expect(result.stdout).toContain(`expn ${group}`);
    }
  });

  it("keeps legacy plural issue commands JSON by default on a TTY", async () => {
    const result = await execute({
      argv: ["issues", "list"],
      isStdoutTTY: true,
    });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      issues: [{ identifier: "EXP-1", title: "Fix headless output" }],
    });
  });

  it("renders singular issue aliases as human output only on a TTY", async () => {
    const tty = await execute({
      argv: ["issue", "ls"],
      isStdoutTTY: true,
    });
    const piped = await execute({
      argv: ["issue", "ls"],
      isStdoutTTY: false,
    });
    const forcedJson = await execute({
      argv: ["issue", "ls", "--json"],
      isStdoutTTY: true,
    });

    expect(tty.stdout).toContain("ID");
    expect(tty.stdout).toContain("EXP-1");
    expect(JSON.parse(piped.stdout)).toMatchObject({
      issues: [{ identifier: "EXP-1" }],
    });
    expect(JSON.parse(forcedJson.stdout)).toMatchObject({
      issues: [{ identifier: "EXP-1" }],
    });
  });

  it("redacts config token output", async () => {
    const testEnv = env({ EXPONENTIAL_TOKEN: undefined });
    await execute({
      argv: [
        "config",
        "set",
        "--token",
        "pat_supersecret",
        "--api-url",
        "https://self.example/v1",
      ],
      env: testEnv,
    });

    const result = await execute({
      argv: ["config", "get"],
      env: testEnv,
    });

    expect(result.stdout).toContain("pat_...cret");
    expect(result.stdout).not.toContain("pat_supersecret");
  });

  it("runs device login, opens verification URL, and stores returned CLI token", async () => {
    const testEnv = env({ EXPONENTIAL_TOKEN: undefined });
    const opened: string[] = [];
    const result = await execute({
      argv: ["login"],
      env: testEnv,
      openUrl: (url) => {
        opened.push(url);
        return true;
      },
      sleepMs: async () => {},
      fetch: async (requestInput, init) => {
        const request =
          requestInput instanceof Request
            ? requestInput
            : new Request(requestInput, init);
        const url = new URL(request.url);
        if (url.pathname === "/v1/auth/device/code") {
          return jsonResponse({
            device_code: "device-secret",
            user_code: "123456",
            verification_uri:
              "https://app.example/auth/device?user_code=123456",
            interval: 1,
            expires_in: 60,
          });
        }
        if (url.pathname === "/v1/auth/device/token") {
          expect(await request.json()).toEqual({
            device_code: "device-secret",
          });
          return jsonResponse({
            access_token: "pat_device_secret",
            token_type: "Bearer",
            scope: "cli",
          });
        }
        return jsonResponse({ error: "not_found" }, 404);
      },
    });

    expect(result.code).toBe(0);
    expect(opened).toEqual([
      "https://app.example/auth/device?user_code=123456",
    ]);
    expect(result.stdout).toContain("123456");
    expect(result.stdout).not.toContain("pat_device_secret");
    expect(readConfig(testEnv)).toMatchObject({
      token: "pat_device_secret",
      baseUrl: "https://api.example/v1",
    });
  });

  it("reports browser denial without writing a token", async () => {
    const testEnv = env({ EXPONENTIAL_TOKEN: undefined });
    const result = await execute({
      argv: ["login"],
      env: testEnv,
      openUrl: () => false,
      sleepMs: async () => {},
      fetch: async (requestInput, init) => {
        const request =
          requestInput instanceof Request
            ? requestInput
            : new Request(requestInput, init);
        const url = new URL(request.url);
        if (url.pathname === "/v1/auth/device/code") {
          return jsonResponse({
            device_code: "device-secret",
            user_code: "123456",
            verification_uri:
              "https://app.example/auth/device?user_code=123456",
            interval: 1,
            expires_in: 60,
          });
        }
        return jsonResponse({ error: "access_denied" }, 403);
      },
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("CLI login was denied");
    expect(readConfig(testEnv).token).toBeUndefined();
  });

  it("runs doctor without leaking token values", async () => {
    const result = await execute({
      argv: ["doctor", "--json"],
      env: env({ EXPONENTIAL_TOKEN: "pat_doctor_secret" }),
    });

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("pat_doctor_secret");
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
  });

  it("reports missing token through doctor JSON instead of the auth preflight", async () => {
    const result = await execute({
      argv: ["doctor", "--json"],
      env: env({ EXPONENTIAL_TOKEN: undefined }),
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: "token",
          status: "fail",
          detail: "missing EXPONENTIAL_TOKEN or stored PAT",
        }),
      ]),
    });
  });

  it("prints version with --version and exits 0", async () => {
    const result = await execute({
      argv: ["--version"],
      env: env({ EXPONENTIAL_TOKEN: undefined, EXPN_VERSION: "1.2.3" }),
    });

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("1.2.3");
    expect(result.stderr).toBe("");
  });

  it("prints version with version subcommand and exits 0", async () => {
    const result = await execute({
      argv: ["version"],
      env: env({ EXPONENTIAL_TOKEN: undefined, EXPN_VERSION: "0.1.0" }),
    });

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("0.1.0");
    expect(result.stderr).toBe("");
  });

  it("--version does not require a token", async () => {
    const result = await execute({
      argv: ["--version"],
      env: env({ EXPONENTIAL_TOKEN: undefined }),
    });

    expect(result.code).toBe(0);
    // Should output a semver-like string (x.y.z)
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

function responseFor(request: Request) {
  const url = new URL(request.url);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  if (url.pathname === "/healthz" || url.pathname === "/api/healthz") {
    return json({ ok: true });
  }

  if (url.pathname === "/v1/issues") {
    return json({
      issues: [
        {
          id: "issue-1",
          identifier: "EXP-1",
          title: "Fix headless output",
          priority: "high",
          state: "In Progress",
        },
      ],
    });
  }

  if (url.pathname === "/v1/account/profile") {
    return json({
      profile: { id: "user-1", name: "Ada", email: "ada@example.com" },
      workspaceAccess: { workspaceId: "workspace-1", role: "admin" },
    });
  }

  return json({ title: "Not found" }, 404);
}
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
