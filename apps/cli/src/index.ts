#!/usr/bin/env node
import { createExponentialClient, syncWebSocketUrl } from "@exponential/sdk";
import { parseIssueBody, readOption, requireOption } from "./args.js";

const [resource, action = "list", ...args] = process.argv.slice(2);
const token = process.env.EXPONENTIAL_TOKEN;
const baseUrl = process.env.EXPONENTIAL_API_URL ?? "http://localhost:3016/v1";

if (!token) {
  console.error("EXPONENTIAL_TOKEN is required");
  process.exit(1);
}

const apiToken = token;
const client = createExponentialClient({ token: apiToken, baseUrl });
const idempotencyKey = readOption(args, "idempotency-key");

async function main() {
  if (resource === "workspaces") {
    await workspaceCommand();
    return;
  }

  if (resource === "tokens") {
    await tokenCommand();
    return;
  }

  if (resource === "projects") {
    await projectCommand();
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

  if (resource === "labels") {
    await labelCommand();
    return;
  }

  if (resource === "emojis") {
    await emojiCommand();
    return;
  }

  if (resource === "account") {
    await accountCommand();
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

  if (action === "watch") {
    console.log(
      JSON.stringify({
        url: syncWebSocketUrl({
          baseUrl,
          token: apiToken,
          version: readOption(args, "version")
            ? Number(readOption(args, "version"))
            : 0,
        }),
      }),
    );
    return;
  }

  usage();
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

function usage(): never {
  console.error(`Usage:
  exponential issues list [--team-id <uuid>] [--cursor <cursor>] [--limit <n>]
  exponential issues get --id <id-or-identifier>
  exponential issues create --title <title> --team-id <uuid> [--idempotency-key <key>]
  exponential issues update --id <id-or-identifier> [--title <title>] [--state-id <uuid>]
  exponential issues delete --id <id-or-identifier> [--idempotency-key <key>]
  exponential issues watch [--version <n>]
  exponential workspaces list
  exponential workspaces create --name <name> --url-slug <slug>
  exponential workspaces current
  exponential workspaces members
  exponential workspaces invite --email <email> [--role member|admin|guest]
  exponential tokens list
  exponential tokens create --name <name> [--scopes read,write]
  exponential tokens revoke --id <uuid>
  exponential projects list
  exponential projects get --slug <slug>
  exponential projects create --name <name> [--slug <slug>] [--team-keys ENG,DES]
  exponential projects update --slug <slug> [--name <name>] [--new-slug <slug>]
  exponential projects delete --slug <slug>
  exponential cycles list --team-key <key>
  exponential cycles create --team-key <key> --start-date YYYY-MM-DD --end-date YYYY-MM-DD
  exponential cycles update --team-key <key> --id <uuid> [--name <name>]
  exponential cycles delete --team-key <key> --id <uuid>
  exponential comments create --issue-id <id-or-identifier> --body <text>
  exponential comments update --id <uuid> --body <text>
  exponential comments delete --id <uuid>
  exponential comments react --id <uuid> --emoji <emoji>
  exponential labels list [--scope workspace|team|all] [--team-id <uuid>]
  exponential labels create --name <name> [--color #6b6f76] [--team-id <uuid>]
  exponential labels update --id <uuid> [--name <name>] [--color #6b6f76]
  exponential labels delete --id <uuid>
  exponential emojis list
  exponential emojis create --name <name> --image-url <url-or-data-url>
  exponential emojis delete --id <id>
  exponential account profile
  exponential account preferences`);
  process.exit(1);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
