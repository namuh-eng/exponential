"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import type { FilterCondition } from "@/components/filter-bar";
import { SidebarFavoriteButton } from "@/components/sidebar-favorite-button";
import { TeamRouteErrorState } from "@/components/team-route-error-state";
import {
  type ProjectViewSortOption,
  type ProjectViewStatusFilter,
  type ViewEntityType,
  type ViewScope,
  type ViewSummary,
  projectViewSortOptions,
  projectViewStatusOptions,
} from "@/lib/views";
import { withWorkspaceSlug } from "@/lib/workspace-paths";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

interface ViewTeam {
  id: string;
  key: string;
  name: string;
}

const ISSUE_FILTER_STORAGE_PREFIX = "whetline-filters:team:";
const PROJECT_VIEW_STORAGE_KEY = "whetline-project-view:workspace";

function getStorage(): Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
> | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storage = window.localStorage;
  if (
    !storage ||
    typeof storage.getItem !== "function" ||
    typeof storage.setItem !== "function" ||
    typeof storage.removeItem !== "function"
  ) {
    return null;
  }

  return storage;
}

function readStoredIssueFilters(teamKey: string): FilterCondition[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  const raw = storage.getItem(`${ISSUE_FILTER_STORAGE_PREFIX}${teamKey}`);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FilterCondition[]) : [];
  } catch {
    return [];
  }
}

function writeStoredIssueFilters(teamKey: string, filters: FilterCondition[]) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  if (filters.length === 0) {
    storage.removeItem(`${ISSUE_FILTER_STORAGE_PREFIX}${teamKey}`);
    return;
  }

  storage.setItem(
    `${ISSUE_FILTER_STORAGE_PREFIX}${teamKey}`,
    JSON.stringify(filters),
  );
}

function writeStoredProjectViewState(options: {
  statusFilter: ProjectViewStatusFilter;
  sortBy: ProjectViewSortOption;
  teamId: string | null;
}) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(PROJECT_VIEW_STORAGE_KEY, JSON.stringify(options));
}

function LayoutIcon({
  layout,
}: {
  layout: "list" | "board" | "timeline";
}) {
  if (layout === "board") {
    return (
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
        aria-label="Board layout"
      >
        <rect x="3" y="3" width="7" height="18" rx="1" />
        <rect x="14" y="3" width="7" height="10" rx="1" />
      </svg>
    );
  }

  return (
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
      aria-label="List layout"
    >
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function ViewRow({
  view,
  onOpen,
  onEdit,
  onDelete,
}: {
  view: ViewSummary;
  onOpen: (view: ViewSummary) => void;
  onEdit: (view: ViewSummary) => void;
  onDelete: (view: ViewSummary) => void;
}) {
  return (
    <div className="group flex min-h-[48px] items-center border-b border-[var(--color-border)] px-4 text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]">
      <button
        type="button"
        onClick={() => onOpen(view)}
        className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
      >
        <span className="text-[var(--color-text-secondary)]">
          <LayoutIcon layout={view.layout} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[var(--color-text-primary)]">
            {view.name}
          </span>
          <span className="block truncate text-[12px] text-[var(--color-text-secondary)]">
            {view.scope === "team" && view.teamName
              ? `${view.teamName} team view`
              : "Workspace view"}
          </span>
        </span>
      </button>

      <div className="hidden w-[180px] shrink-0 sm:block">
        {view.owner && (
          <div className="flex items-center justify-end gap-1.5">
            <span className="truncate text-[12px] text-[var(--color-text-secondary)]">
              {view.owner.name}
            </span>
            <Avatar
              name={view.owner.name}
              src={view.owner.image ?? undefined}
              size="sm"
            />
          </div>
        )}
      </div>

      <div className="ml-2 flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
        <SidebarFavoriteButton
          objectType="view"
          objectId={view.id}
          label={view.name}
          className="rounded-md px-2 py-1 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => onEdit(view)}
          className="rounded-md px-2 py-1 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)] hover:text-[var(--color-text-primary)]"
          aria-label={`Edit ${view.name}`}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(view)}
          className="rounded-md px-2 py-1 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)] hover:text-[var(--color-text-primary)]"
          aria-label={`Delete ${view.name}`}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function CreateViewModal({
  activeTab,
  teams,
  activeTeamKey,
  view,
  onClose,
  onSaved,
}: {
  activeTab: ViewEntityType;
  teams: ViewTeam[];
  activeTeamKey: string | null;
  view: ViewSummary | null;
  onClose: () => void;
  onSaved: (view: ViewSummary) => void;
}) {
  const [name, setName] = useState(view?.name ?? "");
  const [layout, setLayout] = useState<"list" | "board">(
    view?.layout === "board" ? "board" : "list",
  );
  const [isPersonal, setIsPersonal] = useState(view?.isPersonal ?? true);
  const [scope, setScope] = useState<ViewScope>(view?.scope ?? "workspace");
  const [teamId, setTeamId] = useState<string>(
    view?.teamId ??
      teams.find((team) => team.key === activeTeamKey)?.id ??
      teams[0]?.id ??
      "",
  );
  const [projectStatusFilter, setProjectStatusFilter] =
    useState<ProjectViewStatusFilter>(
      view?.filterState.projectStatusFilter ?? "all",
    );
  const [projectSortBy, setProjectSortBy] = useState<ProjectViewSortOption>(
    view?.filterState.projectSortBy ?? "created-desc",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === "issues") {
      setScope("team");
    }
  }, [activeTab]);

  const selectedTeam = teams.find((team) => team.id === teamId) ?? null;
  const capturedFilters =
    activeTab === "issues" && selectedTeam
      ? readStoredIssueFilters(selectedTeam.key)
      : [];

  const handleSubmit = async () => {
    if (!name.trim() || submitting) {
      return;
    }

    if (activeTab === "issues" && !selectedTeam) {
      setError("Select a team for issue views.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const payload = {
      name: name.trim(),
      layout: activeTab === "projects" ? "list" : layout,
      isPersonal,
      teamId: scope === "team" ? (selectedTeam?.id ?? null) : null,
      filterState: {
        entityType: activeTab,
        scope: activeTab === "issues" ? "team" : scope,
        issueFilters: activeTab === "issues" ? capturedFilters : [],
        projectStatusFilter,
        projectSortBy,
      },
    };

    try {
      const res = await fetch(view ? `/api/views/${view.id}` : "/api/views", {
        method: view ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(
          typeof body?.error === "string" ? body.error : "Unable to save view.",
        );
        return;
      }

      const data = await res.json();
      onSaved(data.view as ViewSummary);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-[440px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4 shadow-xl">
        <h2 className="mb-3 text-[14px] font-medium text-[var(--color-text-primary)]">
          {view ? "Edit view" : "Create view"}
        </h2>
        <input
          type="text"
          placeholder="View name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mb-3 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)]"
        />

        {activeTab === "issues" && (
          <>
            <div className="mb-3">
              <span className="mb-1 block text-[12px] text-[var(--color-text-secondary)]">
                Team
              </span>
              <select
                aria-label="Select view team"
                value={teamId}
                onChange={(event) => setTeamId(event.target.value)}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
              >
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">
              Uses {capturedFilters.length} saved filter
              {capturedFilters.length === 1 ? "" : "s"} from{" "}
              {selectedTeam?.name ?? "this team"}.
            </div>
          </>
        )}

        {activeTab === "projects" && (
          <>
            <div className="mb-3">
              <span className="mb-1 block text-[12px] text-[var(--color-text-secondary)]">
                Scope
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setScope("workspace")}
                  className={`rounded-md px-3 py-1.5 text-[12px] ${
                    scope === "workspace"
                      ? "bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  }`}
                >
                  Workspace
                </button>
                <button
                  type="button"
                  onClick={() => setScope("team")}
                  className={`rounded-md px-3 py-1.5 text-[12px] ${
                    scope === "team"
                      ? "bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  }`}
                >
                  Team
                </button>
              </div>
            </div>

            {scope === "team" && (
              <div className="mb-3">
                <span className="mb-1 block text-[12px] text-[var(--color-text-secondary)]">
                  Team
                </span>
                <select
                  aria-label="Select project view team"
                  value={teamId}
                  onChange={(event) => setTeamId(event.target.value)}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <label className="text-[12px] text-[var(--color-text-secondary)]">
                <span className="mb-1 block">Status</span>
                <select
                  aria-label="Select project status filter"
                  value={projectStatusFilter}
                  onChange={(event) =>
                    setProjectStatusFilter(
                      event.target.value as ProjectViewStatusFilter,
                    )
                  }
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                >
                  {projectViewStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-[12px] text-[var(--color-text-secondary)]">
                <span className="mb-1 block">Sort</span>
                <select
                  aria-label="Select project sort order"
                  value={projectSortBy}
                  onChange={(event) =>
                    setProjectSortBy(
                      event.target.value as ProjectViewSortOption,
                    )
                  }
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                >
                  {projectViewSortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}

        {activeTab === "issues" && (
          <div className="mb-3">
            <span className="mb-1 block text-[12px] text-[var(--color-text-secondary)]">
              Layout
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setLayout("list")}
                className={`rounded-md px-3 py-1.5 text-[12px] ${
                  layout === "list"
                    ? "bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => setLayout("board")}
                className={`rounded-md px-3 py-1.5 text-[12px] ${
                  layout === "board"
                    ? "bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                Board
              </button>
            </div>
          </div>
        )}

        <div className="mb-4">
          <span className="mb-1 block text-[12px] text-[var(--color-text-secondary)]">
            Visibility
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIsPersonal(true)}
              className={`rounded-md px-3 py-1.5 text-[12px] ${
                isPersonal
                  ? "bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              Personal
            </button>
            <button
              type="button"
              onClick={() => setIsPersonal(false)}
              className={`rounded-md px-3 py-1.5 text-[12px] ${
                !isPersonal
                  ? "bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              Shared
            </button>
          </div>
        </div>

        {error && <p className="mb-3 text-[12px] text-[#ff7676]">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!name.trim() || submitting}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
          >
            {view ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ViewsPage({
  initialTab,
  initialTeamKey,
  initialTeamKeyFromRoute = false,
  keepCanonicalTabRoute = false,
}: {
  initialTab: ViewEntityType;
  initialTeamKey?: string;
  initialTeamKeyFromRoute?: boolean;
  keepCanonicalTabRoute?: boolean;
}) {
  const router = useRouter();
  const params = useParams<{ key?: string }>();
  const searchParams = useSearchParams();
  const workspaceSlug = useAppShellContext()?.workspaceSlug;
  const [views, setViews] = useState<ViewSummary[]>([]);
  const [teams, setTeams] = useState<ViewTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ViewEntityType>(initialTab);
  const [editingView, setEditingView] = useState<ViewSummary | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const routeTeamKey = initialTeamKeyFromRoute ? params.key : undefined;
  const activeTeamKey =
    initialTeamKey ?? routeTeamKey ?? searchParams.get("team");

  const fetchViews = useCallback(async () => {
    try {
      const res = await fetch("/api/views");
      if (!res.ok) {
        return;
      }

      const data = await res.json();
      setViews(data.views ?? []);
      setTeams(data.teams ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    fetchViews();
  }, [fetchViews]);

  const filteredViews = useMemo(() => {
    return views.filter((view) => {
      if (view.entityType !== activeTab) {
        return false;
      }

      if (!activeTeamKey) {
        return true;
      }

      return view.teamKey === activeTeamKey;
    });
  }, [activeTab, activeTeamKey, views]);

  const personalViews = filteredViews.filter((view) => view.isPersonal);
  const sharedViews = filteredViews.filter((view) => !view.isPersonal);
  const activeTeam = teams.find((team) => team.key === activeTeamKey) ?? null;
  const teamRouteNotFound = Boolean(activeTeamKey && !activeTeam);

  const handleTabChange = (tab: ViewEntityType) => {
    setActiveTab(tab);
    if (keepCanonicalTabRoute && !initialTeamKey && !routeTeamKey) {
      return;
    }

    if (initialTeamKey || routeTeamKey) {
      router.push(
        withWorkspaceSlug(
          `/team/${encodeURIComponent(activeTeamKey ?? "")}/views/${tab}`,
          workspaceSlug,
        ),
      );
      return;
    }

    const basePath = tab === "issues" ? "/views/issues" : "/views/projects";
    const query = activeTeamKey
      ? `?team=${encodeURIComponent(activeTeamKey)}`
      : "";
    router.push(withWorkspaceSlug(`${basePath}${query}`, workspaceSlug));
  };

  const handleOpenView = (view: ViewSummary) => {
    if (view.entityType === "issues") {
      if (!view.teamKey) {
        return;
      }

      writeStoredIssueFilters(view.teamKey, view.filterState.issueFilters);
      router.push(
        withWorkspaceSlug(
          view.layout === "board"
            ? `/team/${view.teamKey}/board`
            : `/team/${view.teamKey}/all`,
          workspaceSlug,
        ),
      );
      return;
    }

    writeStoredProjectViewState({
      statusFilter: view.filterState.projectStatusFilter,
      sortBy: view.filterState.projectSortBy,
      teamId: view.teamId,
    });
    router.push(withWorkspaceSlug("/projects", workspaceSlug));
  };

  const handleDeleteView = async (view: ViewSummary) => {
    if (!window.confirm(`Delete ${view.name}?`)) {
      return;
    }

    const res = await fetch(`/api/views/${view.id}`, { method: "DELETE" });
    if (!res.ok) {
      return;
    }

    setViews((current) => current.filter((entry) => entry.id !== view.id));
  };

  const handleSavedView = (savedView: ViewSummary) => {
    if (!savedView) {
      return;
    }

    setViews((current) => {
      const next = current.filter((view) => view.id !== savedView.id);
      next.push(savedView);
      return next.sort((left, right) => left.name.localeCompare(right.name));
    });
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  if (teamRouteNotFound) {
    return <TeamRouteErrorState teamKey={activeTeamKey ?? ""} />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
        <h1 className="mr-2 text-[15px] font-medium text-[var(--color-text-primary)]">
          Views
        </h1>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            data-active={activeTab === "issues"}
            onClick={() => handleTabChange("issues")}
            className={`rounded-md px-2.5 py-1 text-[13px] ${
              activeTab === "issues"
                ? "bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            Issues
          </button>
          <button
            type="button"
            data-active={activeTab === "projects"}
            onClick={() => handleTabChange("projects")}
            className={`rounded-md px-2.5 py-1 text-[13px] ${
              activeTab === "projects"
                ? "bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            Projects
          </button>
        </div>
        {activeTeam && (
          <button
            type="button"
            onClick={() =>
              router.push(
                withWorkspaceSlug(
                  activeTab === "issues" ? "/views/issues" : "/views/projects",
                  workspaceSlug,
                ),
              )
            }
            className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-text-secondary)]"
          >
            {activeTeam.name}
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            setEditingView(null);
            setShowCreate(true);
          }}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          aria-label="Create view"
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
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
        </button>
      </div>

      {filteredViews.length === 0 ? (
        <EmptyState
          title="No views"
          description={
            activeTab === "issues"
              ? "Save team issue filters as custom views so you can jump back into focused lists."
              : "Save project filters and sorting as custom views so important roadmaps stay one click away."
          }
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
              aria-label="Views"
            >
              <path d="M5 12s2.545-5 7-5c4.454 0 7 5 7 5s-2.546 5-7 5c-4.455 0-7-5-7-5z" />
              <path d="M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
            </svg>
          }
          action={{
            label: "Create view",
            onClick: () => {
              setEditingView(null);
              setShowCreate(true);
            },
          }}
        />
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="flex h-[32px] items-center border-b border-[var(--color-border)] px-4 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
            <div className="min-w-0 flex-1">Name</div>
            <div className="hidden w-[180px] shrink-0 text-right sm:block">
              Owner
            </div>
            <div className="w-[150px] shrink-0 text-right">Actions</div>
          </div>

          {personalViews.length > 0 && (
            <>
              <div className="flex items-center px-4 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                <span>Personal views</span>
                <span className="ml-1.5 text-[10px] font-normal normal-case text-[var(--color-text-tertiary)]">
                  Only visible to you
                </span>
              </div>
              {personalViews.map((view) => (
                <ViewRow
                  key={view.id}
                  view={view}
                  onOpen={handleOpenView}
                  onEdit={(nextView) => {
                    setEditingView(nextView);
                    setShowCreate(true);
                  }}
                  onDelete={handleDeleteView}
                />
              ))}
            </>
          )}

          {sharedViews.length > 0 && (
            <>
              <div className="flex items-center px-4 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                Shared views
              </div>
              {sharedViews.map((view) => (
                <ViewRow
                  key={view.id}
                  view={view}
                  onOpen={handleOpenView}
                  onEdit={(nextView) => {
                    setEditingView(nextView);
                    setShowCreate(true);
                  }}
                  onDelete={handleDeleteView}
                />
              ))}
            </>
          )}
        </div>
      )}

      {showCreate && (
        <CreateViewModal
          activeTab={editingView?.entityType ?? activeTab}
          teams={teams}
          activeTeamKey={activeTeamKey}
          view={editingView}
          onClose={() => {
            setShowCreate(false);
            setEditingView(null);
          }}
          onSaved={handleSavedView}
        />
      )}
    </div>
  );
}
