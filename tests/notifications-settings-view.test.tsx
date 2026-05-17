import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    inbox: {
      assignedToMe: true,
      mentionsAndReplies: true,
      subscribedIssues: false,
      teamUpdates: true,
    },
    email: {
      issueActivity: true,
      mentionsAndReplies: true,
      dailyDigest: false,
      weeklyDigest: true,
      productUpdates: false,
      workspaceInvites: true,
    },
    desktop: {
      enabled: true,
      permission: "default",
      issueActivity: true,
      mentionsAndReplies: true,
      reminders: true,
      sound: false,
    },
    slack: {
      enabled: false,
      destination: "not_connected",
      mentionsAndReplies: true,
      assignedToMe: false,
      triageActivity: false,
      projectUpdates: false,
    },
    updatesFromLinear: {
      showInSidebar: true,
      changelogNewsletter: false,
      marketing: true,
    },
    other: { inviteAccepted: true, privacyAndLegalUpdates: true, dpa: false },
  },
};

describe("NotificationsOverviewPage UI", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders Linear-specific notification domains and toggles an update", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
      if (url.toString().includes("/api/account/notifications")) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            init?.method === "PATCH"
              ? JSON.parse(String(init.body))
              : mockNotificationSettings,
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(<NotificationsOverviewPage />);
    await screen.findByText("Notification preferences");
    expect(
      screen.getByRole("link", { name: /Inbox notification settings/ }),
    ).toHaveAttribute("href", "/settings/account/notifications/inbox");
    expect(
      screen.getByText(
        "Manage email delivery, digests, product updates, and invite mail.",
      ),
    ).toBeInTheDocument();

    const sidebarToggle = screen.getByLabelText("Show updates in sidebar");
    fireEvent.click(sidebarToggle);
    await waitFor(() =>
      expect(sidebarToggle).toHaveAttribute("aria-checked", "false"),
    );
  });
});

describe("NotificationChannelPage UI", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders desktop-specific controls and updates a preference", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
      if (url.toString().includes("/api/account/notifications")) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            init?.method === "PATCH"
              ? JSON.parse(String(init.body))
              : mockNotificationSettings,
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(<NotificationChannelPage channel="desktop" />);
    expect(await screen.findByText("Browser permission")).toBeInTheDocument();
    expect(screen.getByText("Desktop delivery")).toBeInTheDocument();
    const sound = screen.getByLabelText("Play notification sound");
    fireEvent.click(sound);
    await waitFor(() => expect(sound).toHaveAttribute("aria-checked", "true"));
  });
});
