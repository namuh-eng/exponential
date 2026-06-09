import { POST } from "@/app/api/agent/actions/route";
import { resolveEffectiveAgentGuidance } from "@/lib/agent-guidance";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { resolveIntegrationActorUserId } from "@/lib/integration-attribution";
import { getWorkspaceAccess } from "@/lib/workspace-integrations";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: vi.fn(),
}));

vi.mock("@/lib/workspace-integrations", () => ({
  getWorkspaceAccess: vi.fn(),
}));

vi.mock("@/lib/agent-guidance", () => ({
  resolveEffectiveAgentGuidance: vi.fn(),
}));

vi.mock("@/lib/integration-attribution", () => ({
  resolveIntegrationActorUserId: vi.fn(),
}));

vi.mock("@/lib/teams", () => ({
  findAccessibleTeam: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
  },
}));

const requireApiSessionMock = requireApiSession as unknown as ReturnType<
  typeof vi.fn
>;
const getWorkspaceAccessMock = getWorkspaceAccess as unknown as ReturnType<
  typeof vi.fn
>;
const resolveEffectiveAgentGuidanceMock =
  resolveEffectiveAgentGuidance as unknown as ReturnType<typeof vi.fn>;
const resolveIntegrationActorUserIdMock =
  resolveIntegrationActorUserId as unknown as ReturnType<typeof vi.fn>;
const dbSelectMock = db.select as unknown as ReturnType<typeof vi.fn>;

function mockSession() {
  requireApiSessionMock.mockResolvedValue({
    response: null,
    session: {
      user: {
        id: "user-1",
        name: "Workspace Admin",
        email: "admin@example.com",
      },
    },
  });
  getWorkspaceAccessMock.mockResolvedValue({
    workspaceId: "workspace-1",
    workspaceSlug: "foreverbrowsing",
    role: "admin",
  });
  resolveEffectiveAgentGuidanceMock.mockResolvedValue({
    entries: [],
    effectiveInstructions: "",
    autoFixEnabled: false,
    teamKey: "",
  });
  resolveIntegrationActorUserIdMock.mockResolvedValue("mapped-user-1");
}

function mockDbSelectRows(...rowsByCall: unknown[][]) {
  dbSelectMock.mockImplementation(() => {
    const rows = rowsByCall.shift() ?? [];
    const builder = {
      from: vi.fn(() => builder),
      where: vi.fn(() => builder),
      limit: vi.fn().mockResolvedValue(rows),
    };
    return builder;
  });
}

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/agent/actions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const createIssuePayload = {
  actionType: "create_issue",
  title: "Escalate customer blocker",
  prompt: "Create an issue proposal from this customer conversation.",
  source: {
    provider: "slack",
    conversationId: "C123",
    threadId: "1717000000.000100",
    channelName: "customer-help",
    permalink: "https://slack.example.com/archives/C123/p1717000000000100",
    excerpt: "Customer cannot finish onboarding after SSO redirect.",
  },
  actor: {
    externalUserId: "U123",
    displayName: "Support Lead",
    email: "support@example.com",
  },
};

describe("agent actions route", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("creates a review-gated issue proposal from external source context", async () => {
    mockSession();
    mockDbSelectRows(
      [{ settings: { ai: { aiFeaturesEnabled: true } } }],
      [{ id: "integration-1", status: "connected" }],
    );

    const response = await POST(request(createIssuePayload));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.status).toBe("needs_review");
    expect(payload.run).toMatchObject({
      actionType: "create_issue",
      status: "needs_review",
      source: {
        provider: "slack",
        conversationId: "C123",
        channelName: "customer-help",
      },
      actor: {
        externalUserId: "U123",
        mappedUserId: "mapped-user-1",
      },
      reviewGate: {
        required: true,
        policy: "external_mutation_requires_approval",
      },
    });
    expect(payload.run.suggestions[0]).toMatchObject({
      actionType: "create_issue",
      requiresApproval: true,
      status: "open",
      contextUrl: "https://slack.example.com/archives/C123/p1717000000000100",
      isExternalContext: true,
    });
    expect(payload.run.logs).toEqual(
      expect.arrayContaining([
        "Received create_issue from Slack.",
        "Captured provider source slack:C123.",
        "Captured actor U123 mapped to mapped-user-1.",
        "Review gate enabled before applying external mutation.",
      ]),
    );
  });

  it("returns a disabled state when the AI provider is missing", async () => {
    vi.stubEnv("AGENT_ACTIONS_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "");
    mockSession();

    const response = await POST(request(createIssuePayload));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      status: "disabled",
      code: "ai_provider_missing",
      message:
        "AI agent actions are disabled because OPENAI_API_KEY is not configured.",
    });
    expect(dbSelectMock).not.toHaveBeenCalled();
  });

  it("returns a provider-missing state instead of a fake external action", async () => {
    mockSession();
    mockDbSelectRows([{ settings: { ai: { aiFeaturesEnabled: true } } }], []);

    const response = await POST(request(createIssuePayload));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      status: "disabled",
      code: "provider_missing",
      provider: "slack",
      message: "slack is not connected for this workspace.",
    });
  });
});
