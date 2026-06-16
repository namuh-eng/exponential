import { PATCH } from "@/app/api/agent/runs/[id]/route";
import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { createExternalAgentRun } from "@/lib/agent-runs";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
  },
}));

const resolveActiveWorkspaceIdMock =
  resolveActiveWorkspaceId as unknown as ReturnType<typeof vi.fn>;
const requireApiSessionMock = requireApiSession as unknown as ReturnType<
  typeof vi.fn
>;
const dbSelectMock = db.select as unknown as ReturnType<typeof vi.fn>;

function mockReviewerSession() {
  requireApiSessionMock.mockResolvedValue({
    response: null,
    session: {
      user: {
        id: "reviewer-1",
        name: "Review Lead",
        email: "reviewer@example.com",
      },
    },
  });
  resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-review");
}

function mockWorkspaceAccess(role = "admin") {
  dbSelectMock.mockImplementation(() => {
    const builder = {
      from: vi.fn(() => builder),
      innerJoin: vi.fn(() => builder),
      where: vi.fn(() => builder),
      limit: vi.fn().mockResolvedValue([
        {
          role,
          settings: {
            ai: {
              aiFeaturesEnabled: true,
              agentUsagePermission: "admins",
            },
          },
        },
      ]),
    };
    return builder;
  });
}

function reviewRequest(
  runId: string,
  suggestionId: string,
  status = "accepted",
) {
  return PATCH(
    new Request(`http://localhost/api/agent/runs/${runId}`, {
      method: "PATCH",
      body: JSON.stringify({ suggestionId, status }),
    }),
    { params: Promise.resolve({ id: runId }) },
  );
}

function createSlackMutationRun() {
  return createExternalAgentRun("workspace-review", {
    actionType: "create_issue",
    title: "Create issue from Slack escalation",
    prompt: "Create an issue proposal from this Slack support escalation.",
    teamKey: "ENG",
    source: {
      provider: "slack",
      conversationId: "C123",
      threadId: "1717000000.000100",
      permalink: "https://slack.example.com/archives/C123/p1717000000000100",
      excerpt: "Customer cannot complete onboarding after SSO redirect.",
    },
    actor: {
      externalUserId: "U123",
      displayName: "Support Lead",
      mappedUserId: "mapped-user-1",
    },
  });
}

describe("agent run review route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("records reviewer and external source context when approving a gated action", async () => {
    mockReviewerSession();
    mockWorkspaceAccess();
    const run = createSlackMutationRun();
    const suggestionId = run.suggestions[0].id;

    const response = await reviewRequest(run.id, suggestionId);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.run).toMatchObject({
      id: run.id,
      status: "completed",
      source: {
        provider: "slack",
        conversationId: "C123",
      },
      actor: {
        externalUserId: "U123",
        mappedUserId: "mapped-user-1",
      },
      reviewGate: {
        required: true,
        policy: "external_mutation_requires_approval",
        decision: {
          status: "accepted",
          reviewerId: "reviewer-1",
          reviewerName: "Review Lead",
          reviewerEmail: "reviewer@example.com",
        },
      },
    });
    expect(payload.run.suggestions[0].status).toBe("accepted");
    expect(payload.run.logs).toContain(
      "Accepted external create_issue from slack:C123 by reviewer@example.com.",
    );

    dbSelectMock.mockClear();
    mockWorkspaceAccess();
    const repeatResponse = await reviewRequest(run.id, suggestionId);
    const repeatPayload = await repeatResponse.json();

    expect(repeatResponse.status).toBe(200);
    expect(
      repeatPayload.run.logs.filter(
        (entry: string) =>
          entry ===
          "Accepted external create_issue from slack:C123 by reviewer@example.com.",
      ),
    ).toHaveLength(1);
  });

  it("blocks review decisions when workspace agent policy denies the reviewer", async () => {
    mockReviewerSession();
    mockWorkspaceAccess("member");
    const run = createSlackMutationRun();
    const suggestionId = run.suggestions[0].id;

    const response = await reviewRequest(run.id, suggestionId);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({
      error:
        "You do not have permission to review agent actions in this workspace",
    });
  });
});
