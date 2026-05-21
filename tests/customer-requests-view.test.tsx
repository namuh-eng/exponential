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

function mockLoad(overrides = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      collaboration: {
        asks: {},
        pulse: {},
        customerRequests: {
          enabled: false,
          intakeEmail: "",
          defaultTeamKey: "",
          linkMode: "suggested",
          autoCreateIssues: true,
          ...overrides,
        },
      },
    }),
  });
}

describe("CustomerRequestsSettingsPage component", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("renders persisted customer request controls instead of a static placeholder", async () => {
    mockLoad({
      enabled: true,
      intakeEmail: "feedback@example.com",
      defaultTeamKey: "SUP",
      linkMode: "automatic",
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
    expect(screen.getByDisplayValue("SUP")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Issue linking behavior" }),
    ).toHaveValue("automatic");
    expect(
      screen.queryByText("No requests configured"),
    ).not.toBeInTheDocument();
  });

  it("persists customer request changes", async () => {
    mockLoad();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        collaboration: {
          customerRequests: {
            enabled: true,
            intakeEmail: "",
            defaultTeamKey: "",
            linkMode: "suggested",
            autoCreateIssues: true,
          },
        },
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
});
