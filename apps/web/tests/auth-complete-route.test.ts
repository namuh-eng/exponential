import { afterEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.fn();

vi.mock("@/lib/server-api-client", () => ({
  createNoStoreServerApiClientFromRequest: vi.fn(() => ({ GET: mockGet })),
}));

describe("/auth/complete route", () => {
  const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalPublicBaseUrl = process.env.PUBLIC_BASE_URL;

  afterEach(() => {
    vi.resetModules();
    mockGet.mockReset();
    if (originalNextPublicAppUrl === undefined) {
      process.env.NEXT_PUBLIC_APP_URL = undefined;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalNextPublicAppUrl;
    }
    if (originalPublicBaseUrl === undefined) {
      process.env.PUBLIC_BASE_URL = undefined;
    } else {
      process.env.PUBLIC_BASE_URL = originalPublicBaseUrl;
    }
  });

  it("redirects missing sessions to the public app origin, not the container bind host", async () => {
    process.env.PUBLIC_BASE_URL = "https://exponential.namuh.co";
    mockGet.mockResolvedValue({
      response: { status: 401 },
      data: undefined,
    });

    const { GET } = await import("@/app/auth/complete/route");
    const response = await GET(
      new Request("http://0.0.0.0:3000/auth/complete?callbackUrl=%2Finbox"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://exponential.namuh.co/login?callbackUrl=%2Finbox&error=session_not_created",
    );
  });

  it("redirects verified sessions to the safe local callback on the public app origin", async () => {
    process.env.PUBLIC_BASE_URL = "https://exponential.namuh.co";
    mockGet.mockResolvedValue({
      response: { status: 200 },
      data: { user: { id: "user-1" } },
    });

    const { GET } = await import("@/app/auth/complete/route");
    const response = await GET(
      new Request("http://0.0.0.0:3000/auth/complete?callbackUrl=%2Froadmap"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://exponential.namuh.co/roadmap",
    );
  });

  it("continues when verification is a false negative but the browser sent a session cookie", async () => {
    process.env.PUBLIC_BASE_URL = "https://exponential.namuh.co";
    mockGet.mockResolvedValue({
      response: { status: 401 },
      data: undefined,
    });

    const { GET } = await import("@/app/auth/complete/route");
    const response = await GET(
      new Request("http://0.0.0.0:3000/auth/complete?callbackUrl=%2Finbox", {
        headers: { cookie: "other=1; exponential_session=signed-token" },
      }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://exponential.namuh.co/inbox",
    );
  });
});
