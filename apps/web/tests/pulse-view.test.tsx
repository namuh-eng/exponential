import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import PulseSettingsPage from "@/app/(app)/settings/pulse/page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockLoad(overrides = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      collaboration: {
        asks: {},
        pulse: {
          enabled: true,
          digestFrequency: "weekly",
          burnoutAlerts: true,
          velocityTarget: 40,
          ...overrides,
        },
      },
    }),
  });
}

describe("PulseSettingsPage component", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("renders persisted pulse controls instead of a static empty state", async () => {
    mockLoad({ digestFrequency: "daily", velocityTarget: 25 });
    render(<PulseSettingsPage />);

    expect(screen.getByText("Loading Pulse settings...")).toBeInTheDocument();

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Pulse" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("checkbox", { name: "Enable Pulse insights" }),
    ).toBeChecked();
    expect(
      screen.getByRole("combobox", { name: "Digest frequency" }),
    ).toHaveValue("daily");
    expect(
      screen.getByRole("spinbutton", { name: "Velocity target" }),
    ).toHaveValue(25);
    expect(screen.queryByText("Pulse is ready")).not.toBeInTheDocument();
  });

  it("persists pulse changes", async () => {
    mockLoad();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        collaboration: {
          asks: {},
          pulse: {
            enabled: true,
            digestFrequency: "daily",
            burnoutAlerts: true,
            velocityTarget: 40,
          },
        },
      }),
    });

    render(<PulseSettingsPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Digest frequency" }),
      ).toBeInTheDocument(),
    );

    fireEvent.change(
      screen.getByRole("combobox", { name: "Digest frequency" }),
      { target: { value: "daily" } },
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch.mock.calls[1][0]).toBe(
      "/api/workspaces/current/collaboration",
    );
    expect(JSON.parse(String(mockFetch.mock.calls[1][1]?.body))).toMatchObject({
      pulse: { digestFrequency: "daily" },
    });
    expect(
      await screen.findByText("Pulse settings saved."),
    ).toBeInTheDocument();
  });
});
