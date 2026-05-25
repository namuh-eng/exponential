import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);
vi.stubGlobal("location", {
  ...window.location,
  origin: "http://localhost:7015",
  assign: vi.fn(),
});

describe("Kratos auth proxy origin", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ui: {
            action: "http://localhost:4433/self-service/login?flow=abc",
            nodes: [{ attributes: { name: "csrf_token", value: "csrf" } }],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ redirect_browser_to: "http://localhost:7015/" }),
      });
  });

  it("uses same-origin Kratos proxy requests for browser sign-in", async () => {
    const { signIn } = await import("@/lib/auth-client");

    await signIn.social({
      provider: "google",
      callbackURL: "http://localhost:7015/team/ABC",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/auth/kratos/self-service/login/browser?return_to=http%3A%2F%2Flocalhost%3A7015%2Fteam%2FABC",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/kratos/self-service/login?flow=abc",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });
});
