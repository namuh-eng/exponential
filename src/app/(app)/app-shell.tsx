"use client";

import { CommandPalette } from "@/components/command-palette";
import { CreateIssueModal } from "@/components/create-issue-modal";
import { Sidebar, type SidebarTeam } from "@/components/sidebar";
import {
  ACCOUNT_PREFERENCES_CHANGE_EVENT,
  type AccountPreferences,
  DEFAULT_ACCOUNT_PREFERENCES,
  mergeAccountPreferences,
} from "@/lib/account-preferences";
import {
  OPEN_CREATE_ISSUE_EVENT,
  OPEN_CREATE_ISSUE_FULLSCREEN_EVENT,
} from "@/lib/command-palette";
import {
  isEditableShortcutTarget,
  isPlainKeyShortcut,
} from "@/lib/keyboard-shortcuts";
import { stripWorkspaceSlug, withWorkspaceSlug } from "@/lib/workspace-paths";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";

interface AppShellProps {
  children: React.ReactNode;
  workspaceId?: string;
  workspaceSlug?: string;
  workspaceName: string;
  workspaceInitials: string;
  teamName: string;
  teamId: string;
  teamKey: string;
  teams?: SidebarTeam[];
}

interface ShellContext {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  workspaceInitials: string;
  teamName: string;
  teamId: string;
  teamKey: string;
  teams: SidebarTeam[];
}

const AppShellContext = createContext<ShellContext | null>(null);
type CreateIssueMode = "modal" | "fullscreen";

export function useAppShellContext() {
  return useContext(AppShellContext);
}

function getActiveTeamKey(pathname: string): string | null {
  const teamMatch = pathname.match(/^\/team\/([^/]+)/);
  if (teamMatch) {
    return decodeURIComponent(teamMatch[1]);
  }

  const settingsMatch = pathname.match(/^\/settings\/teams\/([^/]+)/);
  if (settingsMatch) {
    return decodeURIComponent(settingsMatch[1]);
  }

  return null;
}

export function AppShell({
  children,
  workspaceId = "",
  workspaceSlug = "",
  workspaceName,
  workspaceInitials,
  teamName,
  teamId,
  teamKey,
  teams,
}: AppShellProps) {
  const pathname = stripWorkspaceSlug(usePathname(), workspaceSlug);
  const router = useRouter();
  const navigationShortcutRef = useRef<{
    key: string;
    timestamp: number;
  } | null>(null);
  const isSettingsRoute = pathname.startsWith("/settings");
  const [createIssueMode, setCreateIssueMode] =
    useState<CreateIssueMode | null>(null);
  const [inboxUnreadCount, setInboxUnreadCount] = useState(0);
  const [accountPreferences, setAccountPreferences] =
    useState<AccountPreferences>(DEFAULT_ACCOUNT_PREFERENCES);
  const [shellContext, setShellContext] = useState<ShellContext>({
    workspaceId,
    workspaceSlug,
    workspaceName,
    workspaceInitials,
    teamName,
    teamId,
    teamKey,
    teams:
      teams && teams.length > 0
        ? teams
        : [{ id: teamId, name: teamName, key: teamKey }],
  });

  useEffect(() => {
    const fallbackContext = {
      workspaceId,
      workspaceSlug,
      workspaceName,
      workspaceInitials,
      teamName,
      teamId,
      teamKey,
      teams:
        teams && teams.length > 0
          ? teams
          : [{ id: teamId, name: teamName, key: teamKey }],
    };
    const activeTeamKey = getActiveTeamKey(pathname);

    if (!activeTeamKey || activeTeamKey === fallbackContext.teamKey) {
      setShellContext(fallbackContext);
      return;
    }

    let cancelled = false;

    fetch(`/api/teams/${encodeURIComponent(activeTeamKey)}/context`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to load team context");
        }

        return (await response.json()) as ShellContext;
      })
      .then((context) => {
        if (!cancelled) {
          setShellContext(context);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setShellContext(fallbackContext);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    pathname,
    teamId,
    teamKey,
    teamName,
    teams,
    workspaceId,
    workspaceSlug,
    workspaceInitials,
    workspaceName,
  ]);

  useEffect(() => {
    document.cookie = `activeWorkspaceId=${shellContext.workspaceId}; path=/; samesite=lax`;
    document.cookie = `activeWorkspaceSlug=${shellContext.workspaceSlug}; path=/; samesite=lax`;
  }, [shellContext.workspaceId, shellContext.workspaceSlug]);

  useEffect(() => {
    let cancelled = false;

    async function syncAccountPreferences() {
      try {
        const response = await fetch("/api/account/preferences");
        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as {
          accountPreferences?: Partial<AccountPreferences>;
        };

        if (!cancelled && data.accountPreferences) {
          setAccountPreferences(
            mergeAccountPreferences(
              DEFAULT_ACCOUNT_PREFERENCES,
              data.accountPreferences,
            ),
          );
        }
      } catch {
        if (!cancelled) {
          setAccountPreferences(DEFAULT_ACCOUNT_PREFERENCES);
        }
      }
    }

    function handleAccountPreferencesChanged(event: Event) {
      const customEvent = event as CustomEvent<AccountPreferences>;
      if (!customEvent.detail) {
        return;
      }

      setAccountPreferences(customEvent.detail);
    }

    void syncAccountPreferences();
    window.addEventListener(
      ACCOUNT_PREFERENCES_CHANGE_EVENT,
      handleAccountPreferencesChanged as EventListener,
    );

    return () => {
      cancelled = true;
      window.removeEventListener(
        ACCOUNT_PREFERENCES_CHANGE_EVENT,
        handleAccountPreferencesChanged as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function syncInboxUnreadCount() {
      try {
        const response = await fetch("/api/notifications");
        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as { unreadCount?: number };
        if (!cancelled) {
          setInboxUnreadCount(data.unreadCount ?? 0);
        }
      } catch {
        if (!cancelled) {
          setInboxUnreadCount(0);
        }
      }
    }

    function handleNotificationsChanged(event: Event) {
      const customEvent = event as CustomEvent<{ unreadCount?: number }>;
      if (typeof customEvent.detail?.unreadCount === "number") {
        setInboxUnreadCount(customEvent.detail.unreadCount);
        return;
      }

      void syncInboxUnreadCount();
    }

    void syncInboxUnreadCount();
    const intervalId = window.setInterval(() => {
      void syncInboxUnreadCount();
    }, 15000);
    const handleFocus = () => {
      void syncInboxUnreadCount();
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener(
      "notifications:changed",
      handleNotificationsChanged as EventListener,
    );

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener(
        "notifications:changed",
        handleNotificationsChanged as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    function canCreateIssueForActiveTeam() {
      return !shellContext.teams.find(
        (team) => team.key === shellContext.teamKey,
      )?.retiredAt;
    }

    function handleOpenCreateIssue() {
      if (!canCreateIssueForActiveTeam()) return;
      setCreateIssueMode("modal");
    }

    function handleOpenCreateIssueFullscreen() {
      if (!canCreateIssueForActiveTeam()) return;
      setCreateIssueMode("fullscreen");
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        isEditableShortcutTarget(event.target)
      ) {
        navigationShortcutRef.current = null;
        return;
      }

      const key = event.key.toLowerCase();
      const now = Date.now();
      const isGoSequence =
        navigationShortcutRef.current?.key === "g" &&
        now - navigationShortcutRef.current.timestamp < 1250;

      if (isGoSequence) {
        const navigationTargets: Record<string, string> = {
          i: "/inbox",
          m: "/my-issues",
          v: "/views",
          p: "/projects",
        };
        const targetPath = navigationTargets[key];
        navigationShortcutRef.current = null;

        if (targetPath) {
          event.preventDefault();
          router.push(withWorkspaceSlug(targetPath, workspaceSlug));
        }
        return;
      }

      if (isPlainKeyShortcut(event, "c")) {
        event.preventDefault();
        navigationShortcutRef.current = null;
        if (!canCreateIssueForActiveTeam()) return;
        setCreateIssueMode("modal");
        return;
      }

      if (isPlainKeyShortcut(event, "v")) {
        event.preventDefault();
        navigationShortcutRef.current = null;
        if (!canCreateIssueForActiveTeam()) return;
        setCreateIssueMode("fullscreen");
        return;
      }

      navigationShortcutRef.current =
        key === "g" ? { key, timestamp: now } : null;
    }

    window.addEventListener(OPEN_CREATE_ISSUE_EVENT, handleOpenCreateIssue);
    window.addEventListener(
      OPEN_CREATE_ISSUE_FULLSCREEN_EVENT,
      handleOpenCreateIssueFullscreen,
    );
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener(
        OPEN_CREATE_ISSUE_EVENT,
        handleOpenCreateIssue,
      );
      window.removeEventListener(
        OPEN_CREATE_ISSUE_FULLSCREEN_EVENT,
        handleOpenCreateIssueFullscreen,
      );
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [router, shellContext.teamKey, shellContext.teams, workspaceSlug]);

  return (
    <AppShellContext.Provider value={shellContext}>
      <div
        className="flex h-screen bg-[var(--color-sidebar-bg)] text-[var(--color-text-primary)]"
        data-editorial-theme="product"
      >
        <div
          data-testid="app-sidebar-shell"
          className={isSettingsRoute ? "hidden md:block" : "block"}
        >
          <Sidebar
            workspaceName={shellContext.workspaceName}
            workspaceInitials={shellContext.workspaceInitials}
            teamName={shellContext.teamName}
            teamKey={shellContext.teamKey}
            teams={shellContext.teams}
            inboxUnreadCount={inboxUnreadCount}
            onCreateIssue={
              shellContext.teams.find(
                (team) => team.key === shellContext.teamKey,
              )?.retiredAt
                ? undefined
                : () => setCreateIssueMode("modal")
            }
            accountPreferences={accountPreferences}
            workspaceSlug={shellContext.workspaceSlug}
          />
        </div>
        <main
          className={
            isSettingsRoute
              ? "flex-1 overflow-hidden p-0 md:p-2 md:pl-0"
              : "flex-1 overflow-hidden p-3 pl-0"
          }
        >
          <div
            className={
              isSettingsRoute
                ? "editorial-page-surface h-full overflow-y-auto bg-[var(--color-content-bg)] transition-colors md:rounded-[10px] md:border md:border-[var(--color-border)] md:shadow-[var(--editorial-shadow-sm)]"
                : "editorial-page-surface h-full overflow-y-auto rounded-[10px] border border-[var(--color-border)] bg-[var(--color-content-bg)] shadow-[var(--editorial-shadow-sm)] transition-colors"
            }
          >
            {children}
          </div>
        </main>
        <CreateIssueModal
          open={createIssueMode !== null}
          onClose={() => setCreateIssueMode(null)}
          variant={createIssueMode ?? "modal"}
          teamId={shellContext.teamId}
          teamKey={shellContext.teamKey}
          teamName={shellContext.teamName}
        />
        <CommandPalette
          teamKey={shellContext.teamKey}
          workspaceId={shellContext.workspaceId}
          workspaceSlug={shellContext.workspaceSlug}
        />
      </div>
    </AppShellContext.Provider>
  );
}
