"use client";

import { AskAssistant } from "@/components/ask-assistant";
import { CommandPalette } from "@/components/command-palette";
import { CreateIssueModal } from "@/components/create-issue-modal";
import { ExponentialMark } from "@/components/exponential-mark";
import { Sidebar, type SidebarTeam } from "@/components/sidebar";
import {
  ACCOUNT_PREFERENCES_CHANGE_EVENT,
  type AccountPreferences,
  DEFAULT_ACCOUNT_PREFERENCES,
  mergeAccountPreferences,
} from "@/lib/account-preferences";
import {
  OPEN_COMMAND_PALETTE_EVENT,
  OPEN_CREATE_ISSUE_EVENT,
  OPEN_CREATE_ISSUE_FULLSCREEN_EVENT,
} from "@/lib/command-palette";
import {
  isEditableShortcutTarget,
  isPlainKeyShortcut,
} from "@/lib/keyboard-shortcuts";
import { stripWorkspaceSlug, withWorkspaceSlug } from "@/lib/workspace-paths";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

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
const SIDEBAR_COLLAPSED_STORAGE_KEY = "exponential:sidebar-collapsed";
const TTY_BUFFERS = [
  { id: "triage", key: "gt", label: "triage" },
  { id: "board", key: "gb", label: "board" },
  { id: "road", key: "gr", label: "road" },
  { id: "prj", key: "gp", label: "prj" },
  { id: "inbox", key: "gi", label: "inbox" },
  { id: "cli", key: "g!", label: "cli" },
] as const;

type TtyBufferId = (typeof TTY_BUFFERS)[number]["id"];

function normalizeBuildValue(value: string | undefined, fallback: string) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") {
    return fallback;
  }

  return trimmed;
}

function formatVersion(value: string | undefined) {
  const version = normalizeBuildValue(value, "version:unknown");
  if (version === "version:unknown" || version.startsWith("v")) {
    return version;
  }

  return `v${version}`;
}

const shellBuildMetadata = {
  version: formatVersion(process.env.NEXT_PUBLIC_EXPONENTIAL_VERSION),
  branch: normalizeBuildValue(
    process.env.NEXT_PUBLIC_EXPONENTIAL_GIT_BRANCH,
    "branch:unknown",
  ),
  sha: normalizeBuildValue(
    process.env.NEXT_PUBLIC_EXPONENTIAL_GIT_SHA,
    "sha:unknown",
  ),
};

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

function getBufferLabel(pathname: string) {
  if (pathname === "/" || pathname === "") {
    return "home";
  }

  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "team" && segments.length >= 2) {
    return [segments[0], segments[1], segments[2] ?? "overview"]
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  }

  return segments
    .slice(0, 3)
    .map((segment) => decodeURIComponent(segment))
    .join("/");
}

function getRouteStatus(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);

  if (pathname.startsWith("/settings")) {
    return "settings";
  }

  if (segments[0] === "team" && segments[2] === "board") {
    return "board";
  }

  if (
    segments[0] === "team" &&
    ["all", "active", "backlog"].includes(segments[2] ?? "")
  ) {
    return "issues";
  }

  if (pathname.includes("/issue/")) {
    return "issue";
  }

  if (pathname.startsWith("/inbox")) {
    return "inbox";
  }

  if (pathname.startsWith("/projects") || pathname.startsWith("/project/")) {
    return "projects";
  }

  return "workspace";
}

function getActiveBuffer(pathname: string): TtyBufferId {
  const segments = pathname.split("/").filter(Boolean);

  if (pathname.startsWith("/settings")) {
    return "cli";
  }

  if (pathname.startsWith("/inbox")) {
    return "inbox";
  }

  if (pathname.startsWith("/roadmap")) {
    return "road";
  }

  if (pathname.startsWith("/projects") || pathname.startsWith("/project/")) {
    return "prj";
  }

  if (segments[0] === "team" && segments[2] === "board") {
    return "board";
  }

  if (pathname.includes("/issue/") || segments[0] === "team") {
    return "triage";
  }

  return "triage";
}

function getBufferHref(bufferId: TtyBufferId, teamKey: string) {
  switch (bufferId) {
    case "board":
      return `/team/${teamKey}/board`;
    case "road":
      return "/roadmap";
    case "prj":
      return "/projects";
    case "inbox":
      return "/inbox";
    case "cli":
      return "/settings";
    default:
      return `/team/${teamKey}/all`;
  }
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
  const [createIssueMode, setCreateIssueMode] =
    useState<CreateIssueMode | null>(null);
  const [inboxUnreadCount, setInboxUnreadCount] = useState(0);
  const [accountPreferences, setAccountPreferences] =
    useState<AccountPreferences>(DEFAULT_ACCOUNT_PREFERENCES);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [sidebarPreviewOpen, setSidebarPreviewOpen] = useState(false);
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
  const updateSidebarCollapsed = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      setSidebarCollapsed((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        try {
          window.localStorage.setItem(
            SIDEBAR_COLLAPSED_STORAGE_KEY,
            resolved ? "true" : "false",
          );
        } catch {
          // Local persistence is a convenience; the runtime layout state still works.
        }
        return resolved;
      });
      setSidebarPreviewOpen(false);
    },
    [],
  );

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
      setSidebarCollapsed(stored === null ? true : stored === "true");
    } catch {
      setSidebarCollapsed(true);
    }
  }, []);

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
        (event.metaKey || event.ctrlKey) &&
        event.key === "\\" &&
        !event.altKey &&
        !event.shiftKey &&
        !isEditableShortcutTarget(event.target)
      ) {
        event.preventDefault();
        navigationShortcutRef.current = null;
        updateSidebarCollapsed((current) => !current);
        return;
      }

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
  }, [
    router,
    shellContext.teamKey,
    shellContext.teams,
    updateSidebarCollapsed,
    workspaceSlug,
  ]);

  const bufferLabel = getBufferLabel(pathname);
  const routeStatus = getRouteStatus(pathname);
  const activeBuffer = getActiveBuffer(pathname);
  const sidebar = (
    <Sidebar
      workspaceName={shellContext.workspaceName}
      workspaceInitials={shellContext.workspaceInitials}
      teamName={shellContext.teamName}
      teamKey={shellContext.teamKey}
      teams={shellContext.teams}
      inboxUnreadCount={inboxUnreadCount}
      onCreateIssue={
        shellContext.teams.find((team) => team.key === shellContext.teamKey)
          ?.retiredAt
          ? undefined
          : () => setCreateIssueMode("modal")
      }
      accountPreferences={accountPreferences}
      workspaceSlug={shellContext.workspaceSlug}
    />
  );

  return (
    <AppShellContext.Provider value={shellContext}>
      <div
        className="flex h-screen overflow-hidden bg-[var(--color-sidebar-bg)] text-[var(--color-text-primary)]"
        data-editorial-theme="product"
      >
        {sidebarCollapsed && (
          <div
            data-testid="app-sidebar-hover-zone"
            aria-hidden="true"
            className="fixed inset-y-0 left-0 z-40 hidden w-3 bg-transparent md:block"
            onMouseEnter={() => setSidebarPreviewOpen(true)}
          />
        )}
        <div
          data-testid="app-sidebar-shell"
          className={`hidden md:block ${
            sidebarCollapsed ? "fixed inset-y-0 left-0 z-50" : ""
          }`}
          onMouseLeave={
            sidebarCollapsed ? () => setSidebarPreviewOpen(false) : undefined
          }
        >
          {(!sidebarCollapsed || sidebarPreviewOpen) && (
            <div
              data-testid={
                sidebarCollapsed ? "app-sidebar-reveal-panel" : undefined
              }
              className={
                sidebarCollapsed ? "shadow-[12px_0_34px_rgba(0,0,0,0.34)]" : ""
              }
              onFocus={
                sidebarCollapsed ? () => setSidebarPreviewOpen(true) : undefined
              }
            >
              {sidebar}
            </div>
          )}
        </div>
        <main
          className={`flex min-w-0 flex-1 flex-col overflow-hidden p-0 md:p-2 ${
            sidebarCollapsed ? "" : "md:pl-0"
          }`}
        >
          <div
            className="tty-shell-frame editorial-page-surface flex h-full min-w-0 flex-col overflow-hidden transition-colors"
            data-testid="tty-workspace-shell"
          >
            <header
              className="tty-status-bar shrink-0 overflow-x-auto border-b p-0"
              data-testid="tty-route-status-bar"
            >
              <div className="flex min-h-[30px] shrink-0 items-center gap-2 border-r border-[var(--color-border)] px-3">
                <ExponentialMark
                  size={18}
                  className="text-[var(--color-accent)]"
                />
                <span className="text-[var(--color-text-secondary)]">:</span>
                <span className="max-w-[132px] truncate text-[var(--color-text-primary)]">
                  {shellContext.workspaceName}
                </span>
                <span className="text-[var(--color-text-tertiary)]">/</span>
                <span className="max-w-[72px] truncate text-[var(--color-text-primary)]">
                  {shellContext.teamKey.toLowerCase()}
                </span>
              </div>
              <nav
                aria-label="TTY buffers"
                className="flex min-h-[30px] shrink-0 items-stretch"
              >
                {TTY_BUFFERS.map((buffer) => {
                  const active = activeBuffer === buffer.id;
                  return (
                    <button
                      key={buffer.id}
                      type="button"
                      data-testid={`tty-buffer-${buffer.id}`}
                      aria-current={active ? "page" : undefined}
                      onClick={() =>
                        router.push(
                          withWorkspaceSlug(
                            getBufferHref(buffer.id, shellContext.teamKey),
                            shellContext.workspaceSlug,
                          ),
                        )
                      }
                      className={`relative flex min-h-[30px] items-center gap-2 border-r border-[var(--color-border)] px-3 text-[12px] transition-colors ${
                        active
                          ? "bg-[var(--editorial-bg)] text-[var(--color-text-primary)]"
                          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                      }`}
                    >
                      <span className="text-[10px] text-[var(--color-text-tertiary)]">
                        {buffer.key}
                      </span>
                      <span>{buffer.label}</span>
                      {active && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-x-0 bottom-[-1px] h-0.5 bg-[var(--color-accent)]"
                        />
                      )}
                    </button>
                  );
                })}
              </nav>
              <div className="min-w-3 flex-1" />
              <div className="flex min-h-[30px] shrink-0 items-center gap-3 px-3 text-[11px] text-[var(--color-text-secondary)]">
                <span>
                  <span className="text-[var(--color-accent)]">●</span> live
                </span>
                <span className="hidden sm:inline">self-hosted</span>
                <span className="hidden md:inline">
                  <span className="text-[var(--color-text-tertiary)]">
                    git:
                  </span>
                  {shellBuildMetadata.branch}@{shellBuildMetadata.sha}
                </span>
                <span className="hidden lg:inline text-[var(--color-text-tertiary)]">
                  {shellBuildMetadata.version}
                </span>
                <button
                  type="button"
                  aria-label={
                    sidebarCollapsed ? "Show sidebar" : "Hide sidebar"
                  }
                  title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
                  data-testid="sidebar-toggle-button"
                  onClick={() => updateSidebarCollapsed((current) => !current)}
                  className="tty-row hidden h-6 w-6 items-center justify-center border border-[var(--color-border)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] md:inline-flex"
                >
                  {sidebarCollapsed ? (
                    <PanelLeftOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <PanelLeftClose
                      className="h-3.5 w-3.5"
                      aria-hidden="true"
                    />
                  )}
                </button>
              </div>
            </header>

            <div className="tty-prompt-line shrink-0 gap-3 px-3 py-1 text-[11px]">
              <span className="text-[var(--color-accent)]">:</span>
              <span>{routeStatus}</span>
              <span className="text-[var(--color-text-tertiary)]">/</span>
              <span className="min-w-0 max-w-[280px] truncate text-[var(--color-text-primary)]">
                {bufferLabel}
              </span>
              <span className="ml-auto hidden text-[var(--color-text-secondary)] sm:inline">
                cmd+\ sidebar · cmd+k palette
              </span>
            </div>

            <section className="min-h-0 flex-1 overflow-hidden bg-[var(--color-content-bg)]">
              {children}
            </section>

            <footer
              className="tty-status-bar shrink-0 flex-wrap border-t px-3 py-1"
              data-testid="tty-shortcut-status-bar"
            >
              <span className="text-[var(--color-accent)]">:</span>
              <button
                type="button"
                aria-label={sidebarCollapsed ? "Search" : undefined}
                aria-hidden={!sidebarCollapsed}
                tabIndex={sidebarCollapsed ? 0 : -1}
                data-testid="tty-command-search"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent(OPEN_COMMAND_PALETTE_EVENT),
                  )
                }
                className="tty-row inline-flex items-center gap-1 border border-transparent text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
              >
                <kbd className="tty-kbd">/</kbd> search
              </button>
              <span>
                <kbd className="tty-kbd">?</kbd> help
              </span>
              <span>
                <kbd className="tty-kbd">c</kbd> new
              </span>
              <span>
                <kbd className="tty-kbd">x</kbd> archive
              </span>
              <span>
                <kbd className="tty-kbd">e</kbd> edit
              </span>
              <span className="hidden sm:inline">
                <kbd className="tty-kbd">j</kbd>/
                <kbd className="tty-kbd">k</kbd> move
              </span>
              <span className="hidden md:inline">
                <kbd className="tty-kbd">g</kbd>
                <kbd className="tty-kbd">t</kbd> triage
              </span>
              <span className="ml-auto text-[var(--color-text-tertiary)]">
                NORMAL
              </span>
            </footer>
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
        <AskAssistant
          teamKey={shellContext.teamKey}
          workspaceId={shellContext.workspaceId}
          workspaceSlug={shellContext.workspaceSlug}
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
