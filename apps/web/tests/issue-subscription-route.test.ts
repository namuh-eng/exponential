import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveRequestWorkspaceIdMock = vi.fn();
const issueLimitMock = vi.fn();
const summaryMock = vi.fn();
const setSubscriptionMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveRequestWorkspaceId: resolveRequestWorkspaceIdMock,
}));

vi.mock("@/lib/issue-subscriptions", () => ({
  getIssueSubscriptionSummary: summaryMock,
  setIssueSubscription: setSubscriptionMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: issueLimitMock,
          }),
        }),
      }),
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("issue subscription route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveRequestWorkspaceIdMock.mockResolvedValue("workspace-1");
    issueLimitMock.mockResolvedValue([
      { id: "issue-1", workspaceId: "workspace-1" },
    ]);
    summaryMock.mockResolvedValue({ subscribed: false, watcherCount: 0 });
    setSubscriptionMock.mockResolvedValue({
      subscribed: true,
      watcherCount: 1,
    });
  });

  it("returns subscription state for an accessible issue", async () => {
    const { GET } = await import("@/app/api/issues/[id]/subscription/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "ENG-1" }),
    });

    expect(response.status).toBe(200);
    expect(summaryMock).toHaveBeenCalledWith({
      issueId: "issue-1",
      userId: "user-1",
    });
    await expect(response.json()).resolves.toEqual({
      subscribed: false,
      watcherCount: 0,
    });
  });

  it("persists subscribe and unsubscribe mutations", async () => {
    const { POST, DELETE } = await import(
      "@/app/api/issues/[id]/subscription/route"
    );

    const postResponse = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "ENG-1" }),
    });
    expect(postResponse.status).toBe(200);
    expect(setSubscriptionMock).toHaveBeenCalledWith({
      issueId: "issue-1",
      userId: "user-1",
      subscribed: true,
    });

    setSubscriptionMock.mockResolvedValueOnce({
      subscribed: false,
      watcherCount: 0,
    });
    const deleteResponse = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ id: "ENG-1" }),
    });
    expect(deleteResponse.status).toBe(200);
    expect(setSubscriptionMock).toHaveBeenLastCalledWith({
      issueId: "issue-1",
      userId: "user-1",
      subscribed: false,
    });
  });

  it("does not expose issues outside the active workspace", async () => {
    issueLimitMock.mockResolvedValue([]);
    const { POST } = await import("@/app/api/issues/[id]/subscription/route");

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "ENG-404" }),
    });

    expect(response.status).toBe(404);
    expect(setSubscriptionMock).not.toHaveBeenCalled();
  });
});
