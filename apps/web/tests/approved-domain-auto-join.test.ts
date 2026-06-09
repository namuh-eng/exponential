import { autoJoinWorkspaceForApprovedDomain } from "@/lib/approved-domain-auto-join";
import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();

vi.mock("@/lib/server-api-client", () => ({
  createServerApiClient: vi.fn(async () => ({ POST: post })),
}));

describe("approved-domain auto-join", () => {
  beforeEach(() => {
    post.mockReset();
  });

  it("delegates approved-domain joining to the headless API", async () => {
    post.mockResolvedValue({
      data: { workspaceId: "10000000-0000-0000-0000-000000000002" },
      response: new Response(null, { status: 200 }),
    });

    await expect(
      autoJoinWorkspaceForApprovedDomain({
        userId: "10000000-0000-0000-0000-000000000001",
        email: "user@acme.com",
      }),
    ).resolves.toBe("10000000-0000-0000-0000-000000000002");
    expect(post).toHaveBeenCalledWith("/workspaces/approved-domain-auto-join");
  });

  it("skips the API when the caller has no usable session identity", async () => {
    await expect(
      autoJoinWorkspaceForApprovedDomain({ userId: "", email: null }),
    ).resolves.toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
});
