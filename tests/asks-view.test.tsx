import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import AsksSettingsPage from "@/app/(app)/settings/asks/page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockLoad(overrides = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      collaboration: {
        asks: {
          enabled: false,
          intakeEmail: "",
          defaultPriority: "medium",
          autoAssign: true,
          ...overrides,
        },
        pulse: {},
      },
    }),
  });
}

describe("AsksSettingsPage component", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("renders persisted asks controls instead of an unavailable placeholder", async () => {
    mockLoad({
      enabled: true,
      intakeEmail: "help@example.com",
      defaultPriority: "high",
    });
    render(<AsksSettingsPage />);

    expect(screen.getByText("Loading Asks settings...")).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Asks" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("checkbox", { name: "Enable Asks" })).toBeChecked();
    expect(screen.getByDisplayValue("help@example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Default priority" }),
    ).toHaveValue("high");
    expect(screen.queryByText("No asks configured")).not.toBeInTheDocument();
  });

  it("persists asks changes", async () => {
    mockLoad();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        collaboration: {
          asks: {
            enabled: true,
            intakeEmail: "",
            defaultPriority: "medium",
            autoAssign: true,
          },
          pulse: {},
        },
      }),
    });

    render(<AsksSettingsPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Enable Asks" }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Enable Asks" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch.mock.calls[1][0]).toBe(
      "/api/workspaces/current/collaboration",
    );
    expect(mockFetch.mock.calls[1][1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(String(mockFetch.mock.calls[1][1]?.body))).toMatchObject({
      asks: { enabled: true },
    });
    expect(await screen.findByText("Asks settings saved.")).toBeInTheDocument();
  });
});
