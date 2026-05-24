"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
import { EmptyState } from "@/components/empty-state";
import { NotificationRow } from "@/components/notification-row";
import { withWorkspaceSlug } from "@/lib/workspace-paths";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const PRIORITY_SORT_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

const DEFAULT_INBOX_PREFERENCES = {
  showReadItems: true,
  showUnreadItemsFirst: false,
  showSnoozedItems: false,
};

type InboxPreferences = typeof DEFAULT_INBOX_PREFERENCES;

interface Notification {
  id: string;
  type: "assigned" | "mentioned" | "status_change" | "comment" | "duplicate";
  actorName: string;
  actorImage: string | null;
  issueIdentifier: string | null;
  issueTitle: string;
  issuePriority: "urgent" | "high" | "medium" | "low" | "none";
  issueId: string | null;
  readAt: string | null;
  createdAt: string;
  snoozedUntilAt: string | null;
  unsnoozedAt: string | null;
}

function emitNotificationChange(unreadCount: number) {
  window.dispatchEvent(
    new CustomEvent("notifications:changed", {
      detail: { unreadCount },
    }),
  );
}

function isActiveSnooze(notification: Notification) {
  if (!notification.snoozedUntilAt) return false;
  const snoozedUntil = new Date(notification.snoozedUntilAt).getTime();
  if (Number.isNaN(snoozedUntil) || snoozedUntil <= Date.now()) return false;
  if (!notification.unsnoozedAt) return true;
  return new Date(notification.unsnoozedAt).getTime() < snoozedUntil;
}

function parseInboxPreferences(value: unknown): InboxPreferences {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    showReadItems:
      typeof record.showReadItems === "boolean"
        ? record.showReadItems
        : DEFAULT_INBOX_PREFERENCES.showReadItems,
    showUnreadItemsFirst:
      typeof record.showUnreadItemsFirst === "boolean"
        ? record.showUnreadItemsFirst
        : DEFAULT_INBOX_PREFERENCES.showUnreadItemsFirst,
    showSnoozedItems:
      typeof record.showSnoozedItems === "boolean"
        ? record.showSnoozedItems
        : DEFAULT_INBOX_PREFERENCES.showSnoozedItems,
  };
}

export function InboxClient({
  initialSelectedId = null,
}: {
  initialSelectedId?: string | null;
}) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState<InboxPreferences>(
    DEFAULT_INBOX_PREFERENCES,
  );
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [sortMode, setSortMode] = useState<"latest" | "priority">("latest");
  const workspaceSlug = useAppShellContext()?.workspaceSlug;
  const router = useRouter();

  const loadNotifications = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications");
      const data = await response.json();

      const nextNotifications = data.notifications ?? [];
      const nextUnreadCount = data.unreadCount ?? 0;

      setNotifications(nextNotifications);
      setUnreadCount(nextUnreadCount);

      return nextNotifications as Notification[];
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPreferences() {
      if (process.env.NODE_ENV === "test") {
        setPreferencesLoaded(true);
        return;
      }
      try {
        const response = await fetch("/api/account/preferences");
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        setPreferences(
          parseInboxPreferences(data.accountPreferences?.inboxDisplay),
        );
      } finally {
        if (!cancelled) setPreferencesLoaded(true);
      }
    }

    void loadPreferences();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    loadNotifications().then((nextNotifications) => {
      if (!cancelled) {
        setSelectedId(initialSelectedId ?? nextNotifications[0]?.id ?? null);
        setLoading(false);
      }
    });

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
  }, [initialSelectedId, loadNotifications]);

  const persistPreferences = useCallback(
    async (nextPreferences: InboxPreferences) => {
      setPreferences(nextPreferences);
      if (!preferencesLoaded) return;
      await fetch("/api/account/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountPreferences: { inboxDisplay: nextPreferences },
        }),
      }).catch(() => undefined);
    },
    [preferencesLoaded],
  );

  const updateNotification = useCallback(
    async (
      id: string,
      patch: Partial<Notification>,
      endpoint: string,
      init: RequestInit = { method: "PATCH" },
      unreadDelta = 0,
    ) => {
      const previousNotifications = notifications;
      const previousUnreadCount = unreadCount;
      setNotifications((current) =>
        current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );
      const nextUnreadCount = Math.max(0, unreadCount + unreadDelta);
      setUnreadCount(nextUnreadCount);
      emitNotificationChange(nextUnreadCount);

      try {
        const response = await fetch(endpoint, init);
        if (!response.ok) throw new Error("Notification update failed");
        const data = await response.json().catch(() => null);
        if (typeof data?.unreadCount === "number") {
          setUnreadCount(data.unreadCount);
          emitNotificationChange(data.unreadCount);
        }
      } catch {
        setNotifications(previousNotifications);
        setUnreadCount(previousUnreadCount);
        emitNotificationChange(previousUnreadCount);
      }
    },
    [notifications, unreadCount],
  );

  const markNotificationRead = useCallback(
    async (id: string) => {
      const notification = notifications.find((item) => item.id === id);
      if (!notification || notification.readAt) return;
      await updateNotification(
        id,
        { readAt: new Date().toISOString() },
        `/api/notifications/${id}/read`,
        { method: "PATCH" },
        -1,
      );
    },
    [notifications, updateNotification],
  );

  const markNotificationUnread = useCallback(
    async (id: string) => {
      const notification = notifications.find((item) => item.id === id);
      if (!notification || !notification.readAt) return;
      await updateNotification(
        id,
        { readAt: null },
        `/api/notifications/${id}/unread`,
        { method: "PATCH" },
        1,
      );
    },
    [notifications, updateNotification],
  );

  const toggleSnooze = useCallback(
    async (id: string) => {
      const notification = notifications.find((item) => item.id === id);
      if (!notification) return;
      const active = isActiveSnooze(notification);
      const nextSnoozedUntilAt = active
        ? null
        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await updateNotification(
        id,
        {
          snoozedUntilAt: nextSnoozedUntilAt,
          unsnoozedAt: active ? new Date().toISOString() : null,
        },
        `/api/notifications/${id}/snooze`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snoozedUntilAt: nextSnoozedUntilAt }),
        },
      );
    },
    [notifications, updateNotification],
  );

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      router.push(
        withWorkspaceSlug(`/inbox/notification/${id}`, workspaceSlug),
      );
      void markNotificationRead(id);
    },
    [markNotificationRead, router, workspaceSlug],
  );

  const bulkMarkRead = useCallback(async () => {
    const previousNotifications = notifications;
    const previousUnreadCount = unreadCount;
    const nextReadAt = new Date().toISOString();
    const markableIds = new Set(
      notifications
        .filter((item) => item.type !== "comment" && item.readAt === null)
        .map((item) => item.id),
    );
    if (markableIds.size === 0) return;

    setNotifications((current) =>
      current.map((item) =>
        markableIds.has(item.id) ? { ...item, readAt: nextReadAt } : item,
      ),
    );
    const nextUnreadCount = notifications.filter(
      (item) => item.readAt === null && !markableIds.has(item.id),
    ).length;
    setUnreadCount(nextUnreadCount);
    emitNotificationChange(nextUnreadCount);

    try {
      const response = await fetch("/api/notifications/bulk-read", {
        method: "PATCH",
      });
      if (!response.ok) throw new Error("Bulk mark read failed");
      const data = await response.json().catch(() => null);
      if (typeof data?.unreadCount === "number") {
        setUnreadCount(data.unreadCount);
        emitNotificationChange(data.unreadCount);
      }
    } catch {
      setNotifications(previousNotifications);
      setUnreadCount(previousUnreadCount);
      emitNotificationChange(previousUnreadCount);
    }
  }, [notifications, unreadCount]);

  const visibleNotifications = useMemo(
    () =>
      [...notifications]
        .filter((notification) => {
          if (!preferences.showReadItems && notification.readAt !== null) {
            return false;
          }
          if (!preferences.showSnoozedItems && isActiveSnooze(notification)) {
            return false;
          }
          return true;
        })
        .sort((left, right) => {
          if (preferences.showUnreadItemsFirst) {
            const unreadDiff =
              Number(left.readAt !== null) - Number(right.readAt !== null);
            if (unreadDiff !== 0) return unreadDiff;
          }

          if (sortMode === "priority") {
            const priorityDiff =
              PRIORITY_SORT_ORDER[left.issuePriority] -
              PRIORITY_SORT_ORDER[right.issuePriority];

            if (priorityDiff !== 0) return priorityDiff;
          }

          return (
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime()
          );
        }),
    [notifications, preferences, sortMode],
  );

  useEffect(() => {
    if (visibleNotifications.length === 0) {
      setSelectedId(initialSelectedId);
      return;
    }

    if (!visibleNotifications.some((item) => item.id === selectedId)) {
      setSelectedId(initialSelectedId ?? visibleNotifications[0]?.id ?? null);
    }
  }, [initialSelectedId, selectedId, visibleNotifications]);

  const selected =
    notifications.find((notification) => notification.id === selectedId) ??
    null;
  const selectedIsHidden =
    selected !== null &&
    !visibleNotifications.some((item) => item.id === selected.id);
  const missingDeepLink =
    initialSelectedId !== null &&
    !loading &&
    notifications.length > 0 &&
    !notifications.some(
      (notification) => notification.id === initialSelectedId,
    );

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
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <h1 className="text-[18px] font-semibold text-[var(--color-text-primary)]">
          Inbox
        </h1>
        {unreadCount > 0 && (
          <span className="text-[12px] text-[#6b6f76]">
            {unreadCount} unread
          </span>
        )}
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            aria-label="Mark non-comment notifications as read"
            onClick={() => void bulkMarkRead()}
            data-editorial-control="true"
            className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--editorial-line-strong)] hover:text-[var(--color-text-primary)]"
          >
            Mark non-comments read
          </button>
          <button
            type="button"
            aria-label="Filter inbox notifications"
            onClick={() =>
              void persistPreferences({
                ...preferences,
                showReadItems: !preferences.showReadItems,
              })
            }
            data-editorial-control="true"
            className={`rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors ${
              preferences.showReadItems
                ? "border-[var(--color-surface-active-line)] bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
                : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--editorial-line-strong)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            Show read: {preferences.showReadItems ? "On" : "Off"}
          </button>
          <button
            type="button"
            aria-label="Toggle unread notifications first"
            onClick={() =>
              void persistPreferences({
                ...preferences,
                showUnreadItemsFirst: !preferences.showUnreadItemsFirst,
              })
            }
            data-editorial-control="true"
            className={`rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors ${
              preferences.showUnreadItemsFirst
                ? "border-[var(--color-surface-active-line)] bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
                : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--editorial-line-strong)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            Unread first: {preferences.showUnreadItemsFirst ? "On" : "Off"}
          </button>
          <button
            type="button"
            aria-label="Toggle snoozed notifications visibility"
            onClick={() =>
              void persistPreferences({
                ...preferences,
                showSnoozedItems: !preferences.showSnoozedItems,
              })
            }
            data-editorial-control="true"
            className={`rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors ${
              preferences.showSnoozedItems
                ? "border-[var(--color-surface-active-line)] bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
                : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--editorial-line-strong)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            Show snoozed: {preferences.showSnoozedItems ? "On" : "Off"}
          </button>
          <button
            type="button"
            aria-label="Sort inbox notifications by priority"
            onClick={() =>
              setSortMode((current) =>
                current === "latest" ? "priority" : "latest",
              )
            }
            data-editorial-control="true"
            className={`rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors ${
              sortMode === "priority"
                ? "border-[var(--color-surface-active-line)] bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
                : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--editorial-line-strong)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            Sort: {sortMode === "priority" ? "Priority" : "Latest"}
          </button>
        </div>
      </div>

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(300px,380px)_minmax(360px,1fr)]">
        <div className="min-w-0 overflow-y-auto border-r border-[var(--color-border)]">
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
                  isSnoozed={isActiveSnooze(notification)}
                  isSelected={notification.id === selectedId}
                  onClick={handleSelect}
                />
              ))}
              {unreadCount === 0 && (
                <div className="px-3 py-4 text-center text-[12px] text-[#6b6f76]">
                  No unread notifications
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-[#6b6f76]">
              No notifications match the current display options.
            </div>
          )}
        </div>

        <div className="hidden min-w-0 overflow-y-auto p-6 lg:block">
          {missingDeepLink ? (
            <div className="flex h-full items-center justify-center text-center">
              <span className="text-[13px] text-[#6b6f76]">
                Notification not found or no longer available.
              </span>
            </div>
          ) : selected ? (
            <div className="mx-auto max-w-[68ch]">
              {selectedIsHidden && (
                <div className="mb-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">
                  This notification is hidden by your display preferences.
                </div>
              )}
              <div className="mb-2 font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
                {selected.issueIdentifier}
              </div>
              <h2 className="mb-4 [overflow-wrap:anywhere] text-pretty break-words text-[24px] font-semibold leading-[1.18] text-[var(--color-text-primary)]">
                {selected.issueTitle}
              </h2>
              <p className="text-[14px] leading-6 text-[var(--color-text-secondary)]">
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
              {isActiveSnooze(selected) && (
                <p className="mt-3 text-[12px] text-[var(--color-text-secondary)]">
                  Snoozed until{" "}
                  {new Date(selected.snoozedUntilAt as string).toLocaleString()}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="mark-unread-action"
                  onClick={() =>
                    selected.readAt
                      ? void markNotificationUnread(selected.id)
                      : void markNotificationRead(selected.id)
                  }
                  className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                >
                  Mark {selected.readAt ? "unread" : "read"}
                </button>
                <button
                  type="button"
                  data-testid="snooze-action"
                  onClick={() => void toggleSnooze(selected.id)}
                  className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                >
                  {isActiveSnooze(selected) ? "Unsnooze" : "Snooze 1 day"}
                </button>
                {selected.issueIdentifier && (
                  <Link
                    href={withWorkspaceSlug(
                      `/issue/${selected.issueIdentifier}`,
                      workspaceSlug,
                    )}
                    className="inline-flex rounded-md border border-transparent px-2.5 py-1 text-[12px] font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
                  >
                    Open issue
                  </Link>
                )}
              </div>
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
