const enrollPasskeyMock = vi.hoisted(() => vi.fn());
const browserSupportsPasskeysMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/auth-client", () => ({
  browserSupportsPasskeys: browserSupportsPasskeysMock,
  enrollPasskey: enrollPasskeyMock,
}));

import AccountSecurityPage from "@/app/(app)/settings/account/security/page";
import {
  act,
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
    apiKeys: [],
    canCreateApiKeys: true,
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

  it("renders exponential-parity empty sections and personal API key controls", async () => {
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
      screen.getByRole("heading", { name: "Personal API keys" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("API key name")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create API key" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No personal API keys have been created yet/i),
    ).toBeInTheDocument();
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

  it("adds and revokes passkeys through a visible naming dialog", async () => {
    let finishEnrollment!: (value: { id: string }) => void;
    enrollPasskeyMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishEnrollment = resolve;
      }),
    );

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

    expect(
      screen.getByRole("dialog", { name: "Add passkey" }),
    ).toBeInTheDocument();
    const nameInput = screen.getByLabelText("Passkey name");
    fireEvent.change(nameInput, { target: { value: "Work laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("Starting passkey enrollment…"),
    ).toBeInTheDocument();
    await act(async () => {
      finishEnrollment({ id: "passkey-1" });
    });

    await screen.findByText("Passkey added.");
    expect(enrollPasskeyMock).toHaveBeenCalledWith("Work laptop");
    expect(screen.queryByRole("dialog", { name: "Add passkey" })).toBeNull();
    expect(screen.getByText("Work laptop")).toBeInTheDocument();
    expect(
      screen.getByText(/singleDevice · Device-bound · internal/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({
      action: "revokePasskey",
      passkeyId: "passkey-1",
    });
  });

  it("shows inline feedback when passkey enrollment is cancelled or fails", async () => {
    enrollPasskeyMock.mockRejectedValueOnce(
      new Error("Passkey enrollment was cancelled."),
    );
    mockSecurityFetch(securityPayload());

    render(<AccountSecurityPage />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Add passkey",
      }),
    );
    fireEvent.change(screen.getByLabelText("Passkey name"), {
      target: { value: "Work laptop" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("Passkey enrollment was cancelled."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No passkeys have been added yet/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Add passkey" }),
    ).toBeInTheDocument();
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
                  name: "exponential Importer",
                  clientId: "lin_client_123",
                  imageUrl: null,
                  scopes: ["read", "write"],
                  permissionGroups: [
                    {
                      label: "Workspace data",
                      descriptions: [
                        "View workspace and account information",
                        "Create and update workspace data",
                      ],
                    },
                  ],
                  publisher: null,
                  webhooksEnabled: true,
                  createdAt: "2026-04-01T10:00:00.000Z",
                  updatedAt: "2026-04-02T10:00:00.000Z",
                  lastUsedAt: null,
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

    expect(await screen.findByText("exponential Importer")).toBeInTheDocument();
    expect(screen.queryByText(/App ID: app-importer/)).not.toBeInTheDocument();
    expect(screen.queryByText(/read, write/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/View workspace and account information/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Webhook access/)).toBeInTheDocument();
    expect(screen.getByText(/Last used\s+Unavailable/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(
      screen.getByRole("alertdialog", {
        name: "Confirm revoking exponential Importer",
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm revoke" }));

    await screen.findByText("Authorized application revoked.");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      action: "revokeAuthorizedApplication",
      applicationId: "grant-1",
    });
    expect(screen.getByText(/No authorized applications/i)).toBeInTheDocument();
  });

  it("creates, reveals once, lists, and revokes personal API keys", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
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
              apiKeys: [
                {
                  id: "api-key-1",
                  name: "CLI",
                  keyPrefix: "lin_api_123…",
                  workspaceName: "exponential QA",
                  accessLevel: "Member",
                  createdAt: "2026-01-07T10:00:00.000Z",
                  lastUsedAt: null,
                },
              ],
              createdCredential: {
                kind: "apiKey",
                label: "CLI API key",
                secret: "lin_api_secret_once",
              },
            }),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(securityPayload({ apiKeys: [] })), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<AccountSecurityPage />);

    await screen.findByRole("heading", { name: "Security & access" });

    expect(
      screen.queryByRole("heading", { name: "API keys" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open workspace API settings" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
    fireEvent.change(screen.getByLabelText("API key name"), {
      target: { value: "CLI" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Create API key" })[1],
    );

    await screen.findByText("lin_api_secret_once");
    expect(screen.getByText(/Copy your new API key now/i)).toBeInTheDocument();
    expect(screen.getByText("CLI")).toBeInTheDocument();
    expect(screen.getByText(/lin_api_123…/)).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      action: "createApiKey",
      name: "CLI",
    });

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await screen.findByText("API key revoked.");
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({
      action: "revokeApiKey",
      apiKeyId: "api-key-1",
    });
    expect(screen.queryByText("CLI")).not.toBeInTheDocument();
  });

  it("renders an error state when the account security API fails", async () => {
    mockSecurityFetch({ error: "Unauthorized" }, { status: 401 });

    render(<AccountSecurityPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unauthorized");
  });
});
