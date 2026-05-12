"use client";

import { EmptyState } from "@/components/empty-state";
import { NotificationRow } from "@/components/notification-row";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const PRIORITY_SORT_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

interface Notification {
  id: string;
  type: "assigned" | "mentioned" | "status_change" | "comment" | "duplicate";
  actorName: string;
  actorImage: string | null;
  issueIdentifier: string;
  issueTitle: string;
  issuePriority: "urgent" | "high" | "medium" | "low" | "none";
  issueId: string | null;
  readAt: string | null;
  createdAt: string;
}

function emitNotificationChange(unreadCount: number) {
  window.dispatchEvent(
    new CustomEvent("notifications:changed", {
      detail: { unreadCount },
    }),
  );
}

export default function InboxPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [sortMode, setSortMode] = useState<"latest" | "priority">("latest");

  const loadNotifications = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications");
      const data = await response.json();

      const nextNotifications = data.notifications ?? [];
      const nextUnreadCount = data.unreadCount ?? 0;

      setNotifications(nextNotifications);
      setUnreadCount(nextUnreadCount);

      return nextNotifications;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    loadNotifications().then((nextNotifications) => {
      if (!cancelled) {
        setSelectedId(nextNotifications[0]?.id ?? null);
        setLoading(false);
      }
    });

    // Listen for real-time notification events
    function handleNotificationEvent() {
      void loadNotifications();
    }

    window.addEventListener("notifications:changed", handleNotificationEvent);

    return () => {
      cancelled = true;
      window.removeEventListener(
        "notifications:changed",
        handleNotificationEvent,
      );
    };
  }, [loadNotifications]);

  const handleSelect = useCallback(
    async (id: string) => {
      setSelectedId(id);

      const notification = notifications.find((item) => item.id === id);
      if (!notification || notification.readAt) {
        return;
      }

      const nextReadAt = new Date().toISOString();
      const previousNotifications = notifications;
      const previousUnreadCount = unreadCount;

      setNotifications((current) =>
        current.map((item) =>
          item.id === id ? { ...item, readAt: nextReadAt } : item,
        ),
      );
      const nextUnreadCount = Math.max(0, unreadCount - 1);
      setUnreadCount(nextUnreadCount);
      emitNotificationChange(nextUnreadCount);

      try {
        const response = await fetch(`/api/notifications/${id}/read`, {
          method: "PATCH",
        });

        if (!response.ok) {
          throw new Error("Failed to mark notification as read");
        }
      } catch {
        setNotifications(previousNotifications);
        setUnreadCount(previousUnreadCount);
        emitNotificationChange(previousUnreadCount);
      }
    },
    [notifications, unreadCount],
  );

  const visibleNotifications = useMemo(
    () =>
      [...notifications]
        .filter(
          (notification) => !showUnreadOnly || notification.readAt === null,
        )
        .sort((left, right) => {
          if (sortMode === "priority") {
            const priorityDiff =
              PRIORITY_SORT_ORDER[left.issuePriority] -
              PRIORITY_SORT_ORDER[right.issuePriority];

            if (priorityDiff !== 0) {
              return priorityDiff;
            }
          }

          return (
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime()
          );
        }),
    [notifications, showUnreadOnly, sortMode],
  );

  useEffect(() => {
    if (visibleNotifications.length === 0) {
      setSelectedId(null);
      return;
    }

    if (
      !visibleNotifications.some(
        (notification) => notification.id === selectedId,
      )
    ) {
      setSelectedId(visibleNotifications[0]?.id ?? null);
    }
  }, [selectedId, visibleNotifications]);

  const selected =
    visibleNotifications.find(
      (notification) => notification.id === selectedId,
    ) ?? null;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-[13px] text-[#6b6f76]">Loading...</span>
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <EmptyState
        title="You're all caught up"
        description="When you're assigned to issues, mentioned, or receive updates, notifications will appear here."
        icon={
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#6b6f76"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            role="img"
            aria-label="Inbox"
          >
            <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
            <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          </svg>
        }
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[#1c1e21] px-4 py-3">
        <h1 className="text-[14px] font-semibold text-[var(--color-text-primary)]">
          Inbox
        </h1>
        {unreadCount > 0 && (
          <span className="text-[12px] text-[#6b6f76]">
            {unreadCount} unread
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            aria-label="Filter inbox notifications"
            onClick={() => setShowUnreadOnly((current) => !current)}
            className={`rounded-md border px-2.5 py-1 text-[12px] transition-colors ${
              showUnreadOnly
                ? "border-[#5E6AD2] bg-[rgba(94,106,210,0.16)] text-white"
                : "border-[#2a2d31] text-[#b0b5c0] hover:border-[#3a3e45] hover:text-white"
            }`}
          >
            Filter: {showUnreadOnly ? "Unread" : "All"}
          </button>
          <button
            type="button"
            aria-label="Sort inbox notifications by priority"
            onClick={() =>
              setSortMode((current) =>
                current === "latest" ? "priority" : "latest",
              )
            }
            className={`rounded-md border px-2.5 py-1 text-[12px] transition-colors ${
              sortMode === "priority"
                ? "border-[#5E6AD2] bg-[rgba(94,106,210,0.16)] text-white"
                : "border-[#2a2d31] text-[#b0b5c0] hover:border-[#3a3e45] hover:text-white"
            }`}
          >
            Sort: {sortMode === "priority" ? "Priority" : "Latest"}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-full min-w-0 overflow-y-auto border-r border-[#1c1e21] md:w-[400px] md:shrink-0">
          {visibleNotifications.length > 0 ? (
            <div className="flex flex-col gap-0.5 p-1.5">
              {visibleNotifications.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  id={notification.id}
                  type={notification.type}
                  actorName={notification.actorName}
                  actorImage={notification.actorImage}
                  issueIdentifier={notification.issueIdentifier}
                  issueTitle={notification.issueTitle}
                  readAt={notification.readAt}
                  createdAt={notification.createdAt}
                  isSelected={notification.id === selectedId}
                  onClick={(notificationId) => {
                    void handleSelect(notificationId);
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-[#6b6f76]">
              {showUnreadOnly
                ? "No unread notifications match the current filter."
                : "No notifications to display."}
            </div>
          )}
        </div>

        <div className="hidden flex-1 overflow-y-auto p-6 md:block">
          {selected ? (
            <div>
              <div className="mb-2 text-[12px] text-[#6b6f76]">
                {selected.issueIdentifier}
              </div>
              <h2 className="mb-4 text-[16px] font-semibold text-[var(--color-text-primary)]">
                {selected.issueTitle}
              </h2>
              <p className="text-[13px] text-[#b0b5c0]">
                <span className="font-medium text-[var(--color-text-primary)]">
                  {selected.actorName}
                </span>{" "}
                {selected.type === "assigned" && "assigned this issue to you"}
                {selected.type === "mentioned" && "mentioned you in this issue"}
                {selected.type === "status_change" &&
                  "changed the status of this issue"}
                {selected.type === "comment" && "commented on this issue"}
                {selected.type === "duplicate" &&
                  "marked this issue as duplicate"}
              </p>
              {selected.issueIdentifier && (
                <Link
                  href={`/issue/${selected.issueIdentifier}`}
                  className="mt-4 inline-flex text-[12px] font-medium text-[#5E6AD2] hover:text-[#7a84dd]"
                >
                  Open issue
                </Link>
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <span className="text-[13px] text-[#6b6f76]">
                Select a notification to view details
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
