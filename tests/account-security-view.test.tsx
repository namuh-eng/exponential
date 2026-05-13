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
    apiKeys: [],
    authorizedApplications: [],
    canCreateApiKeys: true,
    activeWorkspace: { id: "workspace-1", name: "Linear QA" },
    ...overrides,
  };
}

describe("AccountSecurityPage component", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
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
      screen.getByRole("heading", { name: "Personal API keys" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Authorized applications" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No active sessions were found for this account."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No personal API keys have been created."),
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

  it("creates and revokes personal API keys with one-time token reveal", async () => {
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
                  workspaceName: "Linear QA",
                  createdAt: "2026-01-07T10:00:00.000Z",
                  lastUsedAt: null,
                },
              ],
              createdApiKey: { label: "CLI API key", token: "lin_api_secret" },
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
    await screen.findByRole("heading", { name: "Personal API keys" });

    fireEvent.change(screen.getByLabelText("API key name"), {
      target: { value: "CLI" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));

    await screen.findByText("lin_api_secret");
    expect(screen.getByText("CLI")).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      action: "createApiKey",
      name: "CLI",
    });

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({
      action: "revokeApiKey",
      apiKeyId: "api-key-1",
    });
  });

  it("renders an error state when the account security API fails", async () => {
    mockSecurityFetch({ error: "Unauthorized" }, { status: 401 });

    render(<AccountSecurityPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unauthorized");
  });
});
