import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.fn();

vi.mock("@/lib/server-api-client", () => ({
  createNoStoreServerApiClientFromHeaders: vi.fn(() => ({ GET: mockGet })),
}));

import { getWebSession } from "@/lib/web-session";

describe("getWebSession", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("returns null without hitting the API when no session cookie is present", async () => {
    const result = await getWebSession(new Headers());

    expect(result).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("returns null without hitting the API when cookies exist but none are session cookies", async () => {
    const headers = new Headers({
      cookie: "activeWorkspaceSlug=acme; theme=dark",
    });

    const result = await getWebSession(headers);

    expect(result).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("calls /auth/session when the primary session cookie is present", async () => {
    mockGet.mockResolvedValue({
      response: { status: 200 },
      data: {
        user: { id: "u1", name: "Ada", email: "ada@example.com", image: null },
      },
    });
    const headers = new Headers({ cookie: "exponential_session=signed-token" });

    const result = await getWebSession(headers);

    expect(mockGet).toHaveBeenCalledWith("/auth/session");
    expect(result).toEqual({
      user: { id: "u1", name: "Ada", email: "ada@example.com", image: null },
    });
  });

  it("calls /auth/session when the legacy session cookie is present", async () => {
    mockGet.mockResolvedValue({ response: { status: 401 } });
    const headers = new Headers({ cookie: "session_token=legacy" });

    const result = await getWebSession(headers);

    expect(mockGet).toHaveBeenCalledWith("/auth/session");
    expect(result).toBeNull();
  });

  it("returns null when an authenticated cookie yields a 401", async () => {
    mockGet.mockResolvedValue({ response: { status: 401 } });
    const headers = new Headers({ cookie: "exponential_session=expired" });

    const result = await getWebSession(headers);

    expect(result).toBeNull();
  });
});
