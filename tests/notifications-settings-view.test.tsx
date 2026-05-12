import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({}),
}));

import {
  NotificationChannelPage,
  NotificationsOverviewPage,
} from "@/app/(app)/settings/account/notifications/notifications-client";

const mockNotificationSettings = {
  accountNotifications: {
    channels: {
      desktop: {
        enabled: true,
        events: {
          assignments: true,
          statusChanges: true,
          mentions: true,
          comments: true,
        },
      },
      mobile: {
        enabled: false,
        events: {
          assignments: true,
          statusChanges: false,
          mentions: true,
          comments: false,
        },
      },
      email: {
        enabled: true,
        events: {
          assignments: false,
          statusChanges: false,
          mentions: true,
          comments: false,
        },
      },
      slack: {
        enabled: false,
        events: {
          assignments: false,
          statusChanges: false,
          mentions: false,
          comments: false,
        },
      },
    },
    updatesFromLinear: {
      showInSidebar: true,
      newsletter: false,
      marketing: true,
    },
    other: {
      inviteAccepted: true,
      privacyAndLegalUpdates: true,
      dpa: false,
    },
  },
};

describe("NotificationsOverviewPage UI", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders notification settings and toggles an update", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (url.toString().includes("/api/account/notifications")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockNotificationSettings,
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(<NotificationsOverviewPage />);

    // Wait for data
    await screen.findByText("Notifications");

    const sidebarToggle = screen.getByLabelText("Show updates in sidebar");
    expect(sidebarToggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(sidebarToggle);

    await waitFor(() => {
      expect(sidebarToggle).toHaveAttribute("aria-checked", "false");
    });

    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("renders channel status labels correctly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockNotificationSettings,
    } as Response);

    render(<NotificationsOverviewPage />);
    await screen.findByText("Notifications");

    // Desktop: enabled and all events true -> "Enabled for all notifications"
    expect(
      screen.getByText("Enabled for all notifications"),
    ).toBeInTheDocument();

    // Mobile: disabled -> "Disabled"
    expect(screen.getAllByText("Disabled").length).toBeGreaterThan(0);

    // Email: enabled but some events false -> "Enabled for mentions" (based on mock events)
    expect(screen.getByText("Enabled for mentions")).toBeInTheDocument();
  });
});

describe("NotificationChannelPage UI", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders channel settings and updates an event preference", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (url.toString().includes("/api/account/notifications")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockNotificationSettings,
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(<NotificationChannelPage channel="desktop" />);

    // Wait for data
    expect(await screen.findByText("Desktop")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Configure desktop alerts for activity in your workspace.",
      ),
    ).toBeInTheDocument();

    const assignmentsToggle = screen.getByLabelText("Assignments");
    expect(assignmentsToggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(assignmentsToggle);

    await waitFor(() => {
      expect(assignmentsToggle).toHaveAttribute("aria-checked", "false");
    });
  });
});
