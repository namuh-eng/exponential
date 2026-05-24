import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import CustomerRequestsSettingsPage from "@/app/(app)/settings/customer-requests/page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockLoad({
  canManage = true,
  overrides = {},
}: {
  canManage?: boolean;
  overrides?: Record<string, unknown>;
} = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      collaboration: {
        asks: {},
        pulse: {},
        customerRequests: {
          enabled: false,
          intakeEmail: "",
          defaultPriority: "medium",
          autoLinkIssues: true,
          requireCompany: false,
          confirmationMessage:
            "Thanks for the feedback — our product team will review it.",
          ...overrides,
        },
      },
      permissions: { canManage, role: canManage ? "admin" : "member" },
    }),
  });
}

describe("CustomerRequestsSettingsPage component", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("renders persisted customer request controls instead of a placeholder", async () => {
    mockLoad({
      overrides: {
        enabled: true,
        intakeEmail: "feedback@example.com",
        defaultPriority: "high",
        requireCompany: true,
        confirmationMessage: "We will follow up soon.",
      },
    });

    render(<CustomerRequestsSettingsPage />);

    expect(
      screen.getByText("Loading customer request settings..."),
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Customer requests" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("checkbox", { name: "Enable customer requests" }),
    ).toBeChecked();
    expect(
      screen.getByDisplayValue("feedback@example.com"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Default issue priority" }),
    ).toHaveValue("high");
    expect(screen.getByText("Feedback form enabled")).toBeInTheDocument();
    expect(
      screen.queryByText("No requests configured"),
    ).not.toBeInTheDocument();
  });

  it("persists customer request setting changes", async () => {
    mockLoad();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        collaboration: {
          asks: {},
          pulse: {},
          customerRequests: {
            enabled: true,
            intakeEmail: "",
            defaultPriority: "medium",
            autoLinkIssues: true,
            requireCompany: false,
            confirmationMessage:
              "Thanks for the feedback — our product team will review it.",
          },
        },
        permissions: { canManage: true, role: "admin" },
      }),
    });

    render(<CustomerRequestsSettingsPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Enable customer requests" }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Enable customer requests" }),
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch.mock.calls[1][0]).toBe(
      "/api/workspaces/current/collaboration",
    );
    expect(mockFetch.mock.calls[1][1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(String(mockFetch.mock.calls[1][1]?.body))).toMatchObject({
      customerRequests: { enabled: true },
    });
    expect(
      await screen.findByText("Customer request settings saved."),
    ).toBeInTheDocument();
  });

  it("shows read-only admin gating for non-admin members", async () => {
    mockLoad({ canManage: false, overrides: { enabled: true } });

    render(<CustomerRequestsSettingsPage />);

    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Enable customer requests" }),
      ).toBeDisabled(),
    );
    expect(
      screen.getByText(/only workspace admins and owners can edit/i),
    ).toBeInTheDocument();
  });
});
