import AccountSecurityPage from "@/app/(app)/settings/account/security/page";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

function mockSecurityFetch(body: unknown, init?: ResponseInit) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
        ...init,
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("AccountSecurityPage component", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders loading and empty states from the account security API", async () => {
    const fetchMock = mockSecurityFetch({ sessions: [], providers: [] });

    render(<AccountSecurityPage />);

    expect(screen.getByText("Loading account security...")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/account/security",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    expect(screen.getByText("Account security")).toBeInTheDocument();
    expect(
      screen.getByText("No active sessions were found for this account."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No connected sign-in methods were found."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Enable 2FA (coming soon)" }),
    ).toBeDisabled();
  });

  it("renders active sessions and connected sign-in methods", async () => {
    mockSecurityFetch({
      sessions: [
        {
          id: "session-current",
          isCurrent: true,
          userAgent: "Mozilla/5.0 Current Browser",
          ipAddress: "203.0.113.10",
          createdAt: "2026-01-01T10:00:00.000Z",
          updatedAt: "2026-01-02T10:00:00.000Z",
          expiresAt: "2026-02-01T10:00:00.000Z",
        },
      ],
      providers: [
        {
          id: "provider-google",
          providerId: "google",
          accountId: "google-user-123",
          createdAt: "2026-01-05T10:00:00.000Z",
          updatedAt: "2026-01-06T10:00:00.000Z",
        },
      ],
    });

    render(<AccountSecurityPage />);

    expect(await screen.findByText("Current session")).toBeInTheDocument();
    expect(screen.getByText("Mozilla/5.0 Current Browser")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.10")).toBeInTheDocument();
    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(screen.getByText("Account ID: google-user-123")).toBeInTheDocument();
  });

  it("renders an error state when the account security API fails", async () => {
    mockSecurityFetch({ error: "Unauthorized" }, { status: 401 });

    render(<AccountSecurityPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load account security information.",
    );
  });
});
