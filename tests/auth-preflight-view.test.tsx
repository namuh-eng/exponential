import { AuthPage } from "@/components/auth-page";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("@/lib/auth-client", () => ({
  signIn: {
    social: vi.fn(),
    magicLink: vi.fn(() => Promise.resolve()),
  },
  signInWithPasskey: vi.fn(),
  browserSupportsPasskeys: vi.fn(() => true),
}));

describe("AuthPage preflight panel", () => {
  beforeEach(() => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/health/preflight") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            checks: [
              {
                name: "Postgres",
                status: "ok",
                detail: "Database accepts queries.",
              },
              {
                name: "Redis",
                status: "fail",
                detail: "Cache is not reachable.",
              },
            ],
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({ providers: { google: true, passkey: true } }),
      });
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads live preflight data and warns without blocking login choices", async () => {
    render(<AuthPage mode="login" initialGoogleConfigured />);

    expect(
      await screen.findByLabelText("Authentication preflight checks"),
    ).toBeDefined();
    expect(screen.getByText("Postgres")).toBeDefined();
    expect(screen.getByText("Cache is not reachable.")).toBeDefined();
    expect(
      screen.getByText(/One or more login dependencies need attention/i),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Continue with email/i }),
    ).toBeEnabled();
  });

  it("silently omits the panel when preflight is unreachable", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/health/preflight") {
        return Promise.reject(new Error("network unavailable"));
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({ providers: { google: true, passkey: true } }),
      });
    });

    render(<AuthPage mode="login" initialGoogleConfigured />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/health/preflight",
        expect.objectContaining({ cache: "no-store" }),
      );
    });
    expect(
      screen.queryByLabelText("Authentication preflight checks"),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /Continue with email/i }),
    ).toBeEnabled();
  });
});
