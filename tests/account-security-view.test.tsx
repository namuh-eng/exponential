const enrollPasskeyMock = vi.hoisted(() => vi.fn());
const browserSupportsPasskeysMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/auth-client", () => ({
  browserSupportsPasskeys: browserSupportsPasskeysMock,
  enrollPasskey: enrollPasskeyMock,
}));

import AccountSecurityPage from "@/app/(app)/settings/account/security/page";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

function securityPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessions: [],
    passkeys: [],
    authorizedApplications: [],
    passkeyEnabled: true,
    ...overrides,
  };
}

describe("AccountSecurityPage component", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    browserSupportsPasskeysMock.mockReturnValue(true);
  });

  it("renders Linear-parity empty sections and no disabled 2FA placeholder", async () => {
    const fetchMock = mockSecurityFetch(securityPayload());

    render(<AccountSecurityPage />);

    expect(screen.getByText("Loading account security...")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/account/security",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    expect(
      screen.getByRole("heading", { name: "Security & access" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Sessions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Passkeys" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "API keys" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open workspace API settings" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Personal API keys" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("API key name")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create API key" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Authorized applications" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No active sessions were found for this account."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Two-factor authentication/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Enable 2FA/i }),
    ).not.toBeInTheDocument();
  });

  it("renders session details and protected/current revoke controls", async () => {
    mockSecurityFetch(
      securityPayload({
        sessions: [
          {
            id: "session-current",
            isCurrent: true,
            userAgent: "Mozilla/5.0 Current Browser",
            ipAddress: "203.0.113.10",
            source: "Browser",
            location: "Approximate location unavailable",
            createdAt: "2026-01-01T10:00:00.000Z",
            updatedAt: "2026-01-02T10:00:00.000Z",
            expiresAt: "2026-02-01T10:00:00.000Z",
          },
          {
            id: "session-other",
            isCurrent: false,
            userAgent: "Mozilla/5.0 Other Browser",
            ipAddress: "203.0.113.11",
            source: "Browser",
            location: "Approximate location unavailable",
            createdAt: "2026-01-03T10:00:00.000Z",
            updatedAt: "2026-01-04T10:00:00.000Z",
            expiresAt: "2026-02-03T10:00:00.000Z",
          },
        ],
      }),
    );

    render(<AccountSecurityPage />);

    expect(await screen.findByText("Current session")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Show details" })[0]);
    expect(screen.getByText("Mozilla/5.0 Current Browser")).toBeInTheDocument();
    expect(screen.getByText("Original sign-in")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Revoke" })[0]).toBeDisabled();
    expect(
      screen.getAllByRole("button", { name: "Revoke" })[1],
    ).not.toBeDisabled();
  });

  it("adds and revokes passkeys instead of rendering a permanent disabled stub", async () => {
    const promptMock = vi.fn(() => "Work laptop");
    vi.stubGlobal("prompt", promptMock);
    enrollPasskeyMock.mockResolvedValueOnce({ id: "passkey-1" });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(securityPayload()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            securityPayload({
              passkeys: [
                {
                  id: "passkey-1",
                  name: "Work laptop",
                  credentialId: "credential-1",
                  deviceType: "singleDevice",
                  backedUp: false,
                  transports: ["internal"],
                  createdAt: "2026-05-14T10:00:00.000Z",
                },
              ],
            }),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(securityPayload({ passkeys: [] })), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<AccountSecurityPage />);

    const addPasskey = await screen.findByRole("button", {
      name: "Add passkey",
    });
    expect(addPasskey).not.toBeDisabled();
    expect(
      screen.queryByText(/Passkeys are not configured/i),
    ).not.toBeInTheDocument();

    fireEvent.click(addPasskey);

    await screen.findByText("Passkey added.");
    expect(enrollPasskeyMock).toHaveBeenCalledWith("Work laptop");
    expect(screen.getByText("Work laptop")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({
      action: "revokePasskey",
      passkeyId: "passkey-1",
    });
  });

  it("explains unavailable WebAuthn instead of showing an enabled passkey action", async () => {
    browserSupportsPasskeysMock.mockReturnValueOnce(false);
    mockSecurityFetch(securityPayload());

    render(<AccountSecurityPage />);

    const addPasskey = await screen.findByRole("button", {
      name: "Add passkey",
    });
    expect(addPasskey).toBeDisabled();
    expect(
      screen.getByText(/does not support WebAuthn passkeys/i),
    ).toBeInTheDocument();
  });

  it("renders and revokes authorized applications", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            securityPayload({
              authorizedApplications: [
                {
                  id: "grant-1",
                  appId: "app-importer",
                  name: "Linear Importer",
                  clientId: "lin_client_123",
                  imageUrl: null,
                  scopes: ["read", "write"],
                  webhooksEnabled: true,
                  createdAt: "2026-04-01T10:00:00.000Z",
                  updatedAt: "2026-04-02T10:00:00.000Z",
                },
              ],
            }),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(securityPayload({ authorizedApplications: [] })),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<AccountSecurityPage />);

    expect(await screen.findByText("Linear Importer")).toBeInTheDocument();
    expect(screen.getByText(/App ID: app-importer/)).toBeInTheDocument();
    expect(screen.getByText(/read, write/)).toBeInTheDocument();
    expect(screen.getByText(/Webhooks enabled/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await screen.findByText("Authorized application revoked.");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      action: "revokeAuthorizedApplication",
      applicationId: "grant-1",
    });
    expect(screen.getByText(/No authorized applications/i)).toBeInTheDocument();
  });

  it("does not render API key controls or workspace API settings CTA from account security", async () => {
    const fetchMock = mockSecurityFetch(
      securityPayload({
        apiKeys: [
          {
            id: "api-key-1",
            name: "CLI",
            keyPrefix: "lin_api_123…",
            workspaceName: "Linear QA",
            createdAt: "2026-01-07T10:00:00.000Z",
            lastUsedAt: null,
          },
        ],
      }),
    );

    render(<AccountSecurityPage />);

    await screen.findByRole("heading", { name: "Security & access" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("heading", { name: "API keys" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open workspace API settings" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Personal API keys" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("API key name")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create API key" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("CLI")).not.toBeInTheDocument();
    expect(screen.queryByText(/lin_api_/)).not.toBeInTheDocument();
  });

  it("renders an error state when the account security API fails", async () => {
    mockSecurityFetch({ error: "Unauthorized" }, { status: 401 });

    render(<AccountSecurityPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unauthorized");
  });
});
