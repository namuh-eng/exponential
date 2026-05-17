"use client";

import { EmptyState } from "@/components/empty-state";
import { InitiativeRow } from "@/components/initiative-row";
import { useCallback, useEffect, useRef, useState } from "react";

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
  status: "active" | "planned" | "completed";
  ownerId?: string | null;
  owner?: WorkspaceMember | null;
  teams?: WorkspaceTeam[];
  targetDate?: string | null;
  health?: "onTrack" | "atRisk" | "offTrack" | "unknown";
  latestUpdate?: {
    id: string;
    body: string;
    health: "onTrack" | "atRisk" | "offTrack";
    createdAt: string;
  } | null;
  activeProjectHealthRollup?: {
    total: number;
    withUpdates: number;
    withoutUpdates: number;
    paused: number;
  };
  projectCount: number;
  completedProjectCount: number;
  createdAt: string;
}

interface InitiativesResponse {
  initiatives: InitiativeData[];
  workspaceMembers?: WorkspaceMember[];
  workspaceTeams?: WorkspaceTeam[];
}

export default function InitiativesPage() {
  const [data, setData] = useState<InitiativesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "active" | "planned" | "completed"
  >("active");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const shortcutRef = useRef<{ key: string; timestamp: number } | null>(null);

  const openCreateForm = useCallback(() => {
    setShowCreateForm(true);
  }, []);

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

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  const tabs: { id: "active" | "planned" | "completed"; label: string }[] = [
    { id: "active", label: "Active" },
    { id: "planned", label: "Planned" },
    { id: "completed", label: "Completed" },
  ];

  const filteredInitiatives =
    data?.initiatives.filter((i) => i.status === activeTab) ?? [];

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
          className="inline-flex items-center gap-2 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:opacity-90"
        >
          <span>New initiative</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-1.5 py-0.5 text-[11px] font-normal">
            <kbd className="font-medium not-italic">N</kbd>
            <span>then</span>
            <kbd className="font-medium not-italic">I</kbd>
          </span>
        </button>
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
            description="Initiatives are larger, strategic product efforts that organize multiple projects toward a common goal."
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
        ) : (
          filteredInitiatives.map((init) => (
            <InitiativeRow key={init.id} initiative={init} />
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
