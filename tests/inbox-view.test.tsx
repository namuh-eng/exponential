import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({}),
}));

import InboxPage from "@/app/(app)/inbox/page";

const mockInboxData = {
  notifications: [
    {
      id: "n1",
      type: "comment",
      actorName: "Ashley",
      actorImage: null,
      issueIdentifier: "ENG-1",
      issueTitle: "A bug to fix",
      issuePriority: "high",
      issueId: "iss-1",
      readAt: null,
      createdAt: "2026-04-25T10:00:00Z",
    },
    {
      id: "n2",
      type: "assigned",
      actorName: "Jaeyun",
      actorImage: null,
      issueIdentifier: "ENG-2",
      issueTitle: "New task",
      issuePriority: "urgent",
      issueId: "iss-2",
      readAt: "2026-04-25T11:00:00Z",
      createdAt: "2026-04-25T10:30:00Z",
    },
  ],
  unreadCount: 1,
};

describe("InboxPage UI", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders loading state then notifications", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockInboxData,
    } as Response);

    render(<InboxPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    expect(await screen.findByText("Inbox")).toBeInTheDocument();
    expect(screen.getByText("1 unread")).toBeInTheDocument();

    // Check both notifications exist in the list
    expect(screen.getAllByText("A bug to fix").length).toBeGreaterThan(0);
    expect(screen.getByText("New task")).toBeInTheDocument();
  });

  it("marks a notification as read when selected", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (
        url.toString().includes("/api/notifications") &&
        !url.toString().includes("/read")
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => mockInboxData,
        } as Response);
      }
      if (url.toString().includes("/api/notifications/n1/read")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(<InboxPage />);
    const notifications = await screen.findAllByText("A bug to fix");
    // The one in the list is usually the one inside the button/row
    const notificationRow = notifications[0].closest(
      "button[data-testid='notification-row']",
    );
    expect(notificationRow).not.toBeNull();
    if (notificationRow) fireEvent.click(notificationRow);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/notifications/n1/read",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
  });

  it("filters to show only unread notifications", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockInboxData,
    } as Response);

    render(<InboxPage />);
    await screen.findAllByText("A bug to fix");

    // Initially shows both
    expect(screen.getAllByText("A bug to fix").length).toBeGreaterThan(0);
    expect(screen.getByText("New task")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Filter inbox notifications"));

    // Now should only show the unread one (n1) in the list
    expect(screen.getAllByText("A bug to fix").length).toBeGreaterThan(0);
    expect(screen.queryByText("New task")).not.toBeInTheDocument();
  });

  it("sorts notifications by priority", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockInboxData,
    } as Response);

    render(<InboxPage />);
    await screen.findAllByText("A bug to fix");

    fireEvent.click(
      screen.getByLabelText("Sort inbox notifications by priority"),
    );

    // After sorting by priority, "New task" (urgent) should be first
    const rows = screen.getAllByTestId("notification-row");
    expect(within(rows[0]).getByText("New task")).toBeInTheDocument();
    expect(within(rows[1]).getByText("A bug to fix")).toBeInTheDocument();
  });
});
