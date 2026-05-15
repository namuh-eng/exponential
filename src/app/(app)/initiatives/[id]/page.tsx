"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
import { EmptyState } from "@/components/empty-state";
import { InitiativeHealthBadge } from "@/components/initiative-health-badge";
import { InitiativeProjectList } from "@/components/initiative-project-list";
import { InitiativeStatusBadge } from "@/components/initiative-status-badge";
import type {
  InitiativeActivityEntry,
  InitiativeHealth,
  InitiativeUpdateHealth,
} from "@/lib/initiative-detail";
import { withWorkspaceSlug } from "@/lib/workspace-paths";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

interface LinkedProject {
  id: string;
  name: string;
  status: string;
  icon: string | null;
  slug: string;
  completedIssueCount: number;
  issueCount: number;
}

interface AvailableProject {
  id: string;
  name: string;
  icon: string | null;
  slug: string;
  status: string;
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

interface InitiativeSummary {
  id: string;
  name: string;
  status?: "active" | "planned" | "completed";
  parentInitiativeId?: string | null;
}

interface InitiativeUpdate {
  id: string;
  health: InitiativeUpdateHealth;
  body: string;
  actorName: string;
  actorImage: string | null;
  createdAt: string;
}

interface InitiativeDetailResponse {
  initiative: {
    id: string;
    name: string;
    description: string | null;
    status: "active" | "planned" | "completed";
    ownerId: string | null;
    owner: WorkspaceMember | null;
    teams: WorkspaceTeam[];
    startDate: string | null;
    targetDate: string | null;
    timeframe: string | null;
    health: InitiativeHealth;
    parentInitiativeId: string | null;
    parentInitiative: InitiativeSummary | null;
    childInitiatives: InitiativeSummary[];
    projectCount: number;
    completedProjectCount: number;
    createdAt: string;
    updatedAt: string;
  };
  projects: LinkedProject[];
  availableProjects: AvailableProject[];
  workspaceMembers: WorkspaceMember[];
  workspaceTeams: WorkspaceTeam[];
  availableParentInitiatives: InitiativeSummary[];
  updates: InitiativeUpdate[];
  activity: InitiativeActivityEntry[];
}

function formatUpdateDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function toDateInputValue(value: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

export default function InitiativeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<InitiativeDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedChildId, setSelectedChildId] = useState("");
  const [updateDraft, setUpdateDraft] = useState("");
  const [updateHealth, setUpdateHealth] =
    useState<InitiativeUpdateHealth>("onTrack");
  const [saving, setSaving] = useState(false);
  const [unlinkingProjectId, setUnlinkingProjectId] = useState<string | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const workspaceSlug = useAppShellContext()?.workspaceSlug;
  const initiativesHref = withWorkspaceSlug("/initiatives", workspaceSlug);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/initiatives/${params.id}`);
      if (!res.ok) {
        setData(null);
        return;
      }
      const json = (await res.json()) as InitiativeDetailResponse;
      setData({
        ...json,
        workspaceMembers: json.workspaceMembers ?? [],
        workspaceTeams: json.workspaceTeams ?? [],
        availableParentInitiatives: json.availableParentInitiatives ?? [],
        updates: json.updates ?? [],
        activity: json.activity ?? [],
        initiative: {
          ...json.initiative,
          ownerId: json.initiative.ownerId ?? null,
          owner: json.initiative.owner ?? null,
          teams: json.initiative.teams ?? [],
          startDate: json.initiative.startDate ?? null,
          targetDate: json.initiative.targetDate ?? null,
          timeframe: json.initiative.timeframe ?? null,
          health: json.initiative.health ?? "unknown",
          parentInitiativeId: json.initiative.parentInitiativeId ?? null,
          parentInitiative: json.initiative.parentInitiative ?? null,
          childInitiatives: json.initiative.childInitiatives ?? [],
        },
      });
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  useEffect(() => {
    if (!data) {
      return;
    }

    if (
      data.availableProjects.length > 0 &&
      !data.availableProjects.some(
        (project) => project.id === selectedProjectId,
      )
    ) {
      setSelectedProjectId(data.availableProjects[0].id);
      return;
    }

    if (data.availableProjects.length === 0 && selectedProjectId) {
      setSelectedProjectId("");
    }
  }, [data, selectedProjectId]);

  useEffect(() => {
    if (!data) {
      return;
    }
    const candidates = data.availableParentInitiatives.filter(
      (candidate) => candidate.parentInitiativeId !== data.initiative.id,
    );
    if (
      candidates.length > 0 &&
      !candidates.some((candidate) => candidate.id === selectedChildId)
    ) {
      setSelectedChildId(candidates[0].id);
      return;
    }
    if (candidates.length === 0 && selectedChildId) {
      setSelectedChildId("");
    }
  }, [data, selectedChildId]);

  const completionPercent = useMemo(() => {
    if (!data || data.initiative.projectCount === 0) {
      return 0;
    }

    return Math.round(
      (data.initiative.completedProjectCount / data.initiative.projectCount) *
        100,
    );
  }, [data]);

  const patchInitiative = useCallback(
    async (payload: Record<string, unknown>) => {
      setSaving(true);
      setErrorMessage(null);

      try {
        const res = await fetch(`/api/initiatives/${params.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const json = await res.json();
        if (!res.ok) {
          setErrorMessage(json.error ?? "Unable to update initiative.");
          return false;
        }

        setData(json);
        return true;
      } catch {
        setErrorMessage("Unable to update initiative.");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [params.id],
  );

  async function handleDelete() {
    if (
      !window.confirm(
        "Delete this initiative? Linked project mappings will be removed.",
      )
    ) {
      return;
    }

    setSaving(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/initiatives/${params.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setErrorMessage(json?.error ?? "Unable to delete initiative.");
        return;
      }

      router.push(initiativesHref);
    } catch {
      setErrorMessage("Unable to delete initiative.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUnlink(projectId: string) {
    setUnlinkingProjectId(projectId);
    const success = await patchInitiative({ removeProjectId: projectId });
    if (success && selectedProjectId === "") {
      await fetchDetail();
    }
    setUnlinkingProjectId(null);
  }

  async function handlePostUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const success = await patchInitiative({
      initiativeUpdate: updateDraft,
      updateHealth,
    });

    if (success) {
      setUpdateDraft("");
      setUpdateHealth("onTrack");
    }
  }

  async function handleCreateChildInitiative() {
    const name = window.prompt("Name the child initiative");
    if (!name?.trim()) {
      return;
    }
    setSaving(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/initiatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          parentInitiativeId: params.id,
          status: "planned",
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setErrorMessage(json?.error ?? "Unable to create child initiative.");
        return;
      }
      await fetchDetail();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  if (!data) {
    return (
      <EmptyState
        title="Initiative not found"
        description="This initiative may have been deleted."
      />
    );
  }

  const selectedTeamIds = new Set(
    (data.initiative.teams ?? []).map((team) => team.id),
  );
  const childCandidates = (data.availableParentInitiatives ?? []).filter(
    (candidate) => candidate.parentInitiativeId !== data.initiative.id,
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-2">
        <button
          type="button"
          onClick={() => router.push(initiativesHref)}
          className="flex items-center gap-1 text-[13px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
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
            <path d="m15 18-6-6 6-6" />
          </svg>
          Initiatives
        </button>
        <span className="text-[var(--color-text-tertiary)]">/</span>
        <h1 className="sr-only">{data.initiative.name}</h1>
        <input
          aria-label="Initiative name"
          value={data.initiative.name}
          onChange={(event) =>
            setData({
              ...data,
              initiative: { ...data.initiative, name: event.target.value },
            })
          }
          onBlur={(event) => void patchInitiative({ name: event.target.value })}
          disabled={saving}
          className="min-w-[220px] rounded-md border border-transparent bg-transparent px-2 py-1 text-[15px] font-medium text-[var(--color-text-primary)] hover:border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60"
        />
        <InitiativeStatusBadge status={data.initiative.status} />
        <InitiativeHealthBadge health={data.initiative.health} />
        <div className="flex-1" />
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard?.writeText(window.location.href)
          }
          className="rounded-md px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Copy link
        </button>
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={saving}
          className="rounded-md px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:text-rose-300 disabled:opacity-60"
        >
          Delete
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] overflow-hidden">
        <main className="overflow-y-auto">
          {errorMessage ? (
            <div className="border-b border-[var(--color-border)] px-4 py-3 text-[12px] text-rose-300">
              {errorMessage}
            </div>
          ) : null}

          <section className="border-b border-[var(--color-border)] px-4 py-4">
            <label
              htmlFor="initiative-description"
              className="mb-2 block text-[12px] text-[var(--color-text-secondary)]"
            >
              Description
            </label>
            <textarea
              id="initiative-description"
              aria-label="Initiative description"
              value={data.initiative.description ?? ""}
              onChange={(event) =>
                setData({
                  ...data,
                  initiative: {
                    ...data.initiative,
                    description: event.target.value,
                  },
                })
              }
              onBlur={(event) =>
                void patchInitiative({ description: event.target.value })
              }
              rows={3}
              placeholder="Describe the strategy, success criteria, and scope."
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          </section>

          <section className="flex items-center gap-4 border-b border-[var(--color-border)] px-4 py-3">
            <span className="text-[13px] text-[var(--color-text-secondary)]">
              Progress
            </span>
            <div className="flex items-center gap-3">
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-border)]">
                <div
                  className="h-full rounded-full bg-[var(--color-accent)] transition-all"
                  style={{ width: `${completionPercent}%` }}
                />
              </div>
              <span className="text-[12px] text-[var(--color-text-tertiary)]">
                {data.initiative.completedProjectCount} /{" "}
                {data.initiative.projectCount} projects completed
              </span>
            </div>
          </section>

          <section className="border-b border-[var(--color-border)] px-4 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[13px] font-medium text-[var(--color-text-primary)]">
                  Linked projects
                </h2>
                <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                  Initiatives track progress across projects that contribute to
                  the goal.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label="Available projects"
                  value={selectedProjectId}
                  onChange={(event) => setSelectedProjectId(event.target.value)}
                  disabled={saving || data.availableProjects.length === 0}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-2 py-1 text-[12px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60"
                >
                  {data.availableProjects.length === 0 ? (
                    <option value="">No projects left to link</option>
                  ) : (
                    data.availableProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="button"
                  onClick={() =>
                    void patchInitiative({ addProjectId: selectedProjectId })
                  }
                  disabled={saving || !selectedProjectId}
                  className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Link project
                </button>
              </div>
            </div>
            <InitiativeProjectList
              projects={data.projects}
              onUnlink={(projectId) => {
                void handleUnlink(projectId);
              }}
              unlinkingProjectId={unlinkingProjectId}
            />
            {data.projects.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed border-[var(--color-border)] px-4 py-4 text-center">
                <p className="text-[13px] text-[var(--color-text-tertiary)]">
                  No projects are linked yet.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    selectedProjectId &&
                    void patchInitiative({ addProjectId: selectedProjectId })
                  }
                  disabled={!selectedProjectId || saving}
                  className="mt-3 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60"
                >
                  Link first project
                </button>
              </div>
            ) : null}
          </section>

          <section className="border-b border-[var(--color-border)] px-4 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[13px] font-medium text-[var(--color-text-primary)]">
                  Child initiatives
                </h2>
                <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                  Break strategic work into nested roadmap initiatives.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label="Available child initiatives"
                  value={selectedChildId}
                  onChange={(event) => setSelectedChildId(event.target.value)}
                  disabled={saving || childCandidates.length === 0}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-2 py-1 text-[12px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60"
                >
                  {childCandidates.length === 0 ? (
                    <option value="">No initiatives available</option>
                  ) : (
                    childCandidates.map((initiative) => (
                      <option key={initiative.id} value={initiative.id}>
                        {initiative.name}
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="button"
                  onClick={() =>
                    void patchInitiative({ childInitiativeId: selectedChildId })
                  }
                  disabled={saving || !selectedChildId}
                  className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Add child
                </button>
              </div>
            </div>
            {data.initiative.childInitiatives.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-5 text-center">
                <p className="text-[13px] text-[var(--color-text-tertiary)]">
                  No child initiatives yet.
                </p>
                <button
                  type="button"
                  onClick={() => void handleCreateChildInitiative()}
                  disabled={saving}
                  className="mt-3 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] disabled:opacity-60"
                >
                  Create child initiative
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {data.initiative.childInitiatives.map((child) => (
                  <button
                    type="button"
                    key={child.id}
                    onClick={() =>
                      router.push(
                        withWorkspaceSlug(
                          `/initiatives/${child.id}`,
                          workspaceSlug,
                        ),
                      )
                    }
                    className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] px-3 py-2 text-left text-[13px] hover:bg-[var(--color-surface-hover)]"
                  >
                    <span className="text-[var(--color-text-primary)]">
                      {child.name}
                    </span>
                    {child.status ? (
                      <InitiativeStatusBadge status={child.status} />
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="px-4 py-4">
            <div className="mb-3">
              <h2 className="text-[13px] font-medium text-[var(--color-text-primary)]">
                Updates & activity
              </h2>
              <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                Share progress and review property, hierarchy, and project
                changes.
              </p>
            </div>

            <form
              onSubmit={handlePostUpdate}
              className="mb-4 rounded-xl border border-[var(--color-border)] p-3"
            >
              <div className="mb-3 flex items-center gap-2">
                <label
                  htmlFor="initiative-update-health"
                  className="text-[12px] text-[var(--color-text-secondary)]"
                >
                  Health
                </label>
                <select
                  id="initiative-update-health"
                  aria-label="Initiative update health"
                  value={updateHealth}
                  onChange={(event) =>
                    setUpdateHealth(
                      event.target.value as InitiativeUpdateHealth,
                    )
                  }
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-2 py-1 text-[12px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                >
                  <option value="onTrack">On track</option>
                  <option value="atRisk">At risk</option>
                  <option value="offTrack">Off track</option>
                </select>
              </div>
              <textarea
                value={updateDraft}
                onChange={(event) => setUpdateDraft(event.target.value)}
                rows={3}
                placeholder="Post the latest initiative update."
                className="mb-3 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-none"
              />
              <button
                type="submit"
                disabled={saving || !updateDraft.trim()}
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : "Post update"}
              </button>
            </form>

            {data.updates.length === 0 && data.activity.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-5 text-[13px] text-[var(--color-text-tertiary)]">
                No updates or activity yet.
              </p>
            ) : null}

            <div className="space-y-3">
              {data.updates.map((update) => (
                <article
                  key={update.id}
                  className="rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-4"
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <InitiativeHealthBadge health={update.health} />
                      <span className="text-[12px] text-[var(--color-text-secondary)]">
                        {update.actorName}
                      </span>
                    </div>
                    <span className="text-[11px] text-[var(--color-text-tertiary)]">
                      {formatUpdateDate(update.createdAt)}
                    </span>
                  </div>
                  <p className="text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
                    {update.body}
                  </p>
                </article>
              ))}

              {data.activity.map((entry) => (
                <article
                  key={entry.id}
                  className="rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-4"
                >
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="text-[12px] text-[var(--color-text-secondary)]">
                      {entry.actorName}
                    </span>
                    <span className="text-[11px] text-[var(--color-text-tertiary)]">
                      {formatUpdateDate(entry.createdAt)}
                    </span>
                  </div>
                  <p className="text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
                    {entry.message}
                  </p>
                </article>
              ))}
            </div>
          </section>
        </main>

        <aside className="overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-content-bg)] px-4 py-4">
          <h2 className="mb-4 text-[13px] font-medium text-[var(--color-text-primary)]">
            Roadmap properties
          </h2>
          <div className="space-y-4">
            <label className="block text-[12px] text-[var(--color-text-secondary)]">
              Status
              <select
                aria-label="Initiative status"
                value={data.initiative.status}
                onChange={(event) => {
                  void patchInitiative({ status: event.target.value });
                }}
                disabled={saving}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[12px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60"
              >
                <option value="active">Active</option>
                <option value="planned">Planned</option>
                <option value="completed">Completed</option>
              </select>
            </label>

            <label className="block text-[12px] text-[var(--color-text-secondary)]">
              Owner
              <select
                aria-label="Initiative owner"
                value={data.initiative.ownerId ?? ""}
                onChange={(event) => {
                  void patchInitiative({ ownerId: event.target.value || null });
                }}
                disabled={saving}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[12px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60"
              >
                <option value="">No owner</option>
                {data.workspaceMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="block text-[12px] text-[var(--color-text-secondary)]">
              <legend>Teams</legend>
              <div className="mt-1 space-y-1 rounded-md border border-[var(--color-border)] p-2">
                {data.workspaceTeams.length === 0 ? (
                  <p className="text-[12px] text-[var(--color-text-tertiary)]">
                    No teams in this workspace.
                  </p>
                ) : (
                  data.workspaceTeams.map((workspaceTeam) => (
                    <label
                      key={workspaceTeam.id}
                      className="flex items-center gap-2 text-[12px] text-[var(--color-text-primary)]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedTeamIds.has(workspaceTeam.id)}
                        onChange={(event) => {
                          const nextTeamIds = new Set(selectedTeamIds);
                          if (event.target.checked) {
                            nextTeamIds.add(workspaceTeam.id);
                          } else {
                            nextTeamIds.delete(workspaceTeam.id);
                          }
                          void patchInitiative({
                            teamIds: Array.from(nextTeamIds),
                          });
                        }}
                        disabled={saving}
                      />
                      {workspaceTeam.icon ?? "#"} {workspaceTeam.name}
                    </label>
                  ))
                )}
              </div>
            </fieldset>

            <label className="block text-[12px] text-[var(--color-text-secondary)]">
              Health
              <select
                aria-label="Initiative health"
                value={data.initiative.health}
                onChange={(event) => {
                  void patchInitiative({ health: event.target.value });
                }}
                disabled={saving}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[12px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60"
              >
                <option value="unknown">Unknown</option>
                <option value="onTrack">On track</option>
                <option value="atRisk">At risk</option>
                <option value="offTrack">Off track</option>
              </select>
            </label>

            <label className="block text-[12px] text-[var(--color-text-secondary)]">
              Start date
              <input
                aria-label="Initiative start date"
                type="date"
                value={toDateInputValue(data.initiative.startDate)}
                onChange={(event) => {
                  void patchInitiative({ startDate: event.target.value });
                }}
                disabled={saving}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[12px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60"
              />
            </label>

            <label className="block text-[12px] text-[var(--color-text-secondary)]">
              Target date
              <input
                aria-label="Initiative target date"
                type="date"
                value={toDateInputValue(data.initiative.targetDate)}
                onChange={(event) => {
                  void patchInitiative({ targetDate: event.target.value });
                }}
                disabled={saving}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[12px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60"
              />
            </label>

            <label className="block text-[12px] text-[var(--color-text-secondary)]">
              Timeframe
              <input
                aria-label="Initiative timeframe"
                value={data.initiative.timeframe ?? ""}
                onChange={(event) =>
                  setData({
                    ...data,
                    initiative: {
                      ...data.initiative,
                      timeframe: event.target.value,
                    },
                  })
                }
                onBlur={(event) =>
                  void patchInitiative({ timeframe: event.target.value })
                }
                placeholder="Q3 2026"
                disabled={saving}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[12px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60"
              />
            </label>

            <label className="block text-[12px] text-[var(--color-text-secondary)]">
              Parent initiative
              <select
                aria-label="Parent initiative"
                value={data.initiative.parentInitiativeId ?? ""}
                onChange={(event) => {
                  void patchInitiative({
                    parentInitiativeId: event.target.value || null,
                  });
                }}
                disabled={saving}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[12px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60"
              >
                <option value="">No parent</option>
                {data.availableParentInitiatives.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </aside>
      </div>
    </div>
  );
}
