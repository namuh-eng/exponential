import "@testing-library/jest-dom/vitest";
import ApiSettingsPage from "@/app/(app)/settings/api/page";
import type { ApiSettingsPayload } from "@/lib/api-settings";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function buildApiSettings(
  overrides: Partial<ApiSettingsPayload> = {},
): ApiSettingsPayload {
  return {
    permissionLevel: "admins",
    viewerRole: "owner",
    canManageWorkspaceApi: true,
    canCreateApiKeys: true,
    docs: {
      graphql: "https://linear.app/developers/graphql",
      oauthApplications:
        "https://linear.app/developers/oauth-2-0-authentication",
      webhooks: "https://linear.app/developers/webhooks",
    },
    oauthApplications: [],
    webhooks: [],
    apiKeys: [],
    ...overrides,
  };
}

function mockApiLoad(overrides: Partial<ApiSettingsPayload> = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      api: buildApiSettings(overrides),
    }),
  });
}

function mockMutationResponse(overrides: Partial<ApiSettingsPayload> = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      api: buildApiSettings(overrides),
    }),
  });
}

function waitForLoaded() {
  return waitFor(() => {
    expect(
      screen.queryByText("Loading API settings..."),
    ).not.toBeInTheDocument();
  });
}

describe("API settings page", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders persisted API settings with clickable docs links", async () => {
    mockApiLoad({
      oauthApplications: [
        {
          id: "oauth_1",
          name: "Partner portal",
          clientId: "lin_123",
          clientSecretPreview: "linsec_123…",
          redirectUrl: "https://example.com/oauth/callback",
          createdAt: "2026-04-08T10:00:00.000Z",
        },
      ],
    });

    render(<ApiSettingsPage />);
    await waitForLoaded();

    expect(screen.getByRole("heading", { name: "API" })).toBeInTheDocument();
    expect(
      screen.getByText(/programmable interface to your data/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Partner portal")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Docs ↗" })[0]).toHaveAttribute(
      "href",
      "https://linear.app/developers/graphql",
    );
    expect(
      screen.getByRole("combobox", { name: "API key creation permission" }),
    ).toHaveValue("admins");
  });

  it("persists API key creation permission changes", async () => {
    mockApiLoad();
    mockMutationResponse({
      permissionLevel: "members",
    });

    render(<ApiSettingsPage />);
    await waitForLoaded();

    fireEvent.change(
      screen.getByRole("combobox", { name: "API key creation permission" }),
      {
        target: { value: "members" },
      },
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    const request = mockFetch.mock.calls[1];
    expect(request[0]).toBe("/api/workspaces/current/api");
    expect(request[1]).toMatchObject({
      method: "PATCH",
    });
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({
      permissionLevel: "members",
    });
  });

  it("opens the OAuth modal with an empty redirect URL and placeholder example only", async () => {
    mockApiLoad();

    render(<ApiSettingsPage />);
    await waitForLoaded();

    fireEvent.click(
      screen.getByRole("button", { name: "New OAuth application" }),
    );

    const redirectInput = screen.getByLabelText("Redirect URL");
    expect(redirectInput).toHaveValue("");
    expect(redirectInput).toHaveAttribute(
      "placeholder",
      "https://example.com/oauth/callback",
    );
  });

  it("does not submit OAuth creation when only application name is filled", async () => {
    mockApiLoad();

    render(<ApiSettingsPage />);
    await waitForLoaded();

    fireEvent.click(
      screen.getByRole("button", { name: "New OAuth application" }),
    );
    fireEvent.change(screen.getByLabelText("Application name"), {
      target: { value: "Partner portal" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create OAuth application" }),
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Redirect URL is required.")).toBeInTheDocument();
    expect(
      screen.queryByText("OAuth application created."),
    ).not.toBeInTheDocument();
  });

  it("blocks unsafe OAuth redirect URLs before sending the modal request", async () => {
    mockApiLoad();

    render(<ApiSettingsPage />);
    await waitForLoaded();

    fireEvent.click(
      screen.getByRole("button", { name: "New OAuth application" }),
    );
    fireEvent.change(screen.getByLabelText("Application name"), {
      target: { value: "Partner portal" },
    });
    fireEvent.change(screen.getByLabelText("Redirect URL"), {
      target: { value: "http://localhost:3015/oauth/callback" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create OAuth application" }),
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Redirect URL must use HTTPS."),
    ).toBeInTheDocument();
  });

  it("creates an OAuth application from the modal flow", async () => {
    mockApiLoad();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        api: buildApiSettings({
          oauthApplications: [
            {
              id: "oauth_1",
              name: "Partner portal",
              clientId: "lin_123",
              clientSecretPreview: "linsec_123…",
              redirectUrl: "https://example.com/oauth/callback",
              createdAt: "2026-04-08T10:00:00.000Z",
            },
          ],
        }),
        createdCredential: {
          label: "Partner portal client secret",
          secret: "linsec_secret",
        },
      }),
    });

    render(<ApiSettingsPage />);
    await waitForLoaded();

    fireEvent.click(
      screen.getByRole("button", { name: "New OAuth application" }),
    );
    fireEvent.change(screen.getByLabelText("Application name"), {
      target: { value: "Partner portal" },
    });
    fireEvent.change(screen.getByLabelText("Redirect URL"), {
      target: { value: "https://example.com/oauth/callback" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create OAuth application" }),
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const request = mockFetch.mock.calls[1];
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({
      action: "createOAuthApplication",
      name: "Partner portal",
      redirectUrl: "https://example.com/oauth/callback",
    });
    expect(screen.getByText("Partner portal")).toBeInTheDocument();
    expect(screen.getByText("linsec_secret")).toBeInTheDocument();
  });

  it("creates a webhook with selected events", async () => {
    mockApiLoad();
    mockMutationResponse({
      webhooks: [
        {
          id: "wh_1",
          label: "Issue sync",
          url: "https://example.com/hooks/linear",
          events: ["created", "deleted"],
          enabled: true,
          createdAt: "2026-04-08T10:00:00.000Z",
          updatedAt: "2026-04-08T10:00:00.000Z",
        },
      ],
    });

    render(<ApiSettingsPage />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: "New webhook" }));
    fireEvent.change(screen.getByLabelText("Webhook name"), {
      target: { value: "Issue sync" },
    });
    fireEvent.change(screen.getByLabelText("Endpoint URL"), {
      target: { value: "https://example.com/hooks/linear" },
    });
    fireEvent.click(screen.getByLabelText("Entity updated"));
    fireEvent.click(screen.getByLabelText("Entity deleted"));
    fireEvent.click(screen.getByRole("button", { name: "Create webhook" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(mockFetch.mock.calls[1][1]?.body))).toMatchObject({
      action: "createWebhook",
      label: "Issue sync",
      url: "https://example.com/hooks/linear",
      events: ["created", "deleted"],
    });
  });

  it("creates an API key and renders it in the list", async () => {
    mockApiLoad();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        api: buildApiSettings({
          apiKeys: [
            {
              id: "key_1",
              name: "Workspace automation",
              keyPrefix: "lin_api_123…",
              accessLevel: "Member",
              createdAt: "2026-04-08T10:00:00.000Z",
              lastUsedAt: null,
              creator: {
                name: "QA User",
                email: "qa@example.com",
                image: null,
              },
            },
          ],
        }),
        createdCredential: {
          label: "Workspace automation API key",
          secret: "lin_api_secret",
        },
      }),
    });

    render(<ApiSettingsPage />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
    fireEvent.change(screen.getByLabelText("Key name"), {
      target: { value: "Workspace automation" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Create API key" })[1],
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(mockFetch.mock.calls[1][1]?.body))).toMatchObject({
      action: "createApiKey",
      name: "Workspace automation",
    });
    expect(screen.getByText("Workspace automation")).toBeInTheDocument();
    expect(screen.getByText("lin_api_secret")).toBeInTheDocument();
  });
});
