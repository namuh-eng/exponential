import { type ApiSession, requireApiSession } from "@/lib/api-auth";
import {
  createProductionMcpRepository,
  handleMcpJsonRpc,
  mcpToolNames,
} from "@/lib/mcp";
import { NextResponse } from "next/server";

type ApiKeySession = Extract<ApiSession, { apiKey: unknown }>;

function corsHeaders() {
  return {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": "*",
  };
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...corsHeaders(),
      ...init?.headers,
    },
  });
}

async function requireMcpApiKeySession() {
  const { response, session } = await requireApiSession();
  if (response || !session) {
    return { response, session: null };
  }

  if (!("apiKey" in session)) {
    return {
      response: jsonResponse(
        { error: "MCP requires a personal API key bearer token." },
        { status: 401 },
      ),
      session: null,
    };
  }

  return { response: null, session };
}

function buildContext(session: ApiKeySession) {
  return {
    workspaceId: session.apiKey.workspaceId,
    userId: session.user.id,
    userName: session.user.name,
    userEmail: session.user.email,
    apiKeyId: session.apiKey.id,
    memberRole: session.apiKey.memberRole,
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET() {
  const { response, session } = await requireMcpApiKeySession();
  if (response || !session) {
    return response;
  }

  return jsonResponse({
    name: "exponential",
    transport: "streamable-http",
    endpoint: "/api/mcp",
    auth: "bearer-pat",
    tools: mcpToolNames,
  });
}

export async function POST(request: Request) {
  const { response, session } = await requireMcpApiKeySession();
  if (response || !session) {
    return response;
  }

  const body = await request.json().catch(() => null);
  if (body === null) {
    return jsonResponse(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
      { status: 400 },
    );
  }

  const context = buildContext(session);
  const result = await handleMcpJsonRpc(
    body,
    context,
    createProductionMcpRepository(context),
  );

  if (result === null) {
    return new Response(null, { status: 202, headers: corsHeaders() });
  }

  return jsonResponse(result);
}
