import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const linkSocialAccountMock = vi.hoisted(() => vi.fn());
const unlinkSocialAccountMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-client", () => ({
  linkSocialAccount: linkSocialAccountMock,
  unlinkSocialAccount: unlinkSocialAccountMock,
}));

import ConnectedAccountsPage from "@/app/(app)/settings/account/connections/page";
import { linkSocialAccount, unlinkSocialAccount } from "@/lib/auth-client";

const assignMock = vi.fn();
const mockLocation = {
  ...window.location,
  assign: assignMock,
  href: "http://localhost:3015/foreverbrowsing/settings/account/connections",
  pathname: "/foreverbrowsing/settings/account/connections",
  search: "",
};

type ProviderCapabilities = Partial<
  Record<
    "google" | "github" | "gitlab" | "slack" | "passkey",
    | boolean
    | { supported?: boolean; configured?: boolean; devLinking?: boolean }
  >
>;

function mockFetch({
  capabilities = {},
  providers = [],
}: {
  capabilities?: ProviderCapabilities;
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
    if (path.startsWith("/api/auth/provider-capabilities")) {
      return new Response(JSON.stringify({ providers: capabilities }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
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

  it("renders provider-level configuration states including GitHub when no provider is configured", async () => {
    const fetchMock = mockFetch({});

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

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/provider-capabilities?callbackUrl=%2Fforeverbrowsing%2Fsettings%2Faccount%2Fconnections",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Connected accounts" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/synced integration activity/)).toBeInTheDocument();
    expect(screen.getByText("No connected accounts yet.")).toBeInTheDocument();
    expect(screen.getByText("Available providers")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("GitLab")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(
      screen.getByText("GitHub account linking is not configured"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Configuration required")).toHaveLength(4);
    expect(
      screen.queryByRole("button", { name: "Connect account" }),
    ).not.toBeInTheDocument();
    expect(linkSocialAccount).not.toHaveBeenCalled();
  });

  it("opens a provider chooser and starts GitHub account linking when configured", async () => {
    mockFetch({ capabilities: { github: { configured: true } } });
    linkSocialAccountMock.mockResolvedValueOnce({
      data: {
        url: "https://github.com/login/oauth/authorize?client_id=test",
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

    fireEvent.click(screen.getByRole("button", { name: "GitHub" }));

    await waitFor(() => {
      expect(linkSocialAccount).toHaveBeenCalledWith({
        provider: "github",
        callbackURL:
          "http://localhost:3015/foreverbrowsing/settings/account/connections?connection=linked",
        errorCallbackURL:
          "http://localhost:3015/foreverbrowsing/settings/account/connections",
      });
      expect(assignMock).toHaveBeenCalledWith(
        "https://github.com/login/oauth/authorize?client_id=test",
      );
    });
  });

  it("renders connected GitHub identity and disconnect action", async () => {
    mockFetch({
      capabilities: { github: { configured: true } },
      providers: [
        {
          id: "provider-1",
          providerId: "github",
          accountId: "octocat",
          displayName: "The Octocat",
          handle: "octocat",
          createdAt: "2026-05-01T00:00:00.000Z",
        },
        { id: "provider-2", providerId: "credential", accountId: "email" },
      ],
    });
    unlinkSocialAccountMock.mockResolvedValueOnce({ data: { status: true } });

    render(<ConnectedAccountsPage />);

    expect(await screen.findAllByText("GitHub")).toHaveLength(2);
    expect(screen.getAllByText("The Octocat")).toHaveLength(1);
    expect(screen.getByText("octocat")).toBeInTheDocument();
    expect(screen.getAllByText(/Connected (Apr 30|May 1), 2026/)).toHaveLength(
      2,
    );
    expect(screen.getAllByText("Connected")).toHaveLength(2);
    expect(
      screen.queryByText("No connected accounts yet."),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect GitHub" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/may stop being attributed/);
    expect(unlinkSocialAccount).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Disconnect GitHub" }),
    );

    await waitFor(() => {
      expect(unlinkSocialAccount).toHaveBeenCalledWith({
        providerId: "github",
        accountId: "octocat",
      });
      expect(screen.getByText("GitHub disconnected.")).toBeInTheDocument();
    });
  });

  it("keeps the provider surface extensible when capabilities include non-account-linking providers", async () => {
    mockFetch({
      capabilities: { google: { devLinking: true }, passkey: true },
    });

    render(<ConnectedAccountsPage />);

    expect(
      await screen.findByRole("button", { name: "Connect account" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect Google" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Passkey")).not.toBeInTheDocument();
  });

  it("surfaces cancelled and failed OAuth callback states from the URL", async () => {
    mockLocation.search = "?error=access_denied";
    mockLocation.href =
      "http://localhost:3015/foreverbrowsing/settings/account/connections?error=access_denied";
    mockFetch({ capabilities: { github: { configured: true } } });

    render(<ConnectedAccountsPage />);

    expect(
      await screen.findByText(
        "Account linking was cancelled. No account was connected.",
      ),
    ).toBeInTheDocument();
  });
});
