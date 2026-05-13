import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({}),
}));

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

import { NotificationRow } from "@/components/notification-row";

afterEach(cleanup);

describe("NotificationRow", () => {
  const defaultProps = {
    id: "n1",
    type: "assigned" as const,
    actorName: "Ashley Ha",
    actorImage: null as string | null,
    issueIdentifier: "ENG-136",
    issueTitle: "Add dark mode support",
    readAt: null as string | null,
    createdAt: new Date().toISOString(),
    isSelected: false,
    onClick: vi.fn(),
  };

  it("renders actor name", () => {
    render(<NotificationRow {...defaultProps} />);
    expect(screen.getByText("Ashley Ha")).toBeDefined();
  });

  it("renders issue identifier", () => {
    render(<NotificationRow {...defaultProps} />);
    expect(screen.getByText("ENG-136")).toBeDefined();
  });

  it("renders issue title", () => {
    render(<NotificationRow {...defaultProps} />);
    expect(screen.getByText("Add dark mode support")).toBeDefined();
  });

  it("renders action description for assigned type", () => {
    render(<NotificationRow {...defaultProps} type="assigned" />);
    expect(screen.getByText(/assigned the issue to you/)).toBeDefined();
  });

  it("renders action description for mentioned type", () => {
    render(<NotificationRow {...defaultProps} type="mentioned" />);
    expect(screen.getByText(/mentioned you/)).toBeDefined();
  });

  it("renders action description for status_change type", () => {
    render(<NotificationRow {...defaultProps} type="status_change" />);
    expect(screen.getByText(/changed the status/)).toBeDefined();
  });

  it("renders action description for comment type", () => {
    render(<NotificationRow {...defaultProps} type="comment" />);
    expect(screen.getByText(/commented on/)).toBeDefined();
  });

  it("renders action description for duplicate type", () => {
    render(<NotificationRow {...defaultProps} type="duplicate" />);
    expect(screen.getByText(/marked as duplicate/)).toBeDefined();
  });

  it("renders unread indicator when readAt is null", () => {
    render(<NotificationRow {...defaultProps} readAt={null} />);
    expect(screen.getByTestId("unread-dot")).toBeDefined();
  });

  it("hides unread indicator when readAt is set", () => {
    render(<NotificationRow {...defaultProps} readAt="2026-01-01T00:00:00Z" />);
    expect(screen.queryByTestId("unread-dot")).toBeNull();
  });

  it("renders actor avatar initials", () => {
    render(<NotificationRow {...defaultProps} />);
    expect(screen.getByText("AH")).toBeDefined();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<NotificationRow {...defaultProps} onClick={onClick} />);
    fireEvent.click(screen.getByTestId("notification-row"));
    expect(onClick).toHaveBeenCalledWith("n1");
  });

  it("applies selected style when isSelected", () => {
    render(<NotificationRow {...defaultProps} isSelected={true} />);
    const row = screen.getByTestId("notification-row");
    expect(row.className).toContain("bg-");
  });

  it("renders relative timestamp", () => {
    const pastDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    render(<NotificationRow {...defaultProps} createdAt={pastDate} />);
    expect(screen.getByText(/2h/)).toBeDefined();
  });
});

describe("Inbox page", () => {
  it("shows empty state when no notifications", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ notifications: [], unreadCount: 0 }),
    }) as unknown as typeof fetch;

    const { default: InboxPage } = await import("@/app/(app)/inbox/page");
    render(<InboxPage />);

    await vi.waitFor(() => {
      expect(screen.getByText("You're all caught up")).toBeDefined();
    });
  });

  it("shows all-read notification history with a no unread footer", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          notifications: [
            {
              id: "n-history-1",
              type: "assigned",
              actorName: "Ashley Ha",
              actorImage: null,
              issueIdentifier: "ENG-136",
              issueTitle: "Improve Forever Browsing agent inbox handoff",
              issuePriority: "medium",
              readAt: "2026-05-02T20:00:00.000Z",
              createdAt: "2026-05-02T19:00:00.000Z",
            },
          ],
          unreadCount: 0,
        }),
    }) as unknown as typeof fetch;

    cleanup();
    vi.resetModules();
    const { default: InboxPage } = await import("@/app/(app)/inbox/page");
    render(<InboxPage />);

    await vi.waitFor(() => {
      expect(screen.queryByText("You're all caught up")).toBeNull();
      expect(screen.getAllByText("ENG-136").length).toBeGreaterThan(0);
      expect(screen.getByText("No unread notifications")).toBeDefined();
    });
  });

  it("renders notification list when notifications exist", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          notifications: [
            {
              id: "n1",
              type: "assigned",
              actorName: "Ashley Ha",
              actorImage: null,
              issueIdentifier: "ENG-136",
              issueTitle: "Add dark mode support",
              issuePriority: "high",
              readAt: null,
              createdAt: new Date().toISOString(),
            },
          ],
          unreadCount: 1,
        }),
    }) as unknown as typeof fetch;

    cleanup();
    vi.resetModules();
    const { default: InboxPage } = await import("@/app/(app)/inbox/page");
    render(<InboxPage />);

    await vi.waitFor(() => {
      expect(screen.getAllByText("ENG-136").length).toBeGreaterThan(0);
    });
  });

  it("renders inbox header with unread count", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          notifications: [
            {
              id: "n1",
              type: "assigned",
              actorName: "Ashley Ha",
              actorImage: null,
              issueIdentifier: "ENG-136",
              issueTitle: "Fix bug",
              issuePriority: "high",
              readAt: null,
              createdAt: new Date().toISOString(),
            },
          ],
          unreadCount: 1,
        }),
    }) as unknown as typeof fetch;

    cleanup();
    vi.resetModules();
    const { default: InboxPage } = await import("@/app/(app)/inbox/page");
    render(<InboxPage />);

    await vi.waitFor(() => {
      expect(screen.getByText("Inbox")).toBeDefined();
      expect(screen.getByText(/1 unread/)).toBeDefined();
    });
  });

  it("renders inbox filter and sort controls", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          notifications: [
            {
              id: "n1",
              type: "assigned",
              actorName: "Ashley Ha",
              actorImage: null,
              issueIdentifier: "ENG-136",
              issueTitle: "Fix bug",
              issuePriority: "high",
              readAt: null,
              createdAt: new Date().toISOString(),
            },
          ],
          unreadCount: 1,
        }),
    }) as unknown as typeof fetch;

    cleanup();
    vi.resetModules();
    const { default: InboxPage } = await import("@/app/(app)/inbox/page");
    render(<InboxPage />);

    await vi.waitFor(() => {
      expect(
        screen.getByRole("button", { name: /filter inbox notifications/i }),
      ).toBeDefined();
      expect(
        screen.getByRole("button", {
          name: /sort inbox notifications by priority/i,
        }),
      ).toBeDefined();
    });
  });

  it("filters the list down to unread notifications", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          notifications: [
            {
              id: "n1",
              type: "assigned",
              actorName: "Ashley Ha",
              actorImage: null,
              issueIdentifier: "ENG-136",
              issueTitle: "Unread issue",
              issuePriority: "high",
              readAt: null,
              createdAt: new Date().toISOString(),
            },
            {
              id: "n2",
              type: "comment",
              actorName: "MCP",
              actorImage: null,
              issueIdentifier: "ENG-140",
              issueTitle: "Read issue",
              issuePriority: "low",
              readAt: "2026-01-01T00:00:00Z",
              createdAt: new Date().toISOString(),
            },
          ],
          unreadCount: 1,
        }),
    }) as unknown as typeof fetch;

    cleanup();
    vi.resetModules();
    const { default: InboxPage } = await import("@/app/(app)/inbox/page");
    render(<InboxPage />);

    await vi.waitFor(() => {
      expect(screen.getAllByText("Unread issue").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Read issue").length).toBeGreaterThan(0);
    });

    fireEvent.click(
      screen.getByRole("button", { name: /filter inbox notifications/i }),
    );

    await vi.waitFor(() => {
      expect(screen.getAllByText("Unread issue").length).toBeGreaterThan(0);
      expect(screen.queryByText("Read issue")).toBeNull();
    });
  });

  it("sorts notifications by issue priority when enabled", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          notifications: [
            {
              id: "n1",
              type: "assigned",
              actorName: "Ashley Ha",
              actorImage: null,
              issueIdentifier: "ENG-136",
              issueTitle: "Low priority issue",
              issuePriority: "low",
              readAt: null,
              createdAt: "2026-04-07T02:00:00.000Z",
            },
            {
              id: "n2",
              type: "assigned",
              actorName: "Ashley Ha",
              actorImage: null,
              issueIdentifier: "ENG-137",
              issueTitle: "Urgent issue",
              issuePriority: "urgent",
              readAt: null,
              createdAt: "2026-04-07T01:00:00.000Z",
            },
          ],
          unreadCount: 2,
        }),
    }) as unknown as typeof fetch;

    cleanup();
    vi.resetModules();
    const { default: InboxPage } = await import("@/app/(app)/inbox/page");
    const { container } = render(<InboxPage />);

    await vi.waitFor(() => {
      expect(screen.getAllByText("Low priority issue").length).toBeGreaterThan(
        0,
      );
      expect(screen.getAllByText("Urgent issue").length).toBeGreaterThan(0);
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /sort inbox notifications by priority/i,
      }),
    );

    await vi.waitFor(() => {
      const titles = Array.from(
        container.querySelectorAll("[data-testid='notification-row']"),
      ).map((row) => row.textContent ?? "");
      expect(titles[0]).toContain("Urgent issue");
      expect(titles[1]).toContain("Low priority issue");
    });
  });

  it("marks unread notifications as read when selected", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            notifications: [
              {
                id: "n1",
                type: "assigned",
                actorName: "Ashley Ha",
                actorImage: null,
                issueIdentifier: "ENG-136",
                issueTitle: "Fix bug",
                issuePriority: "high",
                readAt: null,
                createdAt: new Date().toISOString(),
              },
            ],
            unreadCount: 1,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      }) as unknown as typeof fetch;

    cleanup();
    vi.resetModules();
    const { default: InboxPage } = await import("@/app/(app)/inbox/page");
    render(<InboxPage />);

    await vi.waitFor(() => {
      expect(screen.getByText(/1 unread/)).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("notification-row"));

    await vi.waitFor(() => {
      expect(screen.queryByText(/1 unread/)).toBeNull();
    });
    expect(global.fetch).toHaveBeenCalledWith("/api/notifications/n1/read", {
      method: "PATCH",
    });
  });

  it("shows notification details after selection", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            notifications: [
              {
                id: "n1",
                type: "mentioned",
                actorName: "Ashley Ha",
                actorImage: null,
                issueIdentifier: "ENG-136",
                issueTitle: "Fix bug",
                issuePriority: "high",
                readAt: null,
                createdAt: new Date().toISOString(),
              },
            ],
            unreadCount: 1,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      }) as unknown as typeof fetch;

    cleanup();
    vi.resetModules();
    const { default: InboxPage } = await import("@/app/(app)/inbox/page");
    render(<InboxPage />);

    await vi.waitFor(() => {
      expect(screen.getAllByText("Fix bug").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByTestId("notification-row"));

    await vi.waitFor(() => {
      expect(screen.getAllByText(/Ashley Ha/).length).toBeGreaterThan(0);
      expect(screen.getByText(/mentioned you in this issue/)).toBeDefined();
    });
  });
});
