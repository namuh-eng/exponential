"use client";

import {
  type AccountPreferences,
  type AccountPreferencesPatch,
  DEFAULT_ACCOUNT_PREFERENCES,
  dispatchAccountPreferencesChanged,
  mergeAccountPreferences,
} from "@/lib/account-preferences";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/lib/command-palette";
import {
  KEYBOARD_SHORTCUTS,
  formatShortcutKeys,
  isEditableShortcutTarget,
} from "@/lib/keyboard-shortcuts";
import {
  SIDEBAR_FAVORITES_CHANGED_EVENT,
  type SidebarFavorite,
} from "@/lib/sidebar-favorites";
import { stripWorkspaceSlug, withWorkspaceSlug } from "@/lib/workspace-paths";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export interface SidebarTeam {
  id?: string;
  name: string;
  key: string;
  parentTeamId?: string | null;
  retiredAt?: Date | string | null;
}

const SHORTCUT_CATEGORY_ORDER = ["Command", "Create", "Navigation", "Context"];
const SHORTCUTS_BY_CATEGORY = SHORTCUT_CATEGORY_ORDER.map((category) => ({
  category,
  shortcuts: KEYBOARD_SHORTCUTS.filter(
    (shortcut) => shortcut.category === category,
  ),
})).filter((group) => group.shortcuts.length > 0);

interface SidebarProps {
  workspaceName?: string;
  workspaceInitials?: string;
  teamName?: string;
  teamKey?: string;
  teams?: SidebarTeam[];
  inboxUnreadCount?: number;
  onCreateIssue?: () => void;
  accountPreferences?: AccountPreferences;
  workspaceSlug?: string;
}

const SidebarWorkspaceSlugContext = createContext<string>("");
function isWorkspaceProjectsRoute(pathname: string) {
  return (
    pathname === "/projects" ||
    pathname.startsWith("/projects/") ||
    pathname.startsWith("/project/")
  );
}

function isWorkspaceViewsRoute(pathname: string) {
  return pathname === "/views" || pathname.startsWith("/views/");
}

function isTeamIssuesRoute(pathname: string, teamKey: string) {
  return (
    pathname === `/team/${teamKey}/all` ||
    pathname === `/team/${teamKey}/active` ||
    pathname === `/team/${teamKey}/backlog` ||
    pathname === `/team/${teamKey}/board` ||
    pathname.startsWith("/issue/") ||
    pathname.startsWith(`/team/${teamKey}/issue/`)
  );
}

function isTeamProjectsRoute(pathname: string, teamKey: string) {
  return (
    pathname === `/team/${teamKey}/projects` ||
    pathname.startsWith(`/team/${teamKey}/projects/`)
  );
}

function isTeamViewsRoute(pathname: string, teamKey: string) {
  return (
    pathname === `/team/${teamKey}/views` ||
    pathname.startsWith(`/team/${teamKey}/views/`)
  );
}

function isTeamAnalyticsRoute(pathname: string, teamKey: string) {
  return (
    pathname === `/team/${teamKey}/analytics` ||
    pathname.startsWith(`/team/${teamKey}/analytics/`) ||
    pathname === `/team/${teamKey}/insights` ||
    pathname.startsWith(`/team/${teamKey}/insights/`)
  );
}

function getPathTeamKey(pathname: string) {
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

function SidebarLink({
  href,
  icon,
  label,
  badge,
  badgeStyle,
  active,
  indent,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  badgeStyle?: "count" | "dot";
  active?: boolean;
  indent?: boolean;
}) {
  const workspaceSlug = useContext(SidebarWorkspaceSlugContext);
  const canonicalHref = withWorkspaceSlug(href, workspaceSlug);
  const showBadge = badge != null && badge > 0;

  return (
    <Link
      href={canonicalHref}
      className={`flex items-center gap-2.5 rounded-[6px] border border-transparent px-2 py-[6px] text-[13px] transition-colors ${
        indent ? "ml-4" : ""
      } ${
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text-primary)] shadow-[var(--shadow-editorial-sm)]"
          : "text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {showBadge &&
        (badgeStyle === "dot" ? (
          <span
            aria-label={`${label} unread`}
            className="h-2 w-2 rounded-full bg-[var(--color-accent)]"
          />
        ) : (
          <span className="text-[11px] text-[var(--color-text-tertiary)]">
            {badge}
          </span>
        ))}
    </Link>
  );
}

function SidebarMenuButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-[6px] border border-transparent px-2 py-[6px] text-left text-[13px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

function SidebarCustomizeModal({
  preferences,
  saveState,
  onClose,
  onUpdate,
}: {
  preferences: AccountPreferences;
  saveState: "idle" | "saving" | "saved" | "error";
  onClose: () => void;
  onUpdate: (patch: AccountPreferencesPatch) => void;
}) {
  const sidebarItems: Array<{
    key: keyof AccountPreferences["sidebarVisibility"];
    label: string;
    group: "Personal" | "Workspace";
  }> = [
    { key: "inbox", label: "Inbox", group: "Personal" },
    { key: "myIssues", label: "My Issues", group: "Personal" },
    { key: "projects", label: "Projects", group: "Workspace" },
    { key: "views", label: "Views", group: "Workspace" },
    { key: "initiatives", label: "Initiatives", group: "Workspace" },
    { key: "cycles", label: "Cycles", group: "Workspace" },
  ];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(20,18,14,0.40)] p-4 backdrop-blur-[2px]">
      <dialog
        open
        aria-label="Customize sidebar"
        className="w-full max-w-[520px] rounded-[10px] border border-[var(--color-border-strong)] bg-[var(--color-content-bg)] p-5 shadow-[var(--shadow-editorial-md)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
              Customize sidebar
            </h2>
            <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">
              Choose which primary navigation items appear in your sidebar.
              Changes save to account preferences and update immediately.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close customize sidebar"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-5 space-y-4">
          {["Personal", "Workspace"].map((group) => (
            <section key={group}>
              <div className="mb-2 text-[11px] font-medium font-mono uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                {group}
              </div>
              <div className="divide-y divide-[var(--color-border)] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4">
                {sidebarItems
                  .filter((item) => item.group === group)
                  .map((item) => {
                    const checked = preferences.sidebarVisibility[item.key];

                    return (
                      <div
                        key={item.key}
                        className="flex items-center justify-between gap-4 py-3"
                      >
                        <div>
                          <div className="text-[13px] text-[var(--color-text-primary)]">
                            {item.label}
                          </div>
                          <div className="text-[12px] text-[var(--color-text-secondary)]">
                            {checked
                              ? "Shown in sidebar"
                              : "Hidden from sidebar"}
                          </div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-label={`${item.label} visibility`}
                          aria-checked={checked}
                          onClick={() =>
                            onUpdate({
                              sidebarVisibility: { [item.key]: !checked },
                            })
                          }
                          className={`relative inline-flex h-[20px] w-[36px] shrink-0 items-center rounded-full transition-colors ${
                            checked
                              ? "bg-[var(--color-accent)]"
                              : "bg-[var(--color-surface-subtle)]"
                          }`}
                        >
                          <span
                            className={`inline-block h-[16px] w-[16px] rounded-full bg-white shadow transition-transform ${
                              checked
                                ? "translate-x-[18px]"
                                : "translate-x-[2px]"
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-4 text-right text-[12px] text-[var(--color-text-secondary)]">
          {saveState === "saving" && "Saving…"}
          {saveState === "saved" && "Saved"}
          {saveState === "error" && "Save failed"}
        </div>
      </dialog>
    </div>
  );
}

function buildTeamHierarchyList(teams: SidebarTeam[]) {
  const byParent = new Map<string, SidebarTeam[]>();
  const byId = new Map<string, SidebarTeam>();

  for (const currentTeam of teams) {
    if (currentTeam.id) {
      byId.set(currentTeam.id, currentTeam);
    }
  }

  for (const currentTeam of teams) {
    const parentId = currentTeam.parentTeamId;
    const parentKey = parentId && byId.has(parentId) ? parentId : "__root__";
    byParent.set(parentKey, [...(byParent.get(parentKey) ?? []), currentTeam]);
  }

  const ordered: Array<SidebarTeam & { depth: number }> = [];
  const seen = new Set<string>();

  function visit(currentTeam: SidebarTeam, depth: number) {
    const identity = currentTeam.id ?? currentTeam.key;
    if (seen.has(identity)) return;
    seen.add(identity);
    ordered.push({ ...currentTeam, depth });

    for (const child of byParent.get(currentTeam.id ?? "") ?? []) {
      visit(child, depth + 1);
    }
  }

  for (const root of byParent.get("__root__") ?? []) {
    visit(root, 0);
  }

  for (const currentTeam of teams) {
    visit(currentTeam, 0);
  }

  return ordered;
}

function SectionHeader({
  label,
  collapsible,
  collapsed,
  onToggle,
}: {
  label: string;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mb-0.5 mt-4 flex w-full items-center gap-1 px-2 text-[11px] font-medium font-mono uppercase tracking-[0.08em] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)]"
    >
      {collapsible && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={`transition-transform ${collapsed ? "" : "rotate-90"}`}
          role="img"
          aria-label="Toggle section"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      )}
      {label}
    </button>
  );
}

export function Sidebar({
  workspaceName = "Workspace",
  workspaceInitials = "W",
  teamName = "Engineering",
  teamKey = "ENG",
  teams,
  inboxUnreadCount = 0,
  onCreateIssue,
  accountPreferences,
  workspaceSlug = "",
}: SidebarProps) {
  const pathname = stripWorkspaceSlug(usePathname(), workspaceSlug);
  const resolvedTeams =
    teams && teams.length > 0 ? teams : [{ name: teamName, key: teamKey }];
  const orderedTeams = buildTeamHierarchyList(resolvedTeams);
  const activeTeamKey = getPathTeamKey(pathname);
  const [teamExpanded, setTeamExpanded] = useState(true);
  const [expandedTeams, setExpandedTeams] = useState<Record<string, boolean>>(
    () => Object.fromEntries(resolvedTeams.map((team) => [team.key, true])),
  );
  const [moreExpanded, setMoreExpanded] = useState(false);
  const [customizeSidebarOpen, setCustomizeSidebarOpen] = useState(false);
  const [localPreferences, setLocalPreferences] = useState<AccountPreferences>(
    () =>
      mergeAccountPreferences(
        DEFAULT_ACCOUNT_PREFERENCES,
        accountPreferences ?? {},
      ),
  );
  const [preferenceSaveState, setPreferenceSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const shortcutsCloseButtonRef = useRef<HTMLButtonElement>(null);
  const lastFocusedBeforeShortcutsRef = useRef<HTMLElement | null>(null);
  const [favorites, setFavorites] = useState<SidebarFavorite[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [managingFavorites, setManagingFavorites] = useState(false);
  const sidebarVisibility = localPreferences.sidebarVisibility;
  const badgeStyle = localPreferences.sidebarBadgeStyle;

  const syncFavorites = useCallback(async () => {
    setFavoritesLoading(true);
    try {
      const response = await fetch("/api/sidebar/favorites", {
        credentials: "include",
      });
      if (!response?.ok) {
        return;
      }

      const data = (await response.json()) as {
        favorites?: SidebarFavorite[];
      };
      setFavorites(data.favorites ?? []);
    } catch {
      setFavorites([]);
    } finally {
      setFavoritesLoading(false);
    }
  }, []);

  function isVisible(key: keyof NonNullable<typeof sidebarVisibility>) {
    return sidebarVisibility?.[key] ?? true;
  }

  useEffect(() => {
    void pathname;
    setMoreExpanded(false);
    setWorkspaceMenuOpen(false);
    setHelpMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!workspaceSlug) {
      return;
    }

    void syncFavorites();

    function handleFavoritesChanged() {
      void syncFavorites();
    }

    window.addEventListener(
      SIDEBAR_FAVORITES_CHANGED_EVENT,
      handleFavoritesChanged,
    );

    return () => {
      window.removeEventListener(
        SIDEBAR_FAVORITES_CHANGED_EVENT,
        handleFavoritesChanged,
      );
    };
  }, [syncFavorites, workspaceSlug]);

  useEffect(() => {
    setLocalPreferences(
      mergeAccountPreferences(
        DEFAULT_ACCOUNT_PREFERENCES,
        accountPreferences ?? {},
      ),
    );
  }, [accountPreferences]);

  const openShortcuts = useCallback((restoreFocusTo?: HTMLElement | null) => {
    lastFocusedBeforeShortcutsRef.current =
      restoreFocusTo ?? (document.activeElement as HTMLElement);
    setShortcutsOpen(true);
    setHelpMenuOpen(false);
    setWorkspaceMenuOpen(false);
  }, []);

  const closeShortcuts = useCallback(() => {
    setShortcutsOpen(false);
    requestAnimationFrame(() => {
      const restoreTarget =
        lastFocusedBeforeShortcutsRef.current &&
        document.contains(lastFocusedBeforeShortcutsRef.current)
          ? lastFocusedBeforeShortcutsRef.current
          : helpButtonRef.current;
      restoreTarget?.focus();
    });
  }, []);

  useEffect(() => {
    if (shortcutsOpen) {
      requestAnimationFrame(() => shortcutsCloseButtonRef.current?.focus());
    }
  }, [shortcutsOpen]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (shortcutsOpen && event.key === "Escape") {
        event.preventDefault();
        closeShortcuts();
        return;
      }

      if (shortcutsOpen && event.key === "Tab") {
        const dialog = document.getElementById("keyboard-shortcuts-dialog");
        const focusable = Array.from(
          dialog?.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        ).filter((element) => !element.hasAttribute("disabled"));

        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }

        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      if (
        event.key !== "?" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableShortcutTarget(event.target)
      ) {
        return;
      }

      event.preventDefault();
      openShortcuts();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeShortcuts, openShortcuts, shortcutsOpen]);

  useEffect(() => {
    const nextTeams =
      teams && teams.length > 0 ? teams : [{ name: teamName, key: teamKey }];

    setExpandedTeams((current) => {
      const next = Object.fromEntries(
        buildTeamHierarchyList(nextTeams).map((team) => [
          team.key,
          current[team.key] ?? true,
        ]),
      );

      if (activeTeamKey) {
        next[activeTeamKey] = true;
      }

      return next;
    });
  }, [activeTeamKey, teamKey, teamName, teams]);

  async function removeFavorite(favorite: SidebarFavorite) {
    const nextFavorites = favorites.filter((entry) => entry.id !== favorite.id);
    setFavorites(nextFavorites);

    const response = await fetch(
      `/api/sidebar/favorites?objectType=${encodeURIComponent(
        favorite.objectType,
      )}&objectId=${encodeURIComponent(favorite.objectId)}`,
      { method: "DELETE", credentials: "include" },
    );

    if (!response.ok) {
      void syncFavorites();
      return;
    }

    window.dispatchEvent(new Event(SIDEBAR_FAVORITES_CHANGED_EVENT));
  }

  async function moveFavorite(favoriteId: string, direction: -1 | 1) {
    const currentIndex = favorites.findIndex(
      (favorite) => favorite.id === favoriteId,
    );
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= favorites.length) {
      return;
    }

    const nextFavorites = [...favorites];
    const [movedFavorite] = nextFavorites.splice(currentIndex, 1);
    nextFavorites.splice(nextIndex, 0, movedFavorite);
    setFavorites(nextFavorites);

    const response = await fetch("/api/sidebar/favorites", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        orderedIds: nextFavorites.map((favorite) => favorite.id),
      }),
    });

    if (!response.ok) {
      void syncFavorites();
    }
  }

  function updateSidebarPreferences(patch: AccountPreferencesPatch) {
    const nextPreferences = mergeAccountPreferences(localPreferences, patch);

    setLocalPreferences(nextPreferences);
    dispatchAccountPreferencesChanged(nextPreferences);
    setPreferenceSaveState("saving");

    void fetch("/api/account/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ accountPreferences: patch }),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to save account preferences");
        }

        return (await response.json()) as {
          accountPreferences?: Partial<AccountPreferences>;
        };
      })
      .then((data) => {
        const savedPreferences = mergeAccountPreferences(
          nextPreferences,
          data.accountPreferences ?? {},
        );
        setLocalPreferences(savedPreferences);
        dispatchAccountPreferencesChanged(savedPreferences);
        setPreferenceSaveState("saved");
      })
      .catch(() => {
        setPreferenceSaveState("error");
      });
  }

  return (
    <SidebarWorkspaceSlugContext.Provider value={workspaceSlug}>
      <aside className="flex h-screen w-[260px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-sidebar-bg)] px-3 py-3 transition-colors">
        <div className="mb-3 flex items-center justify-between">
          <div className="relative">
            <button
              type="button"
              aria-label="Workspace switcher"
              aria-expanded={workspaceMenuOpen}
              onClick={() => {
                setWorkspaceMenuOpen(!workspaceMenuOpen);
                setHelpMenuOpen(false);
              }}
              className="flex items-center gap-2 rounded-[6px] border border-transparent px-1.5 py-1 text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              <div className="flex h-5 w-5 items-center justify-center rounded-[6px] bg-[var(--color-accent)] text-[10px] font-bold text-white shadow-[var(--shadow-editorial-sm)]">
                {workspaceInitials}
              </div>
              <span className="max-w-[124px] truncate text-[13px] font-semibold tracking-[-0.01em]">
                {workspaceName}
              </span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`text-[var(--color-text-secondary)] transition-transform ${
                  workspaceMenuOpen ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {workspaceMenuOpen && (
              <div className="absolute left-0 top-full z-20 mt-2 min-w-[220px] rounded-[10px] border border-[var(--color-border-strong)] bg-[var(--color-content-bg)] p-1 shadow-[var(--shadow-editorial-md)]">
                <div className="px-3 py-2 text-[11px] font-medium font-mono uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                  Workspace
                </div>
                <button
                  type="button"
                  disabled
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] text-[var(--color-text-primary)]"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-[6px] bg-[var(--color-accent)] text-[10px] font-bold text-white shadow-[var(--shadow-editorial-sm)]">
                    {workspaceInitials}
                  </span>
                  <span className="truncate">{workspaceName}</span>
                </button>
                <Link
                  href={withWorkspaceSlug("/settings/workspace", workspaceSlug)}
                  className="block rounded-md px-3 py-2 text-[13px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                >
                  Workspace settings
                </Link>
              </div>
            )}
          </div>

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-transparent text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              aria-label="Search"
              onClick={() =>
                window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))
              }
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </button>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-transparent text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              aria-label="Create issue"
              onClick={onCreateIssue}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
            </button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto">
          {isVisible("inbox") && (
            <SidebarLink
              href="/inbox"
              label="Inbox"
              badge={inboxUnreadCount}
              badgeStyle={badgeStyle}
              active={pathname.startsWith("/inbox")}
              icon={
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  role="img"
                  aria-label="Inbox icon"
                >
                  <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                  <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                </svg>
              }
            />
          )}
          {isVisible("myIssues") && (
            <SidebarLink
              href="/my-issues/assigned"
              label="My Issues"
              active={pathname.startsWith("/my-issues")}
              icon={
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  role="img"
                  aria-label="My Issues icon"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              }
            />
          )}

          {(favorites.length > 0 || favoritesLoading) && (
            <>
              <SectionHeader label="Favorites" />
              {favorites.map((favorite, index) => (
                <div
                  key={favorite.id}
                  className="group flex items-center gap-1"
                  title={favorite.context ?? favorite.label}
                >
                  <div className="min-w-0 flex-1">
                    <SidebarLink
                      href={favorite.href}
                      label={favorite.label}
                      active={pathname === favorite.href}
                      icon={<span aria-hidden="true">★</span>}
                    />
                  </div>
                  {managingFavorites && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        aria-label={`Move ${favorite.label} up`}
                        disabled={index === 0}
                        onClick={() => void moveFavorite(favorite.id, -1)}
                        className="rounded px-1 text-[11px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${favorite.label} down`}
                        disabled={index === favorites.length - 1}
                        onClick={() => void moveFavorite(favorite.id, 1)}
                        className="rounded px-1 text-[11px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${favorite.label} from favorites`}
                        onClick={() => void removeFavorite(favorite)}
                        className="rounded px-1 text-[11px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setManagingFavorites((current) => !current)}
                className="ml-6 rounded-md px-2 py-1 text-[11px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                {managingFavorites ? "Done managing" : "Manage favorites"}
              </button>
            </>
          )}

          <SectionHeader label="Workspace" />
          {isVisible("projects") && (
            <SidebarLink
              href="/projects/all"
              label="Projects"
              active={isWorkspaceProjectsRoute(pathname)}
              icon={
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  role="img"
                  aria-label="Projects icon"
                >
                  <path d="M2 17 12 22 22 17" />
                  <path d="M2 12 12 17 22 12" />
                  <path d="M12 2 2 7 12 12 22 7Z" />
                </svg>
              }
            />
          )}
          {isVisible("views") && (
            <SidebarLink
              href="/views"
              label="Views"
              active={isWorkspaceViewsRoute(pathname)}
              icon={
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  role="img"
                  aria-label="Views icon"
                >
                  <path d="M5 12s2.545-5 7-5c4.454 0 7 5 7 5s-2.546 5-7 5c-4.455 0-7-5-7-5z" />
                  <path d="M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
                </svg>
              }
            />
          )}

          <button
            type="button"
            aria-expanded={moreExpanded}
            onClick={() => setMoreExpanded(!moreExpanded)}
            className="flex w-full items-center gap-2.5 rounded-[6px] border border-transparent px-2 py-[6px] text-[13px] text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="1" />
                <circle cx="19" cy="12" r="1" />
                <circle cx="5" cy="12" r="1" />
              </svg>
            </span>
            <span>More</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`ml-auto transition-transform ${moreExpanded ? "rotate-90" : ""}`}
              aria-hidden="true"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
          {moreExpanded && (
            <div className="ml-4 border-l border-[var(--color-border)] pl-2">
              <SidebarLink
                href="/agent"
                label="Agent"
                active={pathname.startsWith("/agent")}
                icon={
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    role="img"
                    aria-label="Agent icon"
                  >
                    <path d="M12 8V4H8" />
                    <rect x="4" y="8" width="16" height="12" rx="3" />
                    <path d="M9 13h.01" />
                    <path d="M15 13h.01" />
                    <path d="M10 17h4" />
                  </svg>
                }
              />
              <SidebarLink
                href="/members"
                label="Members"
                active={pathname === "/members"}
                icon={
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    role="img"
                    aria-label="Members icon"
                  >
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                }
              />
              <SidebarLink
                href="/teams"
                label="Teams"
                active={pathname === "/teams"}
                icon={
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    role="img"
                    aria-label="Teams icon"
                  >
                    <rect x="3" y="4" width="7" height="7" rx="1" />
                    <rect x="14" y="4" width="7" height="7" rx="1" />
                    <rect x="3" y="15" width="7" height="7" rx="1" />
                    <rect x="14" y="15" width="7" height="7" rx="1" />
                  </svg>
                }
              />
              <SidebarMenuButton
                label="Customize sidebar"
                onClick={() => {
                  setCustomizeSidebarOpen(true);
                  setMoreExpanded(false);
                }}
                icon={
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    role="img"
                    aria-label="Customize sidebar icon"
                  >
                    <path d="M4 5h16" />
                    <path d="M4 12h10" />
                    <path d="M4 19h7" />
                    <path d="M18 15v6" />
                    <path d="M15 18h6" />
                  </svg>
                }
              />
            </div>
          )}

          <SectionHeader
            label="Your teams"
            collapsible
            collapsed={!teamExpanded}
            onToggle={() => setTeamExpanded(!teamExpanded)}
          />
          {teamExpanded &&
            orderedTeams.map((team) => {
              const teamSectionActive =
                pathname === `/team/${team.key}/triage` ||
                isTeamIssuesRoute(pathname, team.key) ||
                isTeamProjectsRoute(pathname, team.key) ||
                isTeamViewsRoute(pathname, team.key) ||
                isTeamAnalyticsRoute(pathname, team.key);

              return (
                <div key={team.key}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedTeams((current) => ({
                        ...current,
                        [team.key]: !current[team.key],
                      }))
                    }
                    className={`flex w-full items-center gap-2 rounded-[6px] border border-transparent px-2 py-[6px] text-[13px] transition-colors ${
                      teamSectionActive
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text-primary)] shadow-[var(--shadow-editorial-sm)]"
                        : "text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                    }`}
                    style={{ paddingLeft: `${8 + team.depth * 16}px` }}
                  >
                    {team.depth > 0 ? (
                      <span className="h-px w-3 shrink-0 bg-[var(--color-surface-subtle)]" />
                    ) : null}
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[var(--color-accent)] text-[8px] font-bold text-white">
                      {team.key.charAt(0)}
                    </span>
                    <span className="truncate">{team.name}</span>
                    {team.retiredAt ? (
                      <span className="rounded border border-amber-500/30 px-1 text-[10px] uppercase tracking-wide text-amber-300">
                        Retired
                      </span>
                    ) : null}
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`ml-auto transition-transform ${
                        expandedTeams[team.key] ? "rotate-90" : ""
                      }`}
                      aria-hidden="true"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                  {expandedTeams[team.key] && (
                    <>
                      <SidebarLink
                        href={`/team/${team.key}/triage`}
                        label="Triage"
                        active={pathname === `/team/${team.key}/triage`}
                        indent
                        icon={
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            role="img"
                            aria-label="Triage icon"
                          >
                            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                          </svg>
                        }
                      />
                      <SidebarLink
                        href={`/team/${team.key}/all`}
                        label="Issues"
                        active={isTeamIssuesRoute(pathname, team.key)}
                        indent
                        icon={
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            role="img"
                            aria-label="Issues icon"
                          >
                            <circle cx="12" cy="12" r="10" />
                            <path d="m9 12 2 2 4-4" />
                          </svg>
                        }
                      />
                      <SidebarLink
                        href={`/team/${team.key}/projects`}
                        label="Projects"
                        active={isTeamProjectsRoute(pathname, team.key)}
                        indent
                        icon={
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            role="img"
                            aria-label="Team Projects icon"
                          >
                            <path d="M2 17 12 22 22 17" />
                            <path d="M2 12 12 17 22 12" />
                            <path d="M12 2 2 7 12 12 22 7Z" />
                          </svg>
                        }
                      />
                      <SidebarLink
                        href={`/team/${team.key}/views`}
                        label="Views"
                        active={isTeamViewsRoute(pathname, team.key)}
                        indent
                        icon={
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            role="img"
                            aria-label="Team Views icon"
                          >
                            <path d="M5 12s2.545-5 7-5c4.454 0 7 5 7 5s-2.546 5-7 5c-4.455 0-7-5-7-5z" />
                            <path d="M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
                          </svg>
                        }
                      />
                      <SidebarLink
                        href={`/team/${team.key}/analytics`}
                        label="Insights"
                        active={isTeamAnalyticsRoute(pathname, team.key)}
                        indent
                        icon={
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            role="img"
                            aria-label="Team Insights icon"
                          >
                            <path d="M3 3v18h18" />
                            <path d="m7 14 3-3 3 2 5-6" />
                            <path d="M18 7h-4" />
                            <path d="M18 7v4" />
                          </svg>
                        }
                      />
                    </>
                  )}
                </div>
              );
            })}

          <SectionHeader label="Try" />
          {isVisible("initiatives") && (
            <SidebarLink
              href="/initiatives"
              label="Initiatives"
              active={pathname.startsWith("/initiatives")}
              icon={
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  role="img"
                  aria-label="Initiatives icon"
                >
                  <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                  <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                  <path d="M4 22h16" />
                  <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                  <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                  <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                </svg>
              }
            />
          )}
          {isVisible("cycles") && (
            <SidebarLink
              href={`/team/${teamKey}/cycles`}
              label="Cycles"
              active={pathname.includes("/cycles")}
              icon={
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  role="img"
                  aria-label="Cycles icon"
                >
                  <path d="M21.5 2v6h-6" />
                  <path d="M2.5 22v-6h6" />
                  <path d="M22 11.5A10 10 0 0 0 3.2 7.2" />
                  <path d="M2 12.5a10 10 0 0 0 18.8 4.3" />
                </svg>
              }
            />
          )}
        </nav>

        <div className="relative mt-auto pt-2">
          {helpMenuOpen && (
            <div className="absolute bottom-9 left-0 z-20 min-w-[220px] rounded-[10px] border border-[var(--color-border-strong)] bg-[var(--color-content-bg)] p-1 shadow-[var(--shadow-editorial-md)]">
              <a
                href="https://linear.app/docs"
                target="_blank"
                rel="noreferrer"
                className="block rounded-md px-3 py-2 text-[13px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                Docs
              </a>
              <button
                type="button"
                onClick={() => {
                  openShortcuts(helpButtonRef.current);
                }}
                className="block w-full rounded-md px-3 py-2 text-left text-[13px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                Keyboard shortcuts
              </button>
              <Link
                href={withWorkspaceSlug("/settings", workspaceSlug)}
                className="block rounded-md px-3 py-2 text-[13px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                Settings
              </Link>
            </div>
          )}
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-transparent text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            aria-label="Help"
            aria-expanded={helpMenuOpen}
            ref={helpButtonRef}
            onClick={() => {
              setHelpMenuOpen(!helpMenuOpen);
              setWorkspaceMenuOpen(false);
            }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <path d="M12 17h.01" />
            </svg>
          </button>
        </div>

        {shortcutsOpen && (
          <div className="fixed inset-0 z-30 flex items-center justify-center bg-[rgba(20,18,14,0.40)] p-4 backdrop-blur-[2px]">
            <dialog
              id="keyboard-shortcuts-dialog"
              open
              aria-modal="true"
              aria-labelledby="keyboard-shortcuts-title"
              className="max-h-[80vh] w-full max-w-[560px] overflow-y-auto rounded-[10px] border border-[var(--color-border-strong)] bg-[var(--color-content-bg)] p-5 shadow-[var(--shadow-editorial-md)]"
            >
              <div className="flex items-center justify-between">
                <h2
                  id="keyboard-shortcuts-title"
                  className="text-[16px] font-semibold text-[var(--color-text-primary)]"
                >
                  Keyboard shortcuts
                </h2>
                <button
                  type="button"
                  aria-label="Close shortcuts"
                  onClick={closeShortcuts}
                  ref={shortcutsCloseButtonRef}
                  className="rounded-md p-1 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>

              <div className="mt-4 space-y-5 text-[13px] text-[var(--color-text-secondary)]">
                {SHORTCUTS_BY_CATEGORY.map((group) => (
                  <section
                    key={group.category}
                    aria-labelledby={`shortcut-${group.category}`}
                  >
                    <h3
                      id={`shortcut-${group.category}`}
                      className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]"
                    >
                      {group.category}
                    </h3>
                    <div className="space-y-2">
                      {group.shortcuts.map((shortcut) => (
                        <div
                          key={shortcut.id}
                          className="flex items-start justify-between gap-4"
                        >
                          <div>
                            <div className="text-[var(--color-text-primary)]">
                              {shortcut.label}
                            </div>
                            {shortcut.description && (
                              <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">
                                {shortcut.description}
                              </div>
                            )}
                          </div>
                          <kbd
                            aria-label={formatShortcutKeys(shortcut.keys)}
                            className="shrink-0 rounded border border-[var(--color-border)] px-2 py-1 text-[var(--color-text-primary)]"
                          >
                            {shortcut.keys.join(" ")}
                          </kbd>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </dialog>
          </div>
        )}
        {customizeSidebarOpen && (
          <SidebarCustomizeModal
            preferences={localPreferences}
            saveState={preferenceSaveState}
            onClose={() => setCustomizeSidebarOpen(false)}
            onUpdate={updateSidebarPreferences}
          />
        )}
      </aside>
    </SidebarWorkspaceSlugContext.Provider>
  );
}
