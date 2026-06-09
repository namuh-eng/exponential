import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { createExponentialClient, syncWebSocketUrl } from "@expn/sdk";
import type { ExponentialClient } from "@expn/sdk";
import { parseIssueBody, readFlag, readOption, requireOption } from "./args.js";
import {
  assertPatToken,
  configPath,
  readConfig,
  resolveBaseUrl,
  resolveToken,
  writeConfig,
} from "./config.js";
import { formatHumanResult, resolveOutputMode } from "./output.js";

export type CliWritable = {
  write: (chunk: string) => void;
};

export type RunCliOptions = {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  stdout?: CliWritable;
  stderr?: CliWritable;
  isStdoutTTY?: boolean;
  fetch?: typeof fetch;
};

type CliState = {
  rawArgs: string[];
  resource: string | undefined;
  action: string;
  args: string[];
  baseUrl: string;
  apiToken: string;
  client: ExponentialClient;
  env: NodeJS.ProcessEnv;
  stdout: CliWritable;
  stderr: CliWritable;
  isStdoutTTY: boolean;
  fetch?: typeof fetch;
};

class CliExit extends Error {
  constructor(readonly code: number) {
    super(`CLI exited with code ${code}`);
  }
}

let state: CliState;
let rawArgs: string[] = [];
let resource: string | undefined;
let action = "list";
let args: string[] = [];
let baseUrl = "http://localhost:7016/v1";
let apiToken = "";
let client: ExponentialClient;

export async function runCli(options: RunCliOptions = {}) {
  const argv = normalizeGlobalArgs(options.argv ?? process.argv.slice(2));
  const [nextResource, nextAction = "list", ...nextArgs] = argv;
  const env = options.env ?? process.env;
  const nextBaseUrl = resolveBaseUrl(env);
  const token = nextResource === "login" ? undefined : resolveToken(env);
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const ttyAwareStdout = stdout as CliWritable & { isTTY?: boolean };
  const isStdoutTTY = options.isStdoutTTY ?? Boolean(ttyAwareStdout.isTTY);
  const nextClient = createExponentialClient({
    token: token ?? "",
    baseUrl: nextBaseUrl,
    fetch: options.fetch,
  });

  state = {
    rawArgs: argv,
    resource: nextResource,
    action: nextAction,
    args: nextArgs,
    baseUrl: nextBaseUrl,
    apiToken: token ?? "",
    client: nextClient,
    env,
    stdout,
    stderr,
    isStdoutTTY,
    fetch: options.fetch,
  };
  rawArgs = state.rawArgs;
  resource = state.resource;
  action = state.action;
  args = state.args;
  baseUrl = state.baseUrl;
  apiToken = state.apiToken;
  client = state.client;

  try {
    if (!resource || readFlag(rawArgs, "help") || resource === "help") {
      usage(0);
    }

    if (
      resource !== "login" &&
      resource !== "config" &&
      resource !== "doctor" &&
      !token
    ) {
      writeStderr(
        "EXPONENTIAL_TOKEN is required or run `expn login --token pat_...`\n",
      );
      return 1;
    }

    await main();
    return 0;
  } catch (error) {
    if (error instanceof CliExit) {
      return error.code;
    }
    writeStderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

type MinimalWebSocket = {
  addEventListener: (
    type: "open" | "message" | "error" | "close",
    listener: (event: {
      data?: string | ArrayBuffer | Uint8Array | Blob;
    }) => void,
  ) => void;
  close: () => void;
};

type MinimalWebSocketConstructor = new (url: string) => MinimalWebSocket;

async function streamSyncWatch(input: { version: number; once: boolean }) {
  const WebSocketCtor = (
    globalThis as { WebSocket?: MinimalWebSocketConstructor }
  ).WebSocket;
  if (!WebSocketCtor) {
    throw new Error("WebSocket runtime unavailable; use Node 22+ or Bun.");
  }

  const socket = new WebSocketCtor(
    syncWebSocketUrl({ baseUrl, token: apiToken, version: input.version }),
  );

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("message", async (event) => {
      try {
        const data = event.data;
        if (typeof data === "string") {
          writeStdout(`${data}\n`);
        } else if (data instanceof ArrayBuffer) {
          writeStdout(`${Buffer.from(data).toString("utf8")}\n`);
        } else if (data instanceof Uint8Array) {
          writeStdout(`${Buffer.from(data).toString("utf8")}\n`);
        } else if (typeof Blob !== "undefined" && data instanceof Blob) {
          writeStdout(`${await data.text()}\n`);
        }
        if (input.once) {
          socket.close();
          resolve();
        }
      } catch (error) {
        reject(error);
      }
    });
    socket.addEventListener("error", () =>
      reject(new Error("Sync watch failed")),
    );
    socket.addEventListener("close", () => resolve());
  });
}

async function main() {
  if (resource === "login") {
    loginCommand();
    return;
  }

  if (resource === "config") {
    configCommand();
    return;
  }

  if (resource === "doctor") {
    await doctorCommand();
    return;
  }

  if (resource === "whoami") {
    const { data, error, response } = await client.GET("/account/profile");
    printResult(data, error, response.status, "whoami", true);
    return;
  }

  if (resource === "issue") {
    await issueAliasCommand();
    return;
  }

  if (resource === "project") {
    await projectAliasCommand();
    return;
  }

  if (resource === "cycle") {
    await cycleAliasCommand();
    return;
  }

  if (resource === "workspaces") {
    await workspaceCommand();
    return;
  }

  if (resource === "tokens") {
    await tokenCommand();
    return;
  }

  if (resource === "teams") {
    await teamCommand();
    return;
  }

  if (resource === "projects") {
    await projectCommand();
    return;
  }

  if (resource === "project-statuses") {
    await projectStatusCommand();
    return;
  }

  if (resource === "project-templates") {
    await projectTemplateCommand();
    return;
  }

  if (resource === "cycles") {
    await cycleCommand();
    return;
  }

  if (resource === "comments") {
    await commentCommand();
    return;
  }

  if (resource === "issue-templates") {
    await issueTemplateCommand();
    return;
  }

  if (resource === "labels") {
    await labelCommand();
    return;
  }

  if (resource === "emojis") {
    await emojiCommand();
    return;
  }

  if (resource === "documents") {
    await documentCommand();
    return;
  }

  if (resource === "integrations") {
    await integrationCommand();
    return;
  }

  if (resource === "account") {
    await accountCommand();
    return;
  }

  if (resource === "notifications") {
    await notificationCommand();
    return;
  }

  if (resource === "favorites") {
    await favoriteCommand();
    return;
  }

  if (resource !== "issues") {
    usage();
  }

  if (action === "list") {
    const { data, error, response } = await client.GET("/issues", {
      params: {
        query: {
          cursor: readOption(args, "cursor"),
          limit: readOption(args, "limit")
            ? Number(readOption(args, "limit"))
            : undefined,
          team_id: readOption(args, "team-id"),
        },
      },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "search") {
    const { data, error, response } = await client.GET("/issues/search", {
      params: {
        query: {
          q: requireOption(args, "query"),
          workspaceId: readOption(args, "workspace-id"),
        },
      },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "get") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.GET("/issues/{id}", {
      params: { path: { id } },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "create") {
    const body = parseIssueBody(args);
    if (!body.title || !body.team_id) {
      throw new Error("--title and --team-id are required");
    }
    const { data, error, response } = await client.POST("/issues", {
      headers: { "Idempotency-Key": mutationIdempotencyKey() },
      body: { ...body, title: body.title, team_id: body.team_id },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "update") {
    const id = requireOption(args, "id");
    const body = parseIssueBody(args);
    const { data, error, response } = await client.PATCH("/issues/{id}", {
      params: { path: { id } },
      headers: { "Idempotency-Key": mutationIdempotencyKey() },
      body: Object.fromEntries(
        Object.entries(body).filter(
          ([, value]) => value !== undefined && value !== null,
        ),
      ),
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "delete") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.DELETE("/issues/{id}", {
      params: { path: { id } },
      headers: { "Idempotency-Key": mutationIdempotencyKey() },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "subscription") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.GET(
      "/issues/{id}/subscription",
      { params: { path: { id } } },
    );
    printResult(data, error, response.status);
    return;
  }

  if (action === "subscribe") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.POST(
      "/issues/{id}/subscription",
      { params: { path: { id } } },
    );
    printResult(data, error, response.status);
    return;
  }

  if (action === "unsubscribe") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.DELETE(
      "/issues/{id}/subscription",
      { params: { path: { id } } },
    );
    printResult(data, error, response.status);
    return;
  }

  if (action === "watch") {
    await streamSyncWatch({
      version: readOption(args, "version")
        ? Number(readOption(args, "version"))
        : 0,
      once: readOption(args, "once") === "true" || args.includes("--once"),
    });
    return;
  }

  usage();
}

function loginCommand() {
  const loginArgs = rawArgs.slice(1);
  const loginToken = assertPatToken(requireOption(loginArgs, "token"));
  const loginBaseUrl = readOption(loginArgs, "api-url") ?? baseUrl;
  writeConfig({ token: loginToken, baseUrl: loginBaseUrl }, state.env);
  printJson({ ok: true, baseUrl: loginBaseUrl });
}

function configCommand() {
  if (action === "get") {
    const stored = readConfig(state.env);
    const key = args.find((arg) => !arg.startsWith("--"));
    const redacted = redactConfig(stored);
    if (key) {
      printJson({
        [key]: key === "token" ? redactSecret(stored.token) : redacted[key],
      });
      return;
    }
    printJson({
      configPath: configPath(state.env),
      stored: redacted,
      effective: redactConfig({
        token: resolveToken(state.env),
        baseUrl: resolveBaseUrl(state.env),
      }),
    });
    return;
  }

  if (action === "set") {
    const current = readConfig(state.env);
    const token = readOption(args, "token");
    const apiUrl = readOption(args, "api-url") ?? readOption(args, "base-url");
    if (!token && !apiUrl) {
      throw new Error("--token or --api-url is required");
    }
    if (token) {
      assertPatToken(token);
    }
    const next = {
      ...current,
      token: token ?? current.token,
      baseUrl: apiUrl ?? current.baseUrl,
    };
    writeConfig(next, state.env);
    printJson({
      ok: true,
      configPath: configPath(state.env),
      stored: redactConfig(next),
    });
    return;
  }

  usage();
}

async function doctorCommand() {
  const checks: {
    name: string;
    status: "pass" | "warn" | "fail";
    detail: string;
  }[] = [];

  try {
    const parsed = new URL(baseUrl);
    checks.push({ name: "api-url", status: "pass", detail: parsed.toString() });
  } catch {
    checks.push({ name: "api-url", status: "fail", detail: baseUrl });
    printDoctor(checks);
    return;
  }

  const token = resolveToken(state.env);
  checks.push({
    name: "token",
    status: token ? "pass" : "fail",
    detail: token ? "configured" : "missing EXPONENTIAL_TOKEN or stored PAT",
  });

  checks.push(configFileCheck());
  checks.push(await healthCheck());

  if (token) {
    const { error, response } = await client.GET("/account/profile");
    checks.push({
      name: "auth",
      status: error ? "fail" : "pass",
      detail: error
        ? `HTTP ${response.status}: ${problemTitle(error)}`
        : "account profile read succeeded",
    });
  }

  printDoctor(checks);
}

async function issueAliasCommand() {
  const normalizedAction =
    action === "ls" ? "list" : action === "view" ? "get" : action;

  if (normalizedAction === "list") {
    const { data, error, response } = await client.GET("/issues", {
      params: {
        query: {
          cursor: readOption(args, "cursor"),
          limit: readOption(args, "limit")
            ? Number(readOption(args, "limit"))
            : undefined,
          team_id: readOption(args, "team-id"),
        },
      },
    });
    printResult(data, error, response.status, "issue-list", true);
    return;
  }

  if (normalizedAction === "search") {
    const { data, error, response } = await client.GET("/issues/search", {
      params: {
        query: {
          q: requireOption(args, "query"),
          workspaceId: readOption(args, "workspace-id"),
        },
      },
    });
    printResult(data, error, response.status, "issue-list", true);
    return;
  }

  if (normalizedAction === "get") {
    const id = readOption(args, "id") ?? firstPositional(args);
    if (!id) {
      throw new Error("--id or positional id is required");
    }
    const { data, error, response } = await client.GET("/issues/{id}", {
      params: { path: { id } },
    });
    printResult(data, error, response.status, "issue-detail", true);
    return;
  }

  if (normalizedAction === "create") {
    const body = parseIssueBody(args);
    if (!body.title || !body.team_id) {
      throw new Error("--title and --team-id are required");
    }
    const { data, error, response } = await client.POST("/issues", {
      headers: { "Idempotency-Key": mutationIdempotencyKey() },
      body: { ...body, title: body.title, team_id: body.team_id },
    });
    printResult(data, error, response.status, "issue-detail", true);
    return;
  }

  if (normalizedAction === "update") {
    const id = readOption(args, "id") ?? firstPositional(args);
    if (!id) {
      throw new Error("--id or positional id is required");
    }
    const body = parseIssueBody(args);
    const { data, error, response } = await client.PATCH("/issues/{id}", {
      params: { path: { id } },
      headers: { "Idempotency-Key": mutationIdempotencyKey() },
      body: Object.fromEntries(
        Object.entries(body).filter(
          ([, value]) => value !== undefined && value !== null,
        ),
      ),
    });
    printResult(data, error, response.status, "issue-detail", true);
    return;
  }

  usage();
}

async function projectAliasCommand() {
  const normalizedAction =
    action === "ls" ? "list" : action === "view" ? "get" : action;

  if (normalizedAction === "list") {
    const { data, error, response } = await client.GET("/projects");
    printResult(data, error, response.status, "project-list", true);
    return;
  }

  if (normalizedAction === "get") {
    const slug = readOption(args, "slug") ?? firstPositional(args);
    if (!slug) {
      throw new Error("--slug or positional slug is required");
    }
    const { data, error, response } = await client.GET("/projects/{slug}", {
      params: { path: { slug } },
    });
    printResult(data, error, response.status, "project-detail", true);
    return;
  }

  usage();
}

async function cycleAliasCommand() {
  if (action !== "current") {
    usage();
  }

  const key = readOption(args, "team-key") ?? readOption(args, "team");
  if (!key) {
    throw new Error("--team-key is required");
  }

  const { data, error, response } = await client.GET("/teams/{key}/cycles", {
    params: { path: { key } },
  });
  if (error) {
    printResult(data, error, response.status, "cycle-current", true);
    return;
  }

  printResult(
    { cycle: findCurrentCycle(data) },
    error,
    response.status,
    "cycle-current",
    true,
  );
}

async function workspaceCommand() {
  if (action === "list") {
    const { data, error, response } = await client.GET("/workspaces");
    printResult(data, error, response.status);
    return;
  }

  if (action === "create") {
    const name = requireOption(args, "name");
    const urlSlug = requireOption(args, "url-slug");
    const { data, error, response } = await client.POST("/workspaces", {
      body: { name, urlSlug },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "current") {
    const { data, error, response } = await client.GET("/workspaces/current");
    printResult(data, error, response.status);
    return;
  }

  if (action === "members") {
    const { data, error, response } = await client.GET("/workspaces/members");
    printResult(data, error, response.status);
    return;
  }

  if (action === "invite") {
    const email = requireOption(args, "email");
    const role = readOption(args, "role") ?? "member";
    if (role !== "admin" && role !== "member" && role !== "guest") {
      throw new Error("--role must be admin, member, or guest");
    }
    const { data, error, response } = await client.POST("/workspaces/invite", {
      body: { invites: [{ email, role }] },
    });
    printResult(data, error, response.status);
    return;
  }

  usage();
}

async function teamCommand() {
  if (action === "list") {
    const { data, error, response } = await client.GET("/teams");
    printResult(data, error, response.status);
    return;
  }

  if (action === "create") {
    const { data, error, response } = await client.POST("/teams", {
      body: {
        name: requireOption(args, "name"),
        key: readOption(args, "key"),
        icon: readOption(args, "icon"),
        isPrivate: readOption(args, "private") === "true",
      },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "create-issue-options") {
    const key = requireOption(args, "team-key");
    const { data, error, response } = await client.GET(
      "/teams/{key}/create-issue-options",
      { params: { path: { key } } },
    );
    printResult(data, error, response.status);
    return;
  }

  usage();
}

async function notificationCommand() {
  if (action === "list") {
    const { data, error, response } = await client.GET("/notifications");
    printResult(data, error, response.status);
    return;
  }

  if (action === "mark-read") {
    const { data, error, response } = await client.PATCH(
      "/notifications/bulk-read",
    );
    printResult(data, error, response.status);
    return;
  }

  if (action === "read") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.PATCH(
      "/notifications/{id}/read",
      { params: { path: { id } } },
    );
    printResult(data, error, response.status);
    return;
  }

  if (action === "unread") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.PATCH(
      "/notifications/{id}/unread",
      { params: { path: { id } } },
    );
    printResult(data, error, response.status);
    return;
  }

  if (action === "snooze") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.PATCH(
      "/notifications/{id}/snooze",
      {
        params: { path: { id } },
        body: { snoozedUntilAt: readOption(args, "until") ?? null },
      },
    );
    printResult(data, error, response.status);
    return;
  }

  usage();
}

async function favoriteCommand() {
  if (action === "list") {
    const { data, error, response } = await client.GET("/sidebar/favorites");
    printResult(data, error, response.status);
    return;
  }

  if (action === "add") {
    const { data, error, response } = await client.POST("/sidebar/favorites", {
      body: {
        objectType: requireOption(args, "object-type") as never,
        objectId: requireOption(args, "object-id"),
      },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "reorder") {
    const orderedIds = requireOption(args, "ordered-ids")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const { data, error, response } = await client.PATCH("/sidebar/favorites", {
      body: { orderedIds },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "remove") {
    const { data, error, response } = await client.DELETE(
      "/sidebar/favorites",
      {
        params: {
          query: {
            objectType: requireOption(args, "object-type") as never,
            objectId: requireOption(args, "object-id"),
          },
        },
      },
    );
    printResult(data, error, response.status);
    return;
  }

  usage();
}

async function accountCommand() {
  if (action === "profile") {
    const { data, error, response } = await client.GET("/account/profile");
    printResult(data, error, response.status);
    return;
  }

  if (action === "preferences") {
    const { data, error, response } = await client.GET("/account/preferences");
    printResult(data, error, response.status);
    return;
  }

  usage();
}

async function emojiCommand() {
  if (action === "list") {
    const { data, error, response } = await client.GET("/custom-emojis");
    printResult(data, error, response.status);
    return;
  }

  if (action === "create") {
    const name = requireOption(args, "name");
    const imageUrl = requireOption(args, "image-url");
    const { data, error, response } = await client.POST("/custom-emojis", {
      body: { name, imageUrl },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "delete") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.DELETE(
      "/custom-emojis/{id}",
      { params: { path: { id } } },
    );
    printResult(data, error, response.status);
    return;
  }

  usage();
}

async function documentCommand() {
  if (action === "settings") {
    const { data, error, response } = await client.GET("/document-settings");
    printResult(data, error, response.status);
    return;
  }

  if (action === "create-folder") {
    const { data, error, response } = await client.POST("/document-folders", {
      body: {
        name: requireOption(args, "name"),
        description: readOption(args, "description"),
        color: readOption(args, "color") as never,
      },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "update-folder") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.PATCH(
      "/document-folders/{id}",
      {
        params: { path: { id } },
        body: {
          name: readOption(args, "name"),
          description: readOption(args, "description"),
          color: readOption(args, "color") as never,
        },
      },
    );
    printResult(data, error, response.status);
    return;
  }

  if (action === "delete-folder") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.DELETE(
      "/document-folders/{id}",
      { params: { path: { id } } },
    );
    printResult(data, error, response.status);
    return;
  }

  if (action === "create-template") {
    const { data, error, response } = await client.POST("/document-templates", {
      body: {
        name: requireOption(args, "name"),
        description: readOption(args, "description"),
        content: requireOption(args, "content"),
      },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "update-template") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.PATCH(
      "/document-templates/{id}",
      {
        params: { path: { id } },
        body: {
          name: readOption(args, "name"),
          description: readOption(args, "description"),
          content: readOption(args, "content"),
        },
      },
    );
    printResult(data, error, response.status);
    return;
  }

  if (action === "delete-template") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.DELETE(
      "/document-templates/{id}",
      { params: { path: { id } } },
    );
    printResult(data, error, response.status);
    return;
  }

  usage();
}

async function integrationCommand() {
  if (action === "list") {
    const { data, error, response } = await client.GET("/integrations");
    printResult(data, error, response.status);
    return;
  }

  if (action === "disconnect") {
    const { data, error, response } = await client.DELETE("/integrations", {
      params: { query: { provider: requireOption(args, "provider") } },
    });
    printResult(data, error, response.status);
    return;
  }

  usage();
}

async function labelCommand() {
  if (action === "list") {
    const { data, error, response } = await client.GET("/labels", {
      params: {
        query: {
          scope: readOption(args, "scope") as never,
          teamId: readOption(args, "team-id"),
        },
      },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "create") {
    const name = requireOption(args, "name");
    const { data, error, response } = await client.POST("/labels", {
      body: {
        name,
        color: readOption(args, "color"),
        description: readOption(args, "description"),
        teamId: readOption(args, "team-id"),
      },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "update") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.PATCH("/labels/{id}", {
      params: { path: { id } },
      body: {
        name: readOption(args, "name"),
        color: readOption(args, "color"),
        description: readOption(args, "description"),
      },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "delete") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.DELETE("/labels/{id}", {
      params: { path: { id } },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "bulk") {
    const labelIds = requireOption(args, "label-ids")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const { data, error, response } = await client.POST("/labels/bulk", {
      body: {
        action: requireOption(args, "action") as never,
        labelIds,
        destinationLabelId: readOption(args, "destination-label-id"),
        teamId: readOption(args, "team-id"),
      },
    });
    printResult(data, error, response.status);
    return;
  }

  usage();
}

async function commentCommand() {
  if (action === "create") {
    const issueId = requireOption(args, "issue-id");
    const body = requireOption(args, "body");
    const { data, error, response } = await client.POST(
      "/issues/{id}/comments",
      { params: { path: { id: issueId } }, body: { body } },
    );
    printResult(data, error, response.status);
    return;
  }

  if (action === "update") {
    const id = requireOption(args, "id");
    const body = requireOption(args, "body");
    const { data, error, response } = await client.PATCH("/comments/{id}", {
      params: { path: { id } },
      body: { body },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "delete") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.DELETE("/comments/{id}", {
      params: { path: { id } },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "react") {
    const id = requireOption(args, "id");
    const emoji = requireOption(args, "emoji");
    const { data, error, response } = await client.POST(
      "/comments/{id}/reactions",
      { params: { path: { id } }, body: { emoji } },
    );
    printResult(data, error, response.status);
    return;
  }

  usage();
}

async function issueTemplateCommand() {
  if (action === "list") {
    const { data, error, response } = await client.GET("/issue-templates", {
      params: { query: { teamKey: readOption(args, "team-key") } },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "create") {
    const { data, error, response } = await client.POST("/issue-templates", {
      body: {
        name: readOption(args, "name"),
        description: readOption(args, "description"),
        settings: readJSONOption(args, "settings-json"),
        duplicateFromId: readOption(args, "duplicate-from-id"),
      },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "update") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.PATCH(
      "/issue-templates/{id}",
      {
        params: { path: { id } },
        body: {
          name: readOption(args, "name"),
          description: readOption(args, "description"),
          settings: readJSONOption(args, "settings-json"),
        },
      },
    );
    printResult(data, error, response.status);
    return;
  }

  if (action === "archive") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.PATCH(
      "/issue-templates/{id}",
      { params: { path: { id } }, body: { archived: true } },
    );
    printResult(data, error, response.status);
    return;
  }

  if (action === "delete") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.DELETE(
      "/issue-templates/{id}",
      { params: { path: { id } } },
    );
    printResult(data, error, response.status);
    return;
  }

  usage();
}

async function cycleCommand() {
  const key = requireOption(args, "team-key");
  if (action === "list") {
    const { data, error, response } = await client.GET("/teams/{key}/cycles", {
      params: { path: { key } },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "create") {
    const { data, error, response } = await client.POST("/teams/{key}/cycles", {
      params: { path: { key } },
      body: {
        name: readOption(args, "name"),
        start_date: requireOption(args, "start-date"),
        end_date: requireOption(args, "end-date"),
      },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "update") {
    const cycle_id = requireOption(args, "id");
    const { data, error, response } = await client.PATCH(
      "/teams/{key}/cycles/{cycle_id}",
      {
        params: { path: { key, cycle_id } },
        body: {
          name: readOption(args, "name"),
          start_date: readOption(args, "start-date"),
          end_date: readOption(args, "end-date"),
        },
      },
    );
    printResult(data, error, response.status);
    return;
  }

  if (action === "delete") {
    const cycle_id = requireOption(args, "id");
    const { data, error, response } = await client.DELETE(
      "/teams/{key}/cycles/{cycle_id}",
      { params: { path: { key, cycle_id } } },
    );
    printResult(data, error, response.status);
    return;
  }

  usage();
}

async function projectCommand() {
  if (action === "list") {
    const { data, error, response } = await client.GET("/projects");
    printResult(data, error, response.status);
    return;
  }

  if (action === "get") {
    const slug = requireOption(args, "slug");
    const { data, error, response } = await client.GET("/projects/{slug}", {
      params: { path: { slug } },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "create") {
    const name = requireOption(args, "name");
    const teamKeys = readOption(args, "team-keys")
      ?.split(",")
      .map((key) => key.trim())
      .filter(Boolean);
    const { data, error, response } = await client.POST("/projects", {
      body: {
        name,
        slug: readOption(args, "slug"),
        description: readOption(args, "description"),
        status: readOption(args, "status") as never,
        priority: readOption(args, "priority") as never,
        team_keys: teamKeys,
      },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "update") {
    const slug = requireOption(args, "slug");
    const { data, error, response } = await client.PATCH("/projects/{slug}", {
      params: { path: { slug } },
      body: {
        name: readOption(args, "name"),
        slug: readOption(args, "new-slug"),
        description: readOption(args, "description"),
        status: readOption(args, "status") as never,
        priority: readOption(args, "priority") as never,
      },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "delete") {
    const slug = requireOption(args, "slug");
    const { data, error, response } = await client.DELETE("/projects/{slug}", {
      params: { path: { slug } },
    });
    printResult(data, error, response.status);
    return;
  }

  usage();
}

async function projectStatusCommand() {
  if (action === "list") {
    const { data, error, response } = await client.GET("/project-statuses");
    printResult(data, error, response.status);
    return;
  }

  if (action === "update") {
    const statuses = JSON.parse(requireOption(args, "statuses-json"));
    const { data, error, response } = await client.PATCH("/project-statuses", {
      body: { statuses },
    });
    printResult(data, error, response.status);
    return;
  }

  usage();
}

async function projectTemplateCommand() {
  if (action === "list") {
    const { data, error, response } = await client.GET("/project-templates");
    printResult(data, error, response.status);
    return;
  }

  if (action === "create") {
    const { data, error, response } = await client.POST("/project-templates", {
      body: {
        name: requireOption(args, "name"),
        description: readOption(args, "description"),
        settings: readJSONOption(args, "settings-json"),
      },
    });
    printResult(data, error, response.status);
    return;
  }

  if (action === "update") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.PATCH(
      "/project-templates/{id}",
      {
        params: { path: { id } },
        body: {
          name: requireOption(args, "name"),
          description: readOption(args, "description"),
          settings: readJSONOption(args, "settings-json"),
        },
      },
    );
    printResult(data, error, response.status);
    return;
  }

  if (action === "delete") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.DELETE(
      "/project-templates/{id}",
      { params: { path: { id } } },
    );
    printResult(data, error, response.status);
    return;
  }

  usage();
}

async function tokenCommand() {
  if (action === "list") {
    const { data, error, response } = await client.GET(
      "/personal-access-tokens",
    );
    printResult(data, error, response.status);
    return;
  }

  if (action === "create") {
    const name = requireOption(args, "name");
    const scopes = readOption(args, "scopes")
      ?.split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);
    const { data, error, response } = await client.POST(
      "/personal-access-tokens",
      { body: { name, scopes } },
    );
    printResult(data, error, response.status);
    return;
  }

  if (action === "revoke") {
    const id = requireOption(args, "id");
    const { data, error, response } = await client.DELETE(
      "/personal-access-tokens/{id}",
      { params: { path: { id } } },
    );
    printResult(data, error, response.status);
    return;
  }

  usage();
}

function printResult(
  data: unknown,
  error: unknown,
  status: number,
  humanKind?: string,
  defaultHuman = false,
) {
  if (error) {
    writeStderr(`${JSON.stringify({ status, error }, null, 2)}\n`);
    throw new CliExit(1);
  }
  const mode = resolveOutputMode({
    args: rawArgs,
    defaultHuman,
    isTTY: state.isStdoutTTY,
    env: state.env,
  });
  if (mode === "human" && humanKind) {
    writeStdout(`${formatHumanResult(humanKind, data)}\n`);
    return;
  }
  printJson(data);
}

function readJSONOption(args: string[], name: string) {
  const raw = readOption(args, name);
  return raw ? JSON.parse(raw) : undefined;
}

function usage(code = 1): never {
  const write = code === 0 ? writeStdout : writeStderr;
  write(`Usage:
  expn login --token pat_<token> [--api-url http://localhost:7016/v1]
  expn --help
  expn whoami [--json]
  expn doctor [--json]
  expn config get [token|baseUrl] [--json]
  expn config set [--token pat_<token>] [--api-url http://localhost:7016/v1]
  expn issue ls [--team-id <uuid>] [--cursor <cursor>] [--limit <n>]
  expn issue view <id-or-identifier>
  expn issue create --title <title> --team-id <uuid> [--idempotency-key <key>]
  expn issue update <id-or-identifier> [--title <title>] [--state-id <uuid>]
  expn project ls
  expn project view <slug>
  expn cycle current --team-key <key>
  expn issues list [--team-id <uuid>] [--cursor <cursor>] [--limit <n>]
  expn issues search --query <text> [--workspace-id <uuid>]
  expn issues get --id <id-or-identifier>
  expn issues create --title <title> --team-id <uuid> [--idempotency-key <key>]
  expn issues update --id <id-or-identifier> [--title <title>] [--state-id <uuid>]
  expn issues delete --id <id-or-identifier> [--idempotency-key <key>]
  expn issues subscription --id <id-or-identifier>
  expn issues subscribe --id <id-or-identifier>
  expn issues unsubscribe --id <id-or-identifier>
  expn issues watch [--version <n>]
  expn workspaces list
  expn workspaces create --name <name> --url-slug <slug>
  expn workspaces current
  expn workspaces members
  expn workspaces invite --email <email> [--role member|admin|guest]
  expn teams list
  expn teams create --name <name> [--key <key>] [--private true]
  expn teams create-issue-options --team-key <key>
  expn tokens list
  expn tokens create --name <name> [--scopes read,write]
  expn tokens revoke --id <uuid>
  expn projects list
  expn projects get --slug <slug>
  expn projects create --name <name> [--slug <slug>] [--team-keys ENG,DES]
  expn projects update --slug <slug> [--name <name>] [--new-slug <slug>]
  expn projects delete --slug <slug>
  expn project-statuses list
  expn project-statuses update --statuses-json '<json-array>'
  expn project-templates list
  expn project-templates create --name <name> [--description <text>] [--settings-json '<json>']
  expn project-templates update --id <uuid> --name <name> [--settings-json '<json>']
  expn project-templates delete --id <uuid>
  expn cycles list --team-key <key>
  expn cycles create --team-key <key> --start-date YYYY-MM-DD --end-date YYYY-MM-DD
  expn cycles update --team-key <key> --id <uuid> [--name <name>]
  expn cycles delete --team-key <key> --id <uuid>
  expn comments create --issue-id <id-or-identifier> --body <text>
  expn comments update --id <uuid> --body <text>
  expn comments delete --id <uuid>
  expn comments react --id <uuid> --emoji <emoji>
  expn issue-templates list [--team-key <key>]
  expn issue-templates create [--name <name>] [--description <text>] [--settings-json '<json>']
  expn issue-templates update --id <uuid> [--name <name>] [--settings-json '<json>']
  expn issue-templates archive --id <uuid>
  expn issue-templates delete --id <uuid>
  expn labels list [--scope workspace|team|all] [--team-id <uuid>]
  expn labels create --name <name> [--color #6b6f76] [--team-id <uuid>]
  expn labels update --id <uuid> [--name <name>] [--color #6b6f76]
  expn labels delete --id <uuid>
  expn labels bulk --action archive|unarchive|delete|convertToGroup|rescope|merge --label-ids <ids>
  expn emojis list
  expn emojis create --name <name> --image-url <url-or-data-url>
  expn emojis delete --id <id>
  expn documents settings
  expn documents create-folder --name <name> [--color gray|blue|green|yellow|orange|purple|pink]
  expn documents update-folder --id <id> [--name <name>] [--color gray]
  expn documents delete-folder --id <id>
  expn documents create-template --name <name> --content <markdown>
  expn documents update-template --id <id> [--name <name>] [--content <markdown>]
  expn documents delete-template --id <id>
  expn integrations list
  expn integrations disconnect --provider slack|github|zendesk
  expn account profile
  expn account preferences
  expn notifications list
  expn notifications mark-read
  expn notifications read --id <uuid>
  expn notifications unread --id <uuid>
  expn notifications snooze --id <uuid> [--until ISO_DATE]
  expn favorites list
  expn favorites add --object-type project|issue|view --object-id <id>
  expn favorites reorder --ordered-ids project:id,issue:id
  expn favorites remove --object-type project|issue|view --object-id <id>

Output:
  Legacy plural commands default to JSON.
  New singular aliases use human output only on a TTY.
  --json always forces JSON; --format json|table|detail is also supported.`);
  throw new CliExit(code);
}

function printJson(data: unknown) {
  writeStdout(`${JSON.stringify(data, null, 2)}\n`);
}

function writeStdout(text: string) {
  state.stdout.write(text);
}

function writeStderr(text: string) {
  state.stderr.write(text);
}

function mutationIdempotencyKey() {
  return readOption(args, "idempotency-key") ?? `cli-${randomUUID()}`;
}

function firstPositional(values: string[]) {
  const flagsWithValues = new Set([
    "api-url",
    "assignee-id",
    "base-url",
    "body",
    "color",
    "content",
    "cursor",
    "description",
    "due-date",
    "email",
    "estimate",
    "format",
    "id",
    "idempotency-key",
    "image-url",
    "label-ids",
    "name",
    "new-slug",
    "object-id",
    "object-type",
    "ordered-ids",
    "parent-issue-id",
    "priority",
    "project-id",
    "project-milestone-id",
    "query",
    "role",
    "scope",
    "settings-json",
    "slug",
    "state-id",
    "statuses-json",
    "team",
    "team-id",
    "team-key",
    "team-keys",
    "title",
    "token",
    "until",
    "version",
    "workspace-id",
  ]);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      return value;
    }
    const flagName = value.slice(2);
    if (
      flagsWithValues.has(flagName) &&
      index + 1 < values.length &&
      !values[index + 1].startsWith("--")
    ) {
      index += 1;
    }
  }
  return undefined;
}

function redactConfig(
  config: Record<string, unknown>,
): Record<string, string | undefined> {
  return {
    token: redactSecret(
      typeof config.token === "string" ? config.token : undefined,
    ),
    baseUrl: typeof config.baseUrl === "string" ? config.baseUrl : undefined,
  };
}

function redactSecret(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  if (value.length <= 8) {
    return "<redacted>";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function normalizeGlobalArgs(values: string[]) {
  if (values[0] !== "--json" && values[0] !== "--help") {
    return values;
  }
  const [flag, ...rest] = values;
  return [...rest, flag];
}

function configFileCheck() {
  try {
    const stats = statSync(configPath(state.env));
    const mode = stats.mode & 0o777;
    return {
      name: "config-file",
      status: mode === 0o600 ? "pass" : "warn",
      detail:
        mode === 0o600
          ? "user-only permissions"
          : `permissions are ${mode.toString(8)}; expected 600`,
    } as const;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {
        name: "config-file",
        status: "warn",
        detail: "no stored config file; env config may still be valid",
      } as const;
    }
    throw error;
  }
}

async function healthCheck() {
  const fetcher = state.fetch ?? fetch;
  for (const url of healthUrls(baseUrl)) {
    try {
      const response = await fetcher(url);
      if (response.ok) {
        return {
          name: "health",
          status: "pass",
          detail: `${url} returned HTTP ${response.status}`,
        } as const;
      }
    } catch {
      // Try the next conventional health URL.
    }
  }
  return {
    name: "health",
    status: "fail",
    detail: "no /healthz or /api/healthz endpoint responded successfully",
  } as const;
}

function healthUrls(apiUrl: string) {
  const url = new URL(apiUrl);
  return [
    new URL("/healthz", url.origin).toString(),
    new URL("/api/healthz", url.origin).toString(),
  ];
}

function problemTitle(error: unknown) {
  if (error && typeof error === "object" && "title" in error) {
    return String(error.title);
  }
  return "request failed";
}

function printDoctor(
  checks: {
    name: string;
    status: "pass" | "warn" | "fail";
    detail: string;
  }[],
) {
  const mode = resolveOutputMode({
    args: rawArgs,
    defaultHuman: true,
    isTTY: state.isStdoutTTY,
    env: state.env,
  });
  if (mode === "json") {
    printJson({ ok: checks.every((check) => check.status !== "fail"), checks });
    return;
  }
  for (const check of checks) {
    writeStdout(
      `${check.status.toUpperCase()}  ${check.name}  ${check.detail}\n`,
    );
  }
}

function findCurrentCycle(data: unknown) {
  if (!data || typeof data !== "object" || !("cycles" in data)) {
    return null;
  }
  const cycles = data.cycles;
  if (!Array.isArray(cycles)) {
    return null;
  }
  const today = new Date().toISOString().slice(0, 10);
  return (
    cycles.find((cycle) => {
      if (!cycle || typeof cycle !== "object") {
        return false;
      }
      const start = "start_date" in cycle ? String(cycle.start_date) : "";
      const end = "end_date" in cycle ? String(cycle.end_date) : "";
      return start <= today && today <= end;
    }) ?? null
  );
}
