"use client";

import { EmptyState } from "@/components/empty-state";
import { InitiativeRow } from "@/components/initiative-row";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type InitiativeStatus = "active" | "planned" | "completed";
type InitiativeHealth = "onTrack" | "atRisk" | "offTrack" | "unknown";
type TargetFilter = "any" | "set" | "unset" | "past" | "next90";
type ActiveProjectFilter = "any" | "withActive" | "needsUpdate" | "paused";
type SortKey = "targetDate" | "health" | "status" | "createdAt";
type GroupKey = "none" | "status" | "health" | "targetDate";

const statusLabels: Record<InitiativeStatus, string> = {
  active: "Active",
  planned: "Planned",
  completed: "Completed",
};

const healthLabels: Record<InitiativeHealth, string> = {
  onTrack: "On track",
  atRisk: "At risk",
  offTrack: "Off track",
  unknown: "Unknown",
};

const healthRank: Record<InitiativeHealth, number> = {
  offTrack: 0,
  atRisk: 1,
  unknown: 2,
  onTrack: 3,
};

function readQueryParam(name: string) {
  if (typeof window === "undefined") {
    return null;
  }

  return new URLSearchParams(window.location.search).get(name);
}

function isStatus(value: string | null): value is InitiativeStatus {
  return value === "active" || value === "planned" || value === "completed";
}

function isHealth(value: string | null): value is InitiativeHealth {
  return (
    value === "onTrack" ||
    value === "atRisk" ||
    value === "offTrack" ||
    value === "unknown"
  );
}

function formatTargetBucket(value?: string | null) {
  if (!value) {
    return "No target";
  }

  const target = new Date(value);
  const now = new Date();
  const days = Math.ceil((target.getTime() - now.getTime()) / 86_400_000);

  if (days < 0) {
    return "Past target";
  }
  if (days <= 90) {
    return "Next 90 days";
  }
  return "Later";
}

interface WorkspaceMember {
  id: string;
  name: string;
  image: string | null;
}

interface WorkspaceTeam {
  id: string;
  name: string;
  key: string;
  icon: string | null;
}

interface InitiativeData {
  id: string;
  name: string;
  description: string | null;
  status: InitiativeStatus;
  ownerId?: string | null;
  owner?: WorkspaceMember | null;
  teams?: WorkspaceTeam[];
  targetDate?: string | null;
  health?: InitiativeHealth;
  latestUpdate?: {
    id: string;
    body: string;
    health: Exclude<InitiativeHealth, "unknown">;
    createdAt: string;
  } | null;
  activeProjectHealthRollup?: {
    total: number;
    withUpdates: number;
    withoutUpdates: number;
    paused: number;
  } | null;
  projectCount: number;
  completedProjectCount: number;
  createdAt: string;
}

interface InitiativesResponse {
  initiatives: InitiativeData[];
  workspaceMembers?: WorkspaceMember[];
  workspaceTeams?: WorkspaceTeam[];
  initiativesSettings?: {
    enabled: boolean;
    projectRollups: boolean;
  };
}

export default function InitiativesPage() {
  const [data, setData] = useState<InitiativesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<InitiativeStatus>(() => {
    const value = readQueryParam("status");
    return isStatus(value) ? value : "active";
  });
  const [search, setSearch] = useState(() => readQueryParam("q") ?? "");
  const [ownerFilter, setOwnerFilter] = useState(
    () => readQueryParam("owner") ?? "any",
  );
  const [teamFilter, setTeamFilter] = useState(
    () => readQueryParam("team") ?? "any",
  );
  const [healthFilter, setHealthFilter] = useState<InitiativeHealth | "any">(
    () => {
      const value = readQueryParam("health");
      return isHealth(value) ? value : "any";
    },
  );
  const [targetFilter, setTargetFilter] = useState<TargetFilter>(() => {
    const value = readQueryParam("target");
    return value === "set" ||
      value === "unset" ||
      value === "past" ||
      value === "next90"
      ? value
      : "any";
  });
  const [activeProjectFilter, setActiveProjectFilter] =
    useState<ActiveProjectFilter>(() => {
      const value = readQueryParam("projects");
      return value === "withActive" ||
        value === "needsUpdate" ||
        value === "paused"
        ? value
        : "any";
    });
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const value = readQueryParam("sort");
    return value === "health" || value === "status" || value === "createdAt"
      ? value
      : "targetDate";
  });
  const [groupKey, setGroupKey] = useState<GroupKey>(() => {
    const value = readQueryParam("group");
    return value === "status" || value === "health" || value === "targetDate"
      ? value
      : "none";
  });
  const [showCreateForm, setShowCreateForm] = useState(false);
  const shortcutRef = useRef<{ key: string; timestamp: number } | null>(null);

  const openCreateForm = useCallback(() => {
    if (data?.initiativesSettings?.enabled === false) {
      return;
    }
    setShowCreateForm(true);
  }, [data?.initiativesSettings?.enabled]);

  const fetchInitiatives = useCallback(async () => {
    try {
      const res = await fetch("/api/initiatives");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInitiatives();
  }, [fetchInitiatives]);

  const handleCreate = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const name = formData.get("name") as string;
      const description = (formData.get("description") as string) || undefined;
      const ownerId = (formData.get("ownerId") as string) || undefined;
      const targetDate = (formData.get("targetDate") as string) || undefined;
      const health = (formData.get("health") as string) || "unknown";
      const teamIds = formData
        .getAll("teamIds")
        .filter(
          (value): value is string =>
            typeof value === "string" && Boolean(value),
        );

      const res = await fetch("/api/initiatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          status: activeTab,
          ownerId,
          teamIds,
          targetDate,
          health,
        }),
      });

      if (res.ok) {
        setShowCreateForm(false);
        fetchInitiatives();
      }
    },
    [activeTab, fetchInitiatives],
  );

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      const tagName = target.tagName.toLowerCase();
      return (
        target.isContentEditable ||
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select"
      );
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        isTypingTarget(event.target)
      ) {
        shortcutRef.current = null;
        return;
      }

      const key = event.key.toLowerCase();
      const now = Date.now();
      if (
        key === "i" &&
        shortcutRef.current?.key === "n" &&
        now - shortcutRef.current.timestamp < 1250
      ) {
        event.preventDefault();
        shortcutRef.current = null;
        openCreateForm();
        return;
      }

      shortcutRef.current = key === "n" ? { key, timestamp: now } : null;
    }

    function handleOpenCreateInitiative() {
      openCreateForm();
    }

    if (sessionStorage.getItem("open-create-initiative") === "1") {
      sessionStorage.removeItem("open-create-initiative");
      openCreateForm();
    }

    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener(
      "open-create-initiative",
      handleOpenCreateInitiative,
    );

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener(
        "open-create-initiative",
        handleOpenCreateInitiative,
      );
    };
  }, [openCreateForm]);

  const tabs: { id: InitiativeStatus; label: string }[] = [
    { id: "active", label: "Active" },
    { id: "planned", label: "Planned" },
    { id: "completed", label: "Completed" },
  ];

  useEffect(() => {
    const params = new URLSearchParams();
    if (activeTab !== "active") {
      params.set("status", activeTab);
    }
    if (search.trim()) {
      params.set("q", search.trim());
    }
    if (ownerFilter !== "any") {
      params.set("owner", ownerFilter);
    }
    if (teamFilter !== "any") {
      params.set("team", teamFilter);
    }
    if (healthFilter !== "any") {
      params.set("health", healthFilter);
    }
    if (targetFilter !== "any") {
      params.set("target", targetFilter);
    }
    if (activeProjectFilter !== "any") {
      params.set("projects", activeProjectFilter);
    }
    if (sortKey !== "targetDate") {
      params.set("sort", sortKey);
    }
    if (groupKey !== "none") {
      params.set("group", groupKey);
    }

    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
    if (nextUrl !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [
    activeProjectFilter,
    activeTab,
    groupKey,
    healthFilter,
    ownerFilter,
    search,
    sortKey,
    targetFilter,
    teamFilter,
  ]);

  const filteredInitiatives = useMemo(() => {
    const query = search.trim().toLowerCase();
    const now = new Date();
    const next90 = new Date(now);
    next90.setDate(now.getDate() + 90);

    return [...(data?.initiatives ?? [])]
      .filter((initiative) => {
        if (initiative.status !== activeTab) {
          return false;
        }
        if (
          query &&
          ![
            initiative.name,
            initiative.description,
            initiative.owner?.name,
            ...(initiative.teams ?? []).flatMap((team) => [
              team.name,
              team.key,
            ]),
          ]
            .filter(Boolean)
            .some((value) => value?.toLowerCase().includes(query))
        ) {
          return false;
        }
        if (
          ownerFilter !== "any" &&
          (initiative.owner?.id ?? "unassigned") !== ownerFilter
        ) {
          return false;
        }
        if (
          teamFilter !== "any" &&
          !(initiative.teams ?? []).some((team) => team.id === teamFilter)
        ) {
          return false;
        }
        if (
          healthFilter !== "any" &&
          (initiative.health ?? "unknown") !== healthFilter
        ) {
          return false;
        }

        const targetDate = initiative.targetDate
          ? new Date(initiative.targetDate)
          : null;
        if (targetFilter === "set" && !targetDate) {
          return false;
        }
        if (targetFilter === "unset" && targetDate) {
          return false;
        }
        if (targetFilter === "past" && (!targetDate || targetDate >= now)) {
          return false;
        }
        if (
          targetFilter === "next90" &&
          (!targetDate || targetDate < now || targetDate > next90)
        ) {
          return false;
        }

        const rollup = initiative.activeProjectHealthRollup;
        const projectRollupsEnabled =
          data?.initiativesSettings?.projectRollups !== false;
        if (
          projectRollupsEnabled &&
          activeProjectFilter === "withActive" &&
          !(rollup?.total && rollup.total > 0)
        ) {
          return false;
        }
        if (
          projectRollupsEnabled &&
          activeProjectFilter === "needsUpdate" &&
          !(rollup?.withoutUpdates && rollup.withoutUpdates > 0)
        ) {
          return false;
        }
        if (
          projectRollupsEnabled &&
          activeProjectFilter === "paused" &&
          !(rollup?.paused && rollup.paused > 0)
        ) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortKey === "health") {
          return (
            healthRank[a.health ?? "unknown"] -
            healthRank[b.health ?? "unknown"]
          );
        }
        if (sortKey === "status") {
          return a.status.localeCompare(b.status);
        }
        const aTime = new Date(
          sortKey === "createdAt"
            ? a.createdAt
            : (a.targetDate ?? "9999-12-31"),
        ).getTime();
        const bTime = new Date(
          sortKey === "createdAt"
            ? b.createdAt
            : (b.targetDate ?? "9999-12-31"),
        ).getTime();
        return aTime - bTime;
      });
  }, [
    activeProjectFilter,
    activeTab,
    data?.initiatives,
    data?.initiativesSettings?.projectRollups,
    healthFilter,
    ownerFilter,
    search,
    sortKey,
    targetFilter,
    teamFilter,
  ]);

  const groupedInitiatives = useMemo(() => {
    return filteredInitiatives.reduce<Record<string, InitiativeData[]>>(
      (groups, initiative) => {
        const label =
          groupKey === "status"
            ? statusLabels[initiative.status]
            : groupKey === "health"
              ? healthLabels[initiative.health ?? "unknown"]
              : groupKey === "targetDate"
                ? formatTargetBucket(initiative.targetDate)
                : "All initiatives";
        groups[label] = [...(groups[label] ?? []), initiative];
        return groups;
      },
      {},
    );
  }, [filteredInitiatives, groupKey]);

  const initiativesEnabled = data?.initiativesSettings?.enabled !== false;
  const projectRollupsEnabled =
    data?.initiativesSettings?.projectRollups !== false;

  const hasActiveFilters =
    search.trim() ||
    ownerFilter !== "any" ||
    teamFilter !== "any" ||
    healthFilter !== "any" ||
    targetFilter !== "any" ||
    activeProjectFilter !== "any" ||
    sortKey !== "targetDate" ||
    groupKey !== "none";

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-4 py-2">
        <h1 className="mr-4 text-[15px] font-medium text-[var(--color-text-primary)]">
          Initiatives
        </h1>
        {/* Tabs */}
        <div className="flex items-center gap-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md px-2.5 py-1 text-[13px] transition-colors ${
                activeTab === tab.id
                  ? "bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={openCreateForm}
          disabled={!initiativesEnabled}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>
            {initiativesEnabled ? "New initiative" : "Initiatives disabled"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-1.5 py-0.5 text-[11px] font-normal">
            <kbd className="font-medium not-italic">N</kbd>
            <span>then</span>
            <kbd className="font-medium not-italic">I</kbd>
          </span>
        </button>
      </div>

      <div
        className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-content-bg)] px-4 py-2"
        aria-label="Initiatives list controls"
      >
        <input
          aria-label="Search initiatives"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search initiatives..."
          className="min-w-56 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-none"
        />
        <select
          aria-label="Filter by owner"
          value={ownerFilter}
          onChange={(event) => setOwnerFilter(event.target.value)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-2 py-1.5 text-[13px] text-[var(--color-text-primary)]"
        >
          <option value="any">Any owner</option>
          <option value="unassigned">Unassigned</option>
          {data?.workspaceMembers?.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by team"
          value={teamFilter}
          onChange={(event) => setTeamFilter(event.target.value)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-2 py-1.5 text-[13px] text-[var(--color-text-primary)]"
        >
          <option value="any">Any team</option>
          {data?.workspaceTeams?.map((team) => (
            <option key={team.id} value={team.id}>
              {team.key} · {team.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by health"
          value={healthFilter}
          onChange={(event) =>
            setHealthFilter(event.target.value as InitiativeHealth | "any")
          }
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-2 py-1.5 text-[13px] text-[var(--color-text-primary)]"
        >
          <option value="any">Any health</option>
          {Object.entries(healthLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by target date"
          value={targetFilter}
          onChange={(event) =>
            setTargetFilter(event.target.value as TargetFilter)
          }
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-2 py-1.5 text-[13px] text-[var(--color-text-primary)]"
        >
          <option value="any">Any target</option>
          <option value="set">Has target</option>
          <option value="unset">No target</option>
          <option value="past">Past target</option>
          <option value="next90">Next 90 days</option>
        </select>
        <select
          aria-label="Filter by active project state"
          value={activeProjectFilter}
          onChange={(event) =>
            setActiveProjectFilter(event.target.value as ActiveProjectFilter)
          }
          disabled={!projectRollupsEnabled}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-2 py-1.5 text-[13px] text-[var(--color-text-primary)]"
        >
          <option value="any">
            {projectRollupsEnabled ? "Any projects" : "Project rollups off"}
          </option>
          <option value="withActive">Has active projects</option>
          <option value="needsUpdate">Needs project update</option>
          <option value="paused">Has paused projects</option>
        </select>
        <select
          aria-label="Sort initiatives"
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as SortKey)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-2 py-1.5 text-[13px] text-[var(--color-text-primary)]"
        >
          <option value="targetDate">Sort: target date</option>
          <option value="health">Sort: health</option>
          <option value="status">Sort: status</option>
          <option value="createdAt">Sort: created</option>
        </select>
        <select
          aria-label="Group initiatives"
          value={groupKey}
          onChange={(event) => setGroupKey(event.target.value as GroupKey)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-2 py-1.5 text-[13px] text-[var(--color-text-primary)]"
        >
          <option value="none">No grouping</option>
          <option value="status">Group: status</option>
          <option value="health">Group: health</option>
          <option value="targetDate">Group: target window</option>
        </select>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setOwnerFilter("any");
              setTeamFilter("any");
              setHealthFilter("any");
              setTargetFilter("any");
              setActiveProjectFilter("any");
              setSortKey("targetDate");
              setGroupKey("none");
            }}
            className="rounded-md px-2 py-1.5 text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            Clear view
          </button>
        )}
      </div>

      {showCreateForm && (
        <form
          onSubmit={handleCreate}
          className="border-b border-[var(--color-border)] bg-[var(--color-surface-hover)] px-4 py-3"
        >
          <div className="flex flex-col gap-3">
            <input
              name="name"
              type="text"
              placeholder="Initiative name"
              required
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-none"
            />
            <textarea
              name="description"
              placeholder="Summary or initiative document (optional)"
              rows={2}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-none"
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-[12px] text-[var(--color-text-secondary)]">
                Owner
                <select
                  name="ownerId"
                  aria-label="Initiative owner"
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                >
                  <option value="">No owner</option>
                  {data?.workspaceMembers?.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[12px] text-[var(--color-text-secondary)]">
                Target date
                <input
                  name="targetDate"
                  aria-label="Initiative target date"
                  type="date"
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                />
              </label>
              <label className="text-[12px] text-[var(--color-text-secondary)]">
                Health
                <select
                  name="health"
                  aria-label="Initiative health"
                  defaultValue="unknown"
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                >
                  <option value="unknown">Unknown</option>
                  <option value="onTrack">On track</option>
                  <option value="atRisk">At risk</option>
                  <option value="offTrack">Off track</option>
                </select>
              </label>
              <fieldset className="text-[12px] text-[var(--color-text-secondary)]">
                <legend>Teams</legend>
                <div className="mt-1 max-h-24 overflow-y-auto rounded-md border border-[var(--color-border)] px-2 py-1">
                  {data?.workspaceTeams?.length ? (
                    data.workspaceTeams.map((team) => (
                      <label
                        key={team.id}
                        className="flex items-center gap-2 py-1 text-[12px] text-[var(--color-text-primary)]"
                      >
                        <input type="checkbox" name="teamIds" value={team.id} />
                        {team.icon ?? "#"} {team.name}
                      </label>
                    ))
                  ) : (
                    <span className="text-[12px] text-[var(--color-text-tertiary)]">
                      No teams
                    </span>
                  )}
                </div>
              </fieldset>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:opacity-90"
              >
                Create initiative
              </button>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="rounded-md px-3 py-1.5 text-[13px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {filteredInitiatives.length === 0 ? (
          <EmptyState
            title={
              activeTab === "active"
                ? "No initiatives"
                : `No ${activeTab} initiatives`
            }
            description={
              hasActiveFilters
                ? "No initiatives match the current search, filters, and display options."
                : "Initiatives are larger, strategic product efforts that organize multiple projects toward a common goal."
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
                aria-label="Initiatives"
              >
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                <path d="M4 22h16" />
                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
              </svg>
            }
            action={{
              label: "Create initiative",
              onClick: openCreateForm,
            }}
          />
        ) : groupKey === "none" ? (
          filteredInitiatives.map((init) => (
            <InitiativeRow key={init.id} initiative={init} />
          ))
        ) : (
          Object.entries(groupedInitiatives).map(([label, initiatives]) => (
            <section key={label} aria-label={`${label} initiatives group`}>
              <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-hover)] px-4 py-1.5 text-[12px] font-medium text-[var(--color-text-secondary)]">
                {label} · {initiatives.length}
              </div>
              {initiatives.map((init) => (
                <InitiativeRow key={init.id} initiative={init} />
              ))}
            </section>
          ))
        )}
      </div>

      {/* Footer */}
      {filteredInitiatives.length > 0 && (
        <div className="flex items-center border-t border-[var(--color-border)] px-4 py-1.5 text-[12px] text-[var(--color-text-secondary)]">
          {filteredInitiatives.length} initiatives
        </div>
      )}
    </div>
  );
}
