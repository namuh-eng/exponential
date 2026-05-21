"use client";

import { CreateIssueModal } from "@/components/create-issue-modal";
import { IssueRow, priorityMap } from "@/components/issue-row";
import { IssuesGroupHeader } from "@/components/issues-group-header";
import { MilestoneRow } from "@/components/milestone-row";
import {
  ProjectProperties,
  type ProjectPropertiesSaveInput,
} from "@/components/project-properties";
import { SidebarFavoriteButton } from "@/components/sidebar-favorite-button";
import { OPEN_PROJECT_UPDATE_EVENT } from "@/lib/command-palette";
import type {
  ProjectActivityEntry,
  ProjectResource,
} from "@/lib/project-detail";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type StatusCategory =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

interface ProjectDetail {
  id: string;
  name: string;
  description?: string | null;
  icon: string | null;
  slug: string;
  status: string;
  statusLabel?: string;
  priority: "none" | "urgent" | "high" | "medium" | "low";
  startDate: string | null;
  targetDate: string | null;
}

interface MilestoneData {
  id: string;
  name: string;
  description: string | null;
  issueCount: number;
  completedCount: number;
  progress: number;
}

interface IssueData {
  id: string;
  identifier: string;
  title: string;
  priority: string;
  assignee: { name: string; image?: string | null } | null;
  createdAt: string;
  href: string | null;
  labels: { id: string; name: string; color: string }[];
  projectMilestoneId: string | null;
}

interface StateGroup {
  state: { id: string; name: string; category: string; color: string };
  issues: IssueData[];
}

interface ProjectResponse {
  project: ProjectDetail;
  lead: { id: string; name: string; image?: string | null } | null;
  members: { id: string; name: string; image?: string | null }[];
  teams: { id: string; name: string; key: string }[];
  labels: { id: string; name: string; color: string }[];
  availableMembers: { id: string; name: string; image?: string | null }[];
  availableTeams: { id: string; name: string; key: string }[];
  availableLabels: { id: string; name: string; color: string }[];
  slackChannel: string | null;
  projectStatuses?: {
    key: string;
    name: string;
    color?: string;
    icon?: string;
  }[];
  resources: ProjectResource[];
  activity: ProjectActivityEntry[];
  milestones: MilestoneData[];
  issueGroups: StateGroup[];
  progress: {
    total: number;
    completed: number;
    percentage: number;
    assignees: { name: string; count: number }[];
    labels: { id: string; name: string; color: string; count: number }[];
  };
}

interface CreateIssueDefaults {
  stateId?: string;
  stateName?: string;
}

function formatRelativeTime(dateStr: string) {
  const now = Date.now();
  const time = new Date(dateStr).getTime();
  const diffMinutes = Math.round((now - time) / (1000 * 60));

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;

  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatCompactDate(dateStr: string | null) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function SectionCard({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[12px] font-medium text-[var(--color-text-primary)]">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

export function ProjectDetailPage() {
  const params = useParams<{ slug: string; workspaceSlug?: string }>();
  const [data, setData] = useState<ProjectResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "overview" | "activity" | "issues"
  >("overview");
  const [showResourceForm, setShowResourceForm] = useState(false);
  const [resourceType, setResourceType] = useState<"document" | "link">("link");
  const [resourceTitle, setResourceTitle] = useState("");
  const [resourceUrl, setResourceUrl] = useState("");
  const [showUpdateComposer, setShowUpdateComposer] = useState(false);
  const [projectUpdate, setProjectUpdate] = useState("");
  const [showDescriptionEditor, setShowDescriptionEditor] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [showCreateIssue, setShowCreateIssue] = useState(false);
  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(
    null,
  );
  const [milestoneName, setMilestoneName] = useState("");
  const [milestoneDescription, setMilestoneDescription] = useState("");
  const [createIssueDefaults, setCreateIssueDefaults] =
    useState<CreateIssueDefaults>({});
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const projectUpdateTextareaRef = useRef<HTMLTextAreaElement>(null);

  const projectApiPath = useCallback(() => {
    const base = `/api/projects/${encodeURIComponent(params.slug)}`;
    if (!params.workspaceSlug) {
      return base;
    }

    return `${base}?workspaceSlug=${encodeURIComponent(params.workspaceSlug)}`;
  }, [params.slug, params.workspaceSlug]);

  const openProjectUpdateComposer = useCallback(() => {
    setActiveTab("overview");
    setShowUpdateComposer(true);
    requestAnimationFrame(() => projectUpdateTextareaRef.current?.focus());
  }, []);

  useEffect(() => {
    async function fetchProject() {
      try {
        const res = await fetch(projectApiPath());
        if (!res.ok) {
          setData(null);
          return;
        }
        const json = await res.json();
        setData(json);
        setDescriptionDraft(json.project.description ?? "");
      } finally {
        setLoading(false);
      }
    }
    fetchProject();
  }, [projectApiPath]);

  useEffect(() => {
    function handleOpenProjectUpdate() {
      openProjectUpdateComposer();
    }

    window.addEventListener(OPEN_PROJECT_UPDATE_EVENT, handleOpenProjectUpdate);
    return () => {
      window.removeEventListener(
        OPEN_PROJECT_UPDATE_EVENT,
        handleOpenProjectUpdate,
      );
    };
  }, [openProjectUpdateComposer]);

  useEffect(() => {
    if (loading || !data) return;

    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get("newUpdate") === "1") {
      openProjectUpdateComposer();
    }
  }, [data, loading, openProjectUpdateComposer]);

  async function patchProject(payload: object) {
    setSaving(true);
    setErrorMessage(null);

    try {
      const res = await fetch(projectApiPath(), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        setErrorMessage(json.error ?? "Unable to update project.");
        return false;
      }

      setData(json);
      setDescriptionDraft(json.project.description ?? "");
      return true;
    } catch {
      setErrorMessage("Unable to update project.");
      return false;
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
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Project not found
      </div>
    );
  }

  const { project } = data;
  const tabs = [
    { id: "overview" as const, label: "Overview" },
    { id: "activity" as const, label: "Activity" },
    { id: "issues" as const, label: "Issues" },
  ];
  const summaryItems = [
    {
      label: "Status",
      value:
        project.statusLabel ??
        project.status.replace(/^./, (char) => char.toUpperCase()),
    },
    {
      label: "Priority",
      value: project.priority.replace(/^./, (char) => char.toUpperCase()),
    },
    { label: "Lead", value: data.lead?.name ?? "Add lead" },
    {
      label: "Target date",
      value: formatCompactDate(project.targetDate) ?? "Target date",
    },
    {
      label: "Teams",
      value:
        data.teams.length > 0
          ? data.teams.map((team) => team.name).join(", ")
          : "Add team",
    },
  ];
  const createIssueTeam = data.teams[0] ?? data.availableTeams[0] ?? null;

  async function handleSaveProperties(values: ProjectPropertiesSaveInput) {
    await patchProject(values);
  }

  async function handleSaveDescription() {
    const saved = await patchProject({ description: descriptionDraft });
    if (saved) {
      setShowDescriptionEditor(false);
    }
  }

  async function handleAddResource() {
    const saved = await patchProject({
      resource: {
        type: resourceType,
        title: resourceTitle,
        url: resourceType === "link" ? resourceUrl : null,
      },
    });

    if (saved) {
      setShowResourceForm(false);
      setResourceTitle("");
      setResourceUrl("");
      setResourceType("link");
    }
  }

  async function handleWriteUpdate() {
    const saved = await patchProject({ projectUpdate });
    if (saved) {
      setProjectUpdate("");
      setShowUpdateComposer(false);
      setActiveTab("activity");
    }
  }

  function openCreateIssue(defaults: CreateIssueDefaults = {}) {
    setCreateIssueDefaults(defaults);
    setShowCreateIssue(true);
  }

  async function refreshProject() {
    const res = await fetch(projectApiPath());
    if (!res.ok) {
      return;
    }

    const json = await res.json();
    setData(json);
    setDescriptionDraft(json.project.description ?? "");
  }

  function milestoneApiPath(milestoneId?: string) {
    const base = `/api/projects/${encodeURIComponent(params.slug)}/milestones`;
    const path = milestoneId
      ? `${base}/${encodeURIComponent(milestoneId)}`
      : base;
    if (!params.workspaceSlug) {
      return path;
    }

    return `${path}?workspaceSlug=${encodeURIComponent(params.workspaceSlug)}`;
  }

  function resetMilestoneForm() {
    setShowMilestoneForm(false);
    setEditingMilestoneId(null);
    setMilestoneName("");
    setMilestoneDescription("");
  }

  async function handleSaveMilestone() {
    const name = milestoneName.trim();
    if (!name) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        milestoneApiPath(editingMilestoneId ?? undefined),
        {
          method: editingMilestoneId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            description: milestoneDescription.trim() || null,
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMessage(json.error ?? "Unable to save milestone.");
        return;
      }
      await refreshProject();
      resetMilestoneForm();
    } catch {
      setErrorMessage("Unable to save milestone.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteMilestone(milestoneId: string) {
    setSaving(true);
    setErrorMessage(null);
    try {
      const res = await fetch(milestoneApiPath(milestoneId), {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMessage(json.error ?? "Unable to delete milestone.");
        return;
      }
      await refreshProject();
    } catch {
      setErrorMessage("Unable to delete milestone.");
    } finally {
      setSaving(false);
    }
  }

  async function handleMoveMilestone(
    milestone: MilestoneData,
    direction: -1 | 1,
  ) {
    const index =
      data?.milestones.findIndex((item) => item.id === milestone.id) ?? -1;
    const other = data?.milestones[index + direction];
    if (!data || !other) return;
    const reordered = [...data.milestones];
    reordered[index] = other;
    reordered[index + direction] = milestone;
    setData({ ...data, milestones: reordered });
    await Promise.all(
      reordered.map((item, sortOrder) =>
        fetch(milestoneApiPath(item.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder }),
        }),
      ),
    );
    await refreshProject();
  }

  async function handleAssignIssueMilestone(
    issueId: string,
    projectMilestoneId: string | null,
  ) {
    setSaving(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/issues/${encodeURIComponent(issueId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectMilestoneId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMessage(json.error ?? "Unable to assign milestone.");
        return;
      }
      await refreshProject();
    } catch {
      setErrorMessage("Unable to assign milestone.");
    } finally {
      setSaving(false);
    }
  }

  const sidebar = (
    <div className="w-full shrink-0 space-y-4 xl:w-[320px]">
      <ProjectProperties
        status={project.status}
        priority={project.priority}
        lead={data.lead}
        members={data.members}
        startDate={project.startDate}
        targetDate={project.targetDate}
        teams={data.teams}
        labels={data.labels}
        slackChannel={data.slackChannel}
        availableStatuses={data.projectStatuses}
        availableMembers={data.availableMembers}
        availableTeams={data.availableTeams}
        availableLabels={data.availableLabels}
        onSave={handleSaveProperties}
      />

      <SectionCard
        title="Milestones"
        action={
          showMilestoneForm ? null : (
            <button
              type="button"
              onClick={() => {
                setShowMilestoneForm(true);
                setEditingMilestoneId(null);
                setMilestoneName("");
                setMilestoneDescription("");
              }}
              className="rounded-md px-2 py-1 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              Add milestone
            </button>
          )
        }
      >
        {showMilestoneForm ? (
          <div className="mb-3 space-y-2 rounded-lg border border-[var(--color-border)] p-3">
            <input
              aria-label="Milestone name"
              value={milestoneName}
              onChange={(event) => setMilestoneName(event.target.value)}
              placeholder="Milestone name"
              className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />
            <textarea
              aria-label="Milestone description"
              value={milestoneDescription}
              onChange={(event) => setMilestoneDescription(event.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={resetMilestoneForm}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || !milestoneName.trim()}
                onClick={handleSaveMilestone}
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving
                  ? "Saving..."
                  : editingMilestoneId
                    ? "Save milestone"
                    : "Create milestone"}
              </button>
            </div>
          </div>
        ) : null}

        {data.milestones.length > 0 ? (
          <div className="space-y-1">
            {data.milestones.map((milestone, index) => (
              <MilestoneRow
                key={milestone.id}
                name={milestone.name}
                description={milestone.description ?? undefined}
                progress={milestone.progress}
                issueCount={milestone.issueCount}
                completedCount={milestone.completedCount}
                onEdit={() => {
                  setShowMilestoneForm(true);
                  setEditingMilestoneId(milestone.id);
                  setMilestoneName(milestone.name);
                  setMilestoneDescription(milestone.description ?? "");
                }}
                onDelete={() => handleDeleteMilestone(milestone.id)}
                onMoveUp={
                  index > 0
                    ? () => handleMoveMilestone(milestone, -1)
                    : undefined
                }
                onMoveDown={
                  index < data.milestones.length - 1
                    ? () => handleMoveMilestone(milestone, 1)
                    : undefined
                }
              />
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            No milestones yet. Use Add milestone to plan delivery phases.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Progress">
        <div className="space-y-4 text-[13px]">
          <div>
            <div className="text-[24px] font-semibold text-[var(--color-text-primary)]">
              {data.progress.percentage}%
            </div>
            <p className="text-[var(--color-text-secondary)]">
              {data.progress.completed} of {data.progress.total} issues
              completed
            </p>
          </div>

          <div>
            <h4 className="mb-2 text-[12px] font-medium text-[var(--color-text-secondary)]">
              Assignees
            </h4>
            {data.progress.assignees.length > 0 ? (
              <div className="space-y-1">
                {data.progress.assignees.map((assignee) => (
                  <div
                    key={assignee.name}
                    className="flex items-center justify-between text-[var(--color-text-primary)]"
                  >
                    <span>{assignee.name}</span>
                    <span className="text-[var(--color-text-secondary)]">
                      {assignee.count}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[var(--color-text-secondary)]">
                No assignees yet.
              </p>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-[12px] font-medium text-[var(--color-text-secondary)]">
              Labels
            </h4>
            {data.progress.labels.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {data.progress.labels.map((label) => (
                  <span
                    key={label.id}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-text-primary)]"
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                    {label.name} {label.count}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[var(--color-text-secondary)]">
                No labels on project issues yet.
              </p>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border)] px-6 py-4">
        <div className="mb-3 flex items-center gap-3">
          <span className="text-[24px]">{project.icon ?? "📋"}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[24px] font-semibold text-[var(--color-text-primary)]">
                {project.name}
              </h1>
              <SidebarFavoriteButton
                objectType="project"
                objectId={project.id}
                label={project.name}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {summaryItems.map((item) => (
                <span
                  key={item.label}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-text-secondary)]"
                >
                  <span className="text-[var(--color-text-primary)]">
                    {item.value}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-full px-3 py-1.5 text-[13px] transition-colors ${
                activeTab === tab.id
                  ? "bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {errorMessage ? (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-hover)] px-6 py-3 text-[13px] text-red-400">
          {errorMessage}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-6 p-6 xl:flex-row">
          <div className="min-w-0 flex-1 space-y-6">
            {activeTab === "overview" ? (
              <>
                <SectionCard
                  title="Description"
                  action={
                    showDescriptionEditor ? null : (
                      <button
                        type="button"
                        onClick={() => setShowDescriptionEditor(true)}
                        className="rounded-md px-2 py-1 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                      >
                        {project.description ? "Edit" : "Add"}
                      </button>
                    )
                  }
                >
                  {showDescriptionEditor ? (
                    <div className="space-y-3">
                      <textarea
                        value={descriptionDraft}
                        onChange={(event) =>
                          setDescriptionDraft(event.target.value)
                        }
                        rows={5}
                        className="w-full rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                        placeholder="Describe the goal, scope, and current state of this project."
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setDescriptionDraft(project.description ?? "");
                            setShowDescriptionEditor(false);
                          }}
                          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={handleSaveDescription}
                          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          {saving ? "Saving..." : "Save description"}
                        </button>
                      </div>
                    </div>
                  ) : project.description ? (
                    <p className="text-[14px] leading-7 text-[var(--color-text-secondary)]">
                      {project.description}
                    </p>
                  ) : (
                    <p className="text-[14px] text-[var(--color-text-secondary)]">
                      No description yet.
                    </p>
                  )}
                </SectionCard>

                <SectionCard
                  title="Resources"
                  action={
                    showResourceForm ? null : (
                      <button
                        type="button"
                        onClick={() => setShowResourceForm(true)}
                        className="rounded-md px-2 py-1 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                      >
                        + Add document or link
                      </button>
                    )
                  }
                >
                  {showResourceForm ? (
                    <div className="mb-4 grid gap-3 rounded-lg border border-[var(--color-border)] p-4 md:grid-cols-[120px_1fr_1fr]">
                      <select
                        value={resourceType}
                        onChange={(event) =>
                          setResourceType(
                            event.target.value as "document" | "link",
                          )
                        }
                        className="rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                      >
                        <option value="link">Link</option>
                        <option value="document">Document</option>
                      </select>
                      <input
                        value={resourceTitle}
                        onChange={(event) =>
                          setResourceTitle(event.target.value)
                        }
                        placeholder="Resource title"
                        className="rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                      />
                      <input
                        value={resourceUrl}
                        onChange={(event) => setResourceUrl(event.target.value)}
                        placeholder={
                          resourceType === "link"
                            ? "https://..."
                            : "Optional URL"
                        }
                        disabled={resourceType === "document"}
                        className="rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
                      />
                      <div className="md:col-span-3 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setShowResourceForm(false);
                            setResourceTitle("");
                            setResourceUrl("");
                            setResourceType("link");
                          }}
                          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={
                            saving ||
                            !resourceTitle.trim() ||
                            (resourceType === "link" && !resourceUrl.trim())
                          }
                          onClick={handleAddResource}
                          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          {saving ? "Saving..." : "Add resource"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {data.resources.length > 0 ? (
                    <div className="space-y-2">
                      {data.resources.map((resource) => (
                        <div
                          key={resource.id}
                          className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-3 py-2 text-[13px]"
                        >
                          <div>
                            <div className="font-medium text-[var(--color-text-primary)]">
                              {resource.title}
                            </div>
                            <div className="text-[var(--color-text-secondary)]">
                              {resource.type === "document"
                                ? "Document"
                                : "Link"}{" "}
                              added {formatRelativeTime(resource.createdAt)}
                            </div>
                          </div>
                          {resource.url ? (
                            <a
                              href={resource.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[var(--color-accent)] hover:underline"
                            >
                              Open
                            </a>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[13px] text-[var(--color-text-secondary)]">
                      Add links and docs that give the team context.
                    </p>
                  )}
                </SectionCard>

                <SectionCard title="Project updates">
                  {showUpdateComposer ? (
                    <div className="space-y-3">
                      <textarea
                        ref={projectUpdateTextareaRef}
                        aria-label="Project update"
                        value={projectUpdate}
                        onChange={(event) =>
                          setProjectUpdate(event.target.value)
                        }
                        rows={4}
                        className="w-full rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                        placeholder="Share a concise update with progress, blockers, or the next checkpoint."
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setProjectUpdate("");
                            setShowUpdateComposer(false);
                          }}
                          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={saving || !projectUpdate.trim()}
                          onClick={handleWriteUpdate}
                          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          {saving ? "Saving..." : "Post update"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowUpdateComposer(true)}
                      className="flex w-full items-center justify-center rounded-lg border border-[var(--color-border)] px-4 py-6 text-[13px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                    >
                      {data.activity.some((entry) => entry.type === "update")
                        ? "Write another project update"
                        : "Write first project update"}
                    </button>
                  )}
                </SectionCard>
              </>
            ) : null}

            {activeTab === "activity" ? (
              <SectionCard title="Activity">
                {data.activity.length > 0 ? (
                  <div className="space-y-3">
                    {data.activity.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-lg border border-[var(--color-border)] px-4 py-3"
                      >
                        <div className="mb-1 flex items-center justify-between gap-4">
                          <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                            {entry.title}
                          </div>
                          <div className="text-[12px] text-[var(--color-text-secondary)]">
                            {formatRelativeTime(entry.createdAt)}
                          </div>
                        </div>
                        <div className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
                          {entry.actorName}
                        </div>
                        {entry.body ? (
                          <p className="whitespace-pre-wrap text-[13px] leading-6 text-[var(--color-text-secondary)]">
                            {entry.body}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-[var(--color-text-secondary)]">
                    No activity yet. Project updates and property changes will
                    appear here.
                  </p>
                )}
              </SectionCard>
            ) : null}

            {activeTab === "issues" ? (
              <SectionCard title="Issues">
                {data.issueGroups.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[var(--color-border)] px-6 py-8 text-center">
                    <p className="text-[13px] font-medium text-[var(--color-text-primary)]">
                      No issues in this project yet.
                    </p>
                    <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                      Create the first issue from this project to keep planning
                      context attached.
                    </p>
                    {createIssueTeam ? (
                      <button
                        type="button"
                        onClick={() => openCreateIssue()}
                        className="mt-4 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
                      >
                        Create issue
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
                    {data.issueGroups.map((group) => (
                      <div key={group.state.id}>
                        <IssuesGroupHeader
                          name={group.state.name}
                          count={group.issues.length}
                          statusCategory={
                            group.state.category as StatusCategory
                          }
                          statusColor={group.state.color}
                          onAddIssue={
                            createIssueTeam
                              ? () => {
                                  openCreateIssue({
                                    stateId: group.state.id,
                                    stateName: group.state.name,
                                  });
                                }
                              : undefined
                          }
                        />
                        {group.issues.map((issue) => (
                          <div
                            key={issue.id}
                            className="grid grid-cols-[1fr_auto] items-center gap-2 border-t border-[var(--color-border)] first:border-t-0"
                          >
                            <IssueRow
                              identifier={issue.identifier}
                              title={issue.title}
                              priority={priorityMap[issue.priority] ?? 0}
                              statusCategory={
                                group.state.category as StatusCategory
                              }
                              statusColor={group.state.color}
                              assigneeName={issue.assignee?.name}
                              assigneeImage={issue.assignee?.image ?? undefined}
                              labels={issue.labels}
                              createdAt={issue.createdAt}
                              href={issue.href ?? undefined}
                            />
                            <select
                              aria-label={`Milestone for ${issue.identifier}`}
                              value={issue.projectMilestoneId ?? ""}
                              onChange={(event) =>
                                handleAssignIssueMilestone(
                                  issue.id,
                                  event.target.value || null,
                                )
                              }
                              className="mr-3 rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-[12px] text-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)]"
                            >
                              <option value="">No milestone</option>
                              {data.milestones.map((milestone) => (
                                <option key={milestone.id} value={milestone.id}>
                                  {milestone.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            ) : null}
          </div>

          {sidebar}
        </div>
      </div>

      {createIssueTeam ? (
        <CreateIssueModal
          open={showCreateIssue}
          onClose={() => setShowCreateIssue(false)}
          onCreated={refreshProject}
          teamId={createIssueTeam.id}
          teamKey={createIssueTeam.key}
          teamName={createIssueTeam.name}
          defaultStateId={createIssueDefaults.stateId}
          defaultStateName={createIssueDefaults.stateName}
          defaultProjectId={project.id}
        />
      ) : null}
    </div>
  );
}
