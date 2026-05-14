import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const linkSocialAccountMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-client", () => ({
  linkSocialAccount: linkSocialAccountMock,
}));

import ConnectedAccountsPage from "@/app/(app)/settings/account/connections/page";
import { linkSocialAccount } from "@/lib/auth-client";

const assignMock = vi.fn();
const mockLocation = {
  ...window.location,
  assign: assignMock,
  href: "http://localhost:3015/foreverbrowsing/settings/account/connections",
  pathname: "/foreverbrowsing/settings/account/connections",
  search: "",
};

function mockFetch({
  googleConfigured,
  providers = [],
}: {
  googleConfigured: boolean;
  providers?: Array<Record<string, unknown>>;
}) {
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const path = String(url);
    if (path === "/api/account/security") {
      return new Response(JSON.stringify({ providers }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (path === "/api/auth/provider-capabilities") {
      return new Response(
        JSON.stringify({ providers: { google: googleConfigured } }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return new Response("Not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ConnectedAccountsPage component", () => {
  beforeEach(() => {
    vi.stubGlobal("location", mockLocation);
    mockLocation.href =
      "http://localhost:3015/foreverbrowsing/settings/account/connections";
    mockLocation.pathname = "/foreverbrowsing/settings/account/connections";
    mockLocation.search = "";
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the connected accounts settings page with a disabled explanatory action when no provider is configured", async () => {
    const fetchMock = mockFetch({ googleConfigured: false });

    render(<ConnectedAccountsPage />);

    expect(
      screen.getByText("Loading connected accounts..."),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/account/security",
        expect.objectContaining({ credentials: "include" }),
      );
    });

    expect(screen.getByText("Connected accounts")).toBeInTheDocument();
    expect(screen.getByText(/Manage your social logins/)).toBeInTheDocument();
    expect(screen.getByText("No connected accounts")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Account linking is unavailable because no social login providers are configured/,
      ),
    ).toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Connect account" });
    expect(button).toBeDisabled();
    expect(
      screen.getByText(/Ask an admin to configure Google OAuth/),
    ).toBeInTheDocument();
    fireEvent.click(button);
    expect(
      screen.queryByText("Choose an account to connect"),
    ).not.toBeInTheDocument();
    expect(linkSocialAccount).not.toHaveBeenCalled();
  });

  it("opens a provider chooser and starts Google account linking when configured", async () => {
    mockFetch({ googleConfigured: true });
    linkSocialAccountMock.mockResolvedValueOnce({
      data: {
        url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=test",
        redirect: true,
      },
    });

    render(<ConnectedAccountsPage />);

    const connectButton = await screen.findByRole("button", {
      name: "Connect account",
    });
    expect(connectButton).not.toBeDisabled();

    fireEvent.click(connectButton);
    expect(
      screen.getByText("Choose an account to connect"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Google" }));

    await waitFor(() => {
      expect(linkSocialAccount).toHaveBeenCalledWith({
        provider: "google",
        callbackURL:
          "http://localhost:3015/foreverbrowsing/settings/account/connections?connection=linked",
        errorCallbackURL:
          "http://localhost:3015/foreverbrowsing/settings/account/connections",
      });
      expect(assignMock).toHaveBeenCalledWith(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=test",
      );
    });
  });

  it("shows a visible error instead of silently no-oping when linking fails", async () => {
    mockFetch({ googleConfigured: true });
    linkSocialAccountMock.mockResolvedValueOnce({
      error: {
        code: "PROVIDER_NOT_FOUND",
        status: 404,
        message: "Provider not found",
      },
    });

    render(<ConnectedAccountsPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Connect account" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Google" }));

    expect(
      await screen.findByText(/Google account linking is not configured/),
    ).toBeInTheDocument();
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("renders connected providers from real account provider data", async () => {
    mockFetch({
      googleConfigured: true,
      providers: [
        {
          id: "provider-1",
          providerId: "google",
          accountId: "google-account-123456",
        },
        { id: "provider-2", providerId: "credential", accountId: "email" },
      ],
    });

    render(<ConnectedAccountsPage />);

    expect(await screen.findByText("Google")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText(/ending in 123456/)).toBeInTheDocument();
    expect(screen.queryByText("No connected accounts")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "No additional account providers are available to connect.",
      ),
    ).toBeInTheDocument();
  });

  it("surfaces cancelled and failed OAuth callback states from the URL", async () => {
    mockLocation.search = "?error=access_denied";
    mockLocation.href =
      "http://localhost:3015/foreverbrowsing/settings/account/connections?error=access_denied";
    mockFetch({ googleConfigured: true });

    render(<ConnectedAccountsPage />);

    expect(
      await screen.findByText(
        "Account linking was cancelled. No account was connected.",
      ),
    ).toBeInTheDocument();
  });

  it("does not contain the old console.log placeholder action", async () => {
    const consoleSpy = vi.spyOn(console, "log");
    mockFetch({ googleConfigured: true });

    render(<ConnectedAccountsPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect account" }),
    );

    expect(consoleSpy).not.toHaveBeenCalledWith("Connect");
  });
});
