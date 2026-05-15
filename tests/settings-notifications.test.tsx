import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { NotificationChannelPage } from "@/app/(app)/settings/account/notifications/notifications-client";
import NotificationsSettingsPage from "@/app/(app)/settings/account/notifications/page";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/settings/account/notifications",
}));

describe("Account Notifications Page", () => {
  it("renders Notifications heading", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (url === "/api/account/notifications" && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            accountNotifications: {
              updatesFromLinear: {
                showInSidebar: true,
                newsletter: false,
                marketing: false,
              },
            },
          }),
        } as Response;
      }

      if (url === "/api/account/notifications" && init?.method === "PATCH") {
        return {
          ok: true,
          json: async () => JSON.parse(String(init.body)),
        } as Response;
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<NotificationsSettingsPage />);
    expect(
      screen.getByRole("heading", { name: "Notifications" }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Desktop notification settings" }),
      ).toHaveAttribute("href", "/settings/account/notifications/desktop");
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders notification channel cards as links", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (url === "/api/account/notifications" && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            accountNotifications: {
              channels: {
                mobile: {
                  events: {
                    assignments: true,
                    statusChanges: true,
                    mentions: true,
                    comments: true,
                  },
                },
              },
            },
          }),
        } as Response;
      }

      if (url === "/api/account/notifications" && init?.method === "PATCH") {
        return {
          ok: true,
          json: async () => JSON.parse(String(init.body)),
        } as Response;
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<NotificationsSettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Choose which channels can deliver workspace activity. Notification delivery follows the event preferences configured for each channel.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Desktop notification settings" }),
      ).toBeInTheDocument();
    });
    expect(document.body).not.toHaveTextContent(/\b(clone|demo)\b/i);
    expect(
      screen.getByRole("link", { name: "Mobile notification settings" }),
    ).toHaveAttribute("href", "/settings/account/notifications/mobile");
    expect(
      screen.getByRole("link", { name: "Email notification settings" }),
    ).toHaveAttribute("href", "/settings/account/notifications/email");
    expect(
      screen.getByRole("link", { name: "Slack notification settings" }),
    ).toHaveAttribute("href", "/settings/account/notifications/slack");
  });

  it("shows enabled/disabled status on channels", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (url === "/api/account/notifications" && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            accountNotifications: {
              channels: {
                desktop: {
                  events: {
                    assignments: true,
                    statusChanges: true,
                    mentions: true,
                    comments: false,
                  },
                },
                mobile: {
                  events: {
                    assignments: true,
                    statusChanges: true,
                    mentions: true,
                    comments: true,
                  },
                },
              },
            },
          }),
        } as Response;
      }

      if (url === "/api/account/notifications" && init?.method === "PATCH") {
        return {
          ok: true,
          json: async () => JSON.parse(String(init.body)),
        } as Response;
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<NotificationsSettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Enabled for assignments, status changes, and 9 others",
        ),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText("Enabled for all notifications"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Enabled for assignments, mentions, and 4 others"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Enabled for mentions, comments and replies, and 3 others",
      ),
    ).toBeInTheDocument();
  });

  it("renders Updates from Linear section", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (url === "/api/account/notifications" && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            accountNotifications: {
              updatesFromLinear: {
                showInSidebar: true,
                newsletter: false,
                marketing: false,
              },
            },
          }),
        } as Response;
      }

      if (url === "/api/account/notifications" && init?.method === "PATCH") {
        return {
          ok: true,
          json: async () => JSON.parse(String(init.body)),
        } as Response;
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<NotificationsSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Updates from Linear")).toBeInTheDocument();
    });
    expect(screen.getByText("Changelog")).toBeInTheDocument();
    expect(screen.getByText("Show updates in sidebar")).toBeInTheDocument();
    expect(screen.getByText("Changelog newsletter")).toBeInTheDocument();
    expect(screen.getByText("Marketing")).toBeInTheDocument();
  });

  it("renders Other section with toggles", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (url === "/api/account/notifications" && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            accountNotifications: {
              other: {
                inviteAccepted: true,
                privacyAndLegalUpdates: true,
                dpa: false,
              },
            },
          }),
        } as Response;
      }

      if (url === "/api/account/notifications" && init?.method === "PATCH") {
        return {
          ok: true,
          json: async () => JSON.parse(String(init.body)),
        } as Response;
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<NotificationsSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Other")).toBeInTheDocument();
    });
    expect(screen.getByText("Invite accepted")).toBeInTheDocument();
    expect(screen.getByText("Privacy and legal updates")).toBeInTheDocument();
    expect(screen.getByText("DPA")).toBeInTheDocument();
  });

  it("persists root-level toggles to the notifications API", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);

        if (url === "/api/account/notifications" && !init?.method) {
          return {
            ok: true,
            json: async () => ({
              accountNotifications: {
                updatesFromLinear: {
                  showInSidebar: true,
                  newsletter: false,
                  marketing: false,
                },
              },
            }),
          } as Response;
        }

        if (url === "/api/account/notifications" && init?.method === "PATCH") {
          return {
            ok: true,
            json: async () => JSON.parse(String(init.body)),
          } as Response;
        }

        throw new Error(`Unhandled fetch: ${url}`);
      });

    render(<NotificationsSettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: "Marketing" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("switch", { name: "Marketing" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/account/notifications",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"marketing":true'),
        }),
      );
    });
  });

  it("renders and persists per-event channel configuration", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);

        if (url === "/api/account/notifications" && !init?.method) {
          return {
            ok: true,
            json: async () => ({
              accountNotifications: {
                channels: {
                  desktop: {
                    events: {
                      assignments: true,
                      statusChanges: true,
                      mentions: true,
                      comments: false,
                    },
                  },
                },
              },
            }),
          } as Response;
        }

        if (url === "/api/account/notifications" && init?.method === "PATCH") {
          return {
            ok: true,
            json: async () => JSON.parse(String(init.body)),
          } as Response;
        }

        throw new Error(`Unhandled fetch: ${url}`);
      });

    render(<NotificationChannelPage channel="desktop" />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Desktop" }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Assignments")).toBeInTheDocument();
    expect(screen.getByText("Status changes")).toBeInTheDocument();
    expect(screen.getByText("Mentions")).toBeInTheDocument();
    expect(screen.getByText("Comments and replies")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Turning off an event prevents this channel from sending notifications for that activity. If all channels are disabled for an event, you won't receive notifications for it.",
      ),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/\b(clone|demo)\b/i);

    fireEvent.click(
      screen.getByRole("switch", { name: "Comments and replies" }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/account/notifications",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"comments":true'),
        }),
      );
    });
  });

  it.each(["desktop", "mobile", "email", "slack"] as const)(
    "renders production channel explanation copy for %s notifications",
    async (channel) => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = String(input);

        if (url === "/api/account/notifications" && !init?.method) {
          return {
            ok: true,
            json: async () => ({ accountNotifications: {} }),
          } as Response;
        }

        if (url === "/api/account/notifications" && init?.method === "PATCH") {
          return {
            ok: true,
            json: async () => JSON.parse(String(init.body)),
          } as Response;
        }

        throw new Error(`Unhandled fetch: ${url}`);
      });

      render(<NotificationChannelPage channel={channel} />);

      await waitFor(() => {
        expect(
          screen.getByText(
            "Turning off an event prevents this channel from sending notifications for that activity. If all channels are disabled for an event, you won't receive notifications for it.",
          ),
        ).toBeInTheDocument();
      });
      expect(document.body).not.toHaveTextContent(/\b(clone|demo)\b/i);
      expect(document.body).not.toHaveTextContent(/suppresses/i);
    },
  );
});
