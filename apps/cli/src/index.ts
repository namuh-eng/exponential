#!/usr/bin/env node
import { createExponentialClient, syncWebSocketUrl } from "@exponential/sdk";
import { parseIssueBody, readOption, requireOption } from "./args.js";
import {
  assertPatToken,
  resolveBaseUrl,
  resolveToken,
  writeConfig,
} from "./config.js";

const rawArgs = process.argv.slice(2);
const [resource, action = "list", ...args] = rawArgs;
const baseUrl = resolveBaseUrl();
const token = resource === "login" ? undefined : resolveToken();

if (resource !== "login" && !token) {
  console.error(
    "EXPONENTIAL_TOKEN is required or run `exponential login --token pat_...`",
  );
  process.exit(1);
}

const apiToken = token ?? "";
const client = createExponentialClient({ token: apiToken, baseUrl });
const idempotencyKey = readOption(args, "idempotency-key");

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
          process.stdout.write(`${data}
`);
        } else if (data instanceof ArrayBuffer) {
          process.stdout.write(`${Buffer.from(data).toString("utf8")}
`);
        } else if (data instanceof Uint8Array) {
          process.stdout.write(`${Buffer.from(data).toString("utf8")}
`);
        } else if (typeof Blob !== "undefined" && data instanceof Blob) {
          process.stdout.write(`${await data.text()}
`);
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
      headers: { "Idempotency-Key": idempotencyKey },
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
      headers: { "Idempotency-Key": idempotencyKey },
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
      headers: { "Idempotency-Key": idempotencyKey },
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
  writeConfig({ token: loginToken, baseUrl: loginBaseUrl });
  console.log(JSON.stringify({ ok: true, baseUrl: loginBaseUrl }, null, 2));
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

function printResult(data: unknown, error: unknown, status: number) {
  if (error) {
    console.error(JSON.stringify({ status, error }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(data, null, 2));
}

function readJSONOption(args: string[], name: string) {
  const raw = readOption(args, name);
  return raw ? JSON.parse(raw) : undefined;
}

function usage(): never {
  console.error(`Usage:
  exponential login --token pat_<token> [--api-url http://localhost:7016/v1]
  exponential issues list [--team-id <uuid>] [--cursor <cursor>] [--limit <n>]
  exponential issues search --query <text> [--workspace-id <uuid>]
  exponential issues get --id <id-or-identifier>
  exponential issues create --title <title> --team-id <uuid> [--idempotency-key <key>]
  exponential issues update --id <id-or-identifier> [--title <title>] [--state-id <uuid>]
  exponential issues delete --id <id-or-identifier> [--idempotency-key <key>]
  exponential issues subscription --id <id-or-identifier>
  exponential issues subscribe --id <id-or-identifier>
  exponential issues unsubscribe --id <id-or-identifier>
  exponential issues watch [--version <n>]
  exponential workspaces list
  exponential workspaces create --name <name> --url-slug <slug>
  exponential workspaces current
  exponential workspaces members
  exponential workspaces invite --email <email> [--role member|admin|guest]
  exponential teams list
  exponential teams create --name <name> [--key <key>] [--private true]
  exponential teams create-issue-options --team-key <key>
  exponential tokens list
  exponential tokens create --name <name> [--scopes read,write]
  exponential tokens revoke --id <uuid>
  exponential projects list
  exponential projects get --slug <slug>
  exponential projects create --name <name> [--slug <slug>] [--team-keys ENG,DES]
  exponential projects update --slug <slug> [--name <name>] [--new-slug <slug>]
  exponential projects delete --slug <slug>
  exponential project-statuses list
  exponential project-statuses update --statuses-json '<json-array>'
  exponential project-templates list
  exponential project-templates create --name <name> [--description <text>] [--settings-json '<json>']
  exponential project-templates update --id <uuid> --name <name> [--settings-json '<json>']
  exponential project-templates delete --id <uuid>
  exponential cycles list --team-key <key>
  exponential cycles create --team-key <key> --start-date YYYY-MM-DD --end-date YYYY-MM-DD
  exponential cycles update --team-key <key> --id <uuid> [--name <name>]
  exponential cycles delete --team-key <key> --id <uuid>
  exponential comments create --issue-id <id-or-identifier> --body <text>
  exponential comments update --id <uuid> --body <text>
  exponential comments delete --id <uuid>
  exponential comments react --id <uuid> --emoji <emoji>
  exponential issue-templates list [--team-key <key>]
  exponential issue-templates create [--name <name>] [--description <text>] [--settings-json '<json>']
  exponential issue-templates update --id <uuid> [--name <name>] [--settings-json '<json>']
  exponential issue-templates archive --id <uuid>
  exponential issue-templates delete --id <uuid>
  exponential labels list [--scope workspace|team|all] [--team-id <uuid>]
  exponential labels create --name <name> [--color #6b6f76] [--team-id <uuid>]
  exponential labels update --id <uuid> [--name <name>] [--color #6b6f76]
  exponential labels delete --id <uuid>
  exponential labels bulk --action archive|unarchive|delete|convertToGroup|rescope|merge --label-ids <ids>
  exponential emojis list
  exponential emojis create --name <name> --image-url <url-or-data-url>
  exponential emojis delete --id <id>
  exponential documents settings
  exponential documents create-folder --name <name> [--color gray|blue|green|yellow|orange|purple|pink]
  exponential documents update-folder --id <id> [--name <name>] [--color gray]
  exponential documents delete-folder --id <id>
  exponential documents create-template --name <name> --content <markdown>
  exponential documents update-template --id <id> [--name <name>] [--content <markdown>]
  exponential documents delete-template --id <id>
  exponential integrations list
  exponential integrations disconnect --provider slack|github|zendesk
  exponential account profile
  exponential account preferences
  exponential notifications list
  exponential notifications mark-read
  exponential notifications read --id <uuid>
  exponential notifications unread --id <uuid>
  exponential notifications snooze --id <uuid> [--until ISO_DATE]
  exponential favorites list
  exponential favorites add --object-type project|issue|view --object-id <id>
  exponential favorites reorder --ordered-ids project:id,issue:id
  exponential favorites remove --object-type project|issue|view --object-id <id>`);
  process.exit(1);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
