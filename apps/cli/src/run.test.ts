import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
      expect(result.stdout).toContain(`exponential ${group}`);
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
