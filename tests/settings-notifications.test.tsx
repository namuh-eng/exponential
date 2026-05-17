import {
  NotificationChannelPage,
  NotificationsOverviewPage,
} from "@/app/(app)/settings/account/notifications/notifications-client";
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
  notFound: () => {
    throw new Error("not found");
  },
}));

const accountNotifications = {
  inbox: {
    assignedToMe: true,
    mentionsAndReplies: true,
    subscribedIssues: true,
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
    marketing: false,
  },
  other: {
    inviteAccepted: true,
    privacyAndLegalUpdates: true,
    dpa: false,
  },
};

function mockNotificationsFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/account/notifications" && init?.method === "PATCH") {
      return {
        ok: true,
        json: async () => JSON.parse(String(init.body)),
      } as Response;
    }
    if (url === "/api/account/notifications") {
      return {
        ok: true,
        json: async () => ({ accountNotifications }),
      } as Response;
    }
    throw new Error(`Unhandled fetch: ${url}`);
  });
}

describe("Account notification settings", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders Linear-specific notification domain cards as links", async () => {
    mockNotificationsFetch();
    render(<NotificationsOverviewPage />);

    expect(
      await screen.findByText("Notification preferences"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Inbox notification settings/i }),
    ).toHaveAttribute("href", "/settings/account/notifications/inbox");
    expect(
      screen.getByRole("link", { name: /Email notification settings/i }),
    ).toHaveAttribute("href", "/settings/account/notifications/email");
    expect(
      screen.queryByRole("link", { name: /Mobile notification settings/i }),
    ).not.toBeInTheDocument();
  });

  it("renders desktop-specific controls instead of a generic event matrix", async () => {
    mockNotificationsFetch();
    render(<NotificationChannelPage channel="desktop" />);

    expect(await screen.findByText("Browser permission")).toBeInTheDocument();
    expect(screen.getByText("Desktop delivery")).toBeInTheDocument();
    expect(screen.queryByText("Assignments")).not.toBeInTheDocument();
  });

  it("persists one setting per notification domain", async () => {
    mockNotificationsFetch();
    render(<NotificationChannelPage channel="email" />);

    const digest = await screen.findByLabelText("Daily digest");
    fireEvent.click(digest);

    await waitFor(() => expect(digest).toHaveAttribute("aria-checked", "true"));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/account/notifications",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it.each(["inbox", "email", "desktop", "slack"] as const)(
    "renders domain-specific %s detail sections",
    async (channel) => {
      mockNotificationsFetch();
      render(<NotificationChannelPage channel={channel} />);
      expect(
        await screen.findByRole("heading", {
          level: 1,
          name: /Inbox|Email|Desktop|Slack/,
        }),
      ).toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(
        /Turning off an event prevents this channel/,
      );
    },
  );
});
