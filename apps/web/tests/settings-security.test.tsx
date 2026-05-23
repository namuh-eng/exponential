import "@testing-library/jest-dom/vitest";
import SecurityPage from "@/app/(app)/settings/security/page";
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

function buildSecurity(
  overrides: Partial<ReturnType<typeof defaultSecurity>> = {},
) {
  return {
    ...defaultSecurity(),
    ...overrides,
    authentication: {
      ...defaultSecurity().authentication,
      ...overrides.authentication,
    },
    permissions: {
      ...defaultSecurity().permissions,
      ...overrides.permissions,
    },
  };
}

type TestSecurity = {
  inviteLinkEnabled: boolean;
  inviteUrl: string;
  approvedEmailDomains: string[];
  authentication: {
    google: boolean;
    emailPasskey: boolean;
  };
  permissions: {
    invitationsRole: "admins" | "members" | "anyone";
    teamCreationRole: "admins" | "members" | "anyone";
    labelManagementRole: "admins" | "members" | "anyone";
    templateManagementRole: "admins" | "members" | "anyone";
    apiKeyCreationRole: "admins" | "members" | "anyone";
    agentGuidanceRole: "admins" | "members" | "anyone";
  };
  restrictFileUploads: boolean;
  improveAi: boolean;
  webSearch: boolean;
  hipaa: boolean;
};

function defaultSecurity(): TestSecurity {
  return {
    inviteLinkEnabled: true,
    inviteUrl: "http://localhost:3015/accept-invite?token=invite-token",
    approvedEmailDomains: [] as string[],
    authentication: {
      google: true,
      emailPasskey: true,
    },
    permissions: {
      invitationsRole: "members" as const,
      teamCreationRole: "members" as const,
      labelManagementRole: "members" as const,
      templateManagementRole: "members" as const,
      apiKeyCreationRole: "admins" as const,
      agentGuidanceRole: "admins" as const,
    },
    restrictFileUploads: false,
    improveAi: true,
    webSearch: true,
    hipaa: false,
  };
}

function mockSecurityLoad(
  overrides: Partial<ReturnType<typeof defaultSecurity>> = {},
) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      security: buildSecurity(overrides),
    }),
  });
}

function mockPatchResponse(
  overrides: Partial<ReturnType<typeof defaultSecurity>>,
) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      security: buildSecurity(overrides),
    }),
  });
}

function waitForLoaded() {
  return waitFor(() => {
    expect(
      screen.queryByText("Loading security settings..."),
    ).not.toBeInTheDocument();
  });
}

describe("Security settings page", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders persisted security settings from the API", async () => {
    mockSecurityLoad({
      approvedEmailDomains: ["acme.com"],
      authentication: { google: false, emailPasskey: true },
    });

    render(<SecurityPage />);
    await waitForLoaded();

    expect(
      screen.getByRole("heading", { name: "Security" }),
    ).toBeInTheDocument();
    expect(screen.getByText("acme.com")).toBeInTheDocument();
    expect(screen.getByText(defaultSecurity().inviteUrl)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /SAML & SCIM management/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Google authentication" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("persists invite link changes through the security API", async () => {
    mockSecurityLoad();
    mockPatchResponse({
      inviteLinkEnabled: false,
    });

    render(<SecurityPage />);
    await waitForLoaded();

    fireEvent.click(
      screen.getByRole("switch", { name: "Enable invite links" }),
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    const request = mockFetch.mock.calls[1];
    expect(request[0]).toBe("/api/workspaces/current/security");
    expect(request[1]).toMatchObject({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({
      inviteLinkEnabled: false,
    });
    expect(
      screen.queryByText(defaultSecurity().inviteUrl),
    ).not.toBeInTheDocument();
  });

  it("adds an approved email domain through the modal flow", async () => {
    mockSecurityLoad();
    mockPatchResponse({
      approvedEmailDomains: ["example.com"],
    });

    render(<SecurityPage />);
    await waitForLoaded();

    fireEvent.click(screen.getByLabelText("Add approved email domain"));
    fireEvent.change(screen.getByLabelText("Domain"), {
      target: { value: "Example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add domain" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    const request = mockFetch.mock.calls[1];
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({
      approvedEmailDomains: ["example.com"],
    });
    expect(screen.getByText("example.com")).toBeInTheDocument();
  });

  it("persists workspace management permission changes", async () => {
    mockSecurityLoad();
    mockPatchResponse({
      permissions: {
        ...defaultSecurity().permissions,
        invitationsRole: "anyone",
      },
    });

    render(<SecurityPage />);
    await waitForLoaded();

    fireEvent.change(screen.getByLabelText("New user invitations"), {
      target: { value: "anyone" },
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const request = mockFetch.mock.calls[1];
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({
      permissions: expect.objectContaining({
        invitationsRole: "anyone",
      }),
    });
  });
});
