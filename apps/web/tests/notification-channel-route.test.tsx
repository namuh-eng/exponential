import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ channel: "desktop" }),
  notFound: vi.fn(),
}));

import NotificationChannelSettingsPage from "@/app/(app)/settings/account/notifications/[channel]/page";
import { NotificationChannelPage } from "@/app/(app)/settings/account/notifications/notifications-client";

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
    },
  },
};

describe("NotificationChannelSettingsPage (Route)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the notification channel page for a valid channel", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockNotificationSettings,
    } as Response);

    const Page = await NotificationChannelSettingsPage({
      params: Promise.resolve({ channel: "desktop" }),
    });

    render(Page);

    expect(await screen.findByText("Desktop")).toBeInTheDocument();
  });

  it("calls notFound for an invalid channel", async () => {
    const { notFound } = await import("next/navigation");

    await NotificationChannelSettingsPage({
      params: Promise.resolve({ channel: "invalid-channel" }),
    });

    expect(notFound).toHaveBeenCalled();
  });
});
