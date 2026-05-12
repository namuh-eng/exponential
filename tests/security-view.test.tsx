import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import SecurityPage from "@/app/(app)/settings/security/page";

const mockSecurityData = {
  security: {
    inviteLinkEnabled: true,
    inviteUrl: "https://linear.app/i/test",
    approvedEmailDomains: ["acme.com"],
    authentication: {
      google: true,
      emailPasskey: true,
    },
    permissions: {
      invitationsRole: "admins",
      teamCreationRole: "members",
      labelManagementRole: "admins",
      templateManagementRole: "admins",
      apiKeyCreationRole: "admins",
      agentGuidanceRole: "admins",
    },
    restrictFileUploads: false,
    improveAi: true,
    webSearch: true,
    hipaa: false,
  },
};

describe("SecurityPage UI", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders loading state then security settings", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockSecurityData,
    } as Response);

    render(<SecurityPage />);

    expect(
      screen.getByText("Loading security settings..."),
    ).toBeInTheDocument();

    expect(await screen.findByText("Workspace access")).toBeInTheDocument();
    expect(screen.getByText("acme.com")).toBeInTheDocument();
    expect(screen.getByText("Google authentication")).toBeInTheDocument();
    expect(screen.getByLabelText("New user invitations")).toHaveValue("admins");
    expect(screen.getByLabelText("Team creation")).toHaveValue("members");
  });

  it("toggles invite links and persists", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockSecurityData,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          security: { ...mockSecurityData.security, inviteLinkEnabled: false },
        }),
      } as Response);

    render(<SecurityPage />);
    await screen.findByText("Workspace access");

    const toggle = screen.getByLabelText("Enable invite links");
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/workspaces/current/security",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"inviteLinkEnabled":false'),
        }),
      );
    });
  });

  it("adds an approved email domain", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockSecurityData,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          security: {
            ...mockSecurityData.security,
            approvedEmailDomains: ["acme.com", "test.com"],
          },
        }),
      } as Response);

    render(<SecurityPage />);
    await screen.findByText("Workspace access");

    fireEvent.click(screen.getByLabelText("Add approved email domain"));

    const input = screen.getByPlaceholderText("example.com");
    fireEvent.change(input, { target: { value: "test.com" } });

    const form = screen
      .getByText("Add approved domain")
      .closest("div")
      ?.querySelector("form");
    if (!form) {
      throw new Error("Expected approved domain form");
    }

    fireEvent.submit(form);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/workspaces/current/security",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining(
            '"approvedEmailDomains":["acme.com","test.com"]',
          ),
        }),
      );
    });
  });

  it("removes an approved email domain", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockSecurityData,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          security: {
            ...mockSecurityData.security,
            approvedEmailDomains: [],
          },
        }),
      } as Response);

    render(<SecurityPage />);
    await screen.findByText("Workspace access");

    fireEvent.click(screen.getByLabelText("Remove acme.com"));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/workspaces/current/security",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"approvedEmailDomains":[]'),
        }),
      );
    });
  });

  it("updates a permission level", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockSecurityData,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          security: {
            ...mockSecurityData.security,
            permissions: {
              ...mockSecurityData.security.permissions,
              teamCreationRole: "admins",
            },
          },
        }),
      } as Response);

    render(<SecurityPage />);
    await screen.findByText("Workspace access");

    const select = screen.getByLabelText("Team creation");
    fireEvent.change(select, { target: { value: "admins" } });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/workspaces/current/security",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"teamCreationRole":"admins"'),
        }),
      );
    });
  });
});
