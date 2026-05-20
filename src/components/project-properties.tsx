"use client";

import { Avatar } from "@/components/avatar";
import { PriorityIcon } from "@/components/icons/priority-icon";
import { LabelChip } from "@/components/label-chip";
import { useEffect, useState } from "react";

type ProjectStatus = string;

type ProjectStatusOption = {
  key: string;
  name: string;
  color: string;
  icon: string;
  isDefault?: boolean;
};

type ProjectPriority = "none" | "urgent" | "high" | "medium" | "low";

const fallbackStatusLabels: Record<string, string> = {
  planned: "Planned",
  started: "In Progress",
  paused: "Paused",
  completed: "Completed",
  canceled: "Canceled",
};

function getStatusOption(
  status: ProjectStatus,
  availableStatuses: ProjectStatusOption[],
) {
  return (
    availableStatuses.find((option) => option.key === status) ?? {
      key: status,
      name:
        fallbackStatusLabels[status] ??
        status.replace(/^./, (char) => char.toUpperCase()),
      color: "#6b6f76",
      icon: "•",
    }
  );
}

const priorityLabels: Record<ProjectPriority, string> = {
  none: "No priority",
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const priorityMap: Record<ProjectPriority, 0 | 1 | 2 | 3 | 4> = {
  none: 0,
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

function formatDateInputValue(dateStr: string | null) {
  if (!dateStr) return "";
  return new Date(dateStr).toISOString().slice(0, 10);
}

function PropertyRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 py-2">
      <span className="w-[80px] shrink-0 text-[13px] text-[var(--color-text-secondary)]">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-[var(--color-text-primary)]">
        {children}
      </div>
    </div>
  );
}

export interface ProjectPropertiesSaveInput {
  status: ProjectStatus;
  priority: ProjectPriority;
  leadId: string | null;
  memberIds: string[];
  teamIds: string[];
  labelIds: string[];
  startDate: string | null;
  targetDate: string | null;
  slackChannel: string | null;
}

export interface ProjectPropertiesProps {
  status: ProjectStatus;
  priority: ProjectPriority;
  lead: { id: string; name: string; image?: string | null } | null;
  members: { id: string; name: string; image?: string | null }[];
  startDate: string | null;
  targetDate: string | null;
  teams: { id: string; name: string; key: string }[];
  labels: { id: string; name: string; color: string }[];
  slackChannel: string | null;
  availableMembers: { id: string; name: string; image?: string | null }[];
  availableTeams: { id: string; name: string; key: string }[];
  availableLabels: { id: string; name: string; color: string }[];
  availableStatuses?: ProjectStatusOption[];
  onSave?: (values: ProjectPropertiesSaveInput) => Promise<void> | void;
}

function EditProjectPropertiesModal({
  status,
  priority,
  lead,
  members,
  startDate,
  targetDate,
  teams,
  labels,
  slackChannel,
  availableMembers,
  availableTeams,
  availableLabels,
  availableStatuses = [],
  onClose,
  onSave,
}: ProjectPropertiesProps & {
  onClose: () => void;
  onSave: (values: ProjectPropertiesSaveInput) => Promise<void> | void;
}) {
  const [draftStatus, setDraftStatus] = useState<ProjectStatus>(status);
  const [draftPriority, setDraftPriority] = useState<ProjectPriority>(priority);
  const [draftLeadId, setDraftLeadId] = useState(lead?.id ?? "");
  const [draftMemberIds, setDraftMemberIds] = useState<string[]>(
    members.map((member) => member.id),
  );
  const [draftTeamIds, setDraftTeamIds] = useState<string[]>(
    teams.map((team) => team.id),
  );
  const [draftLabelIds, setDraftLabelIds] = useState<string[]>(
    labels.map((label) => label.id),
  );
  const [draftStartDate, setDraftStartDate] = useState(
    formatDateInputValue(startDate),
  );
  const [draftTargetDate, setDraftTargetDate] = useState(
    formatDateInputValue(targetDate),
  );
  const [draftSlackChannel, setDraftSlackChannel] = useState(
    slackChannel ?? "",
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraftStatus(status);
    setDraftPriority(priority);
    setDraftLeadId(lead?.id ?? "");
    setDraftMemberIds(members.map((member) => member.id));
    setDraftTeamIds(teams.map((team) => team.id));
    setDraftLabelIds(labels.map((label) => label.id));
    setDraftStartDate(formatDateInputValue(startDate));
    setDraftTargetDate(formatDateInputValue(targetDate));
    setDraftSlackChannel(slackChannel ?? "");
  }, [
    labels,
    lead,
    members,
    priority,
    slackChannel,
    startDate,
    status,
    targetDate,
    teams,
  ]);

  const toggleValue = (
    currentValues: string[],
    nextValue: string,
    setValues: (values: string[]) => void,
  ) => {
    if (currentValues.includes(nextValue)) {
      setValues(currentValues.filter((value) => value !== nextValue));
      return;
    }
    setValues([...currentValues, nextValue]);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        status: draftStatus,
        priority: draftPriority,
        leadId: draftLeadId || null,
        memberIds: draftMemberIds,
        teamIds: draftTeamIds,
        labelIds: draftLabelIds,
        startDate: draftStartDate || null,
        targetDate: draftTargetDate || null,
        slackChannel: draftSlackChannel.trim() || null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-[560px] rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h4 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
            Edit project properties
          </h4>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            Close
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-[12px] text-[var(--color-text-secondary)]">
            Status
            <select
              value={draftStatus}
              onChange={(event) =>
                setDraftStatus(event.target.value as ProjectStatus)
              }
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            >
              {(availableStatuses.length > 0
                ? availableStatuses
                : Object.entries(fallbackStatusLabels).map(([key, name]) => ({
                    key,
                    name,
                    color: "#6b6f76",
                    icon: "•",
                  }))
              ).map((option) => (
                <option key={option.key} value={option.key}>
                  {option.icon} {option.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[12px] text-[var(--color-text-secondary)]">
            Priority
            <select
              value={draftPriority}
              onChange={(event) =>
                setDraftPriority(event.target.value as ProjectPriority)
              }
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            >
              {Object.entries(priorityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[12px] text-[var(--color-text-secondary)]">
            Lead
            <select
              value={draftLeadId}
              onChange={(event) => setDraftLeadId(event.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            >
              <option value="">No lead</option>
              {availableMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[12px] text-[var(--color-text-secondary)]">
            Slack channel
            <input
              value={draftSlackChannel}
              onChange={(event) => setDraftSlackChannel(event.target.value)}
              placeholder="#project-updates"
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />
          </label>

          <label className="text-[12px] text-[var(--color-text-secondary)]">
            Start date
            <input
              type="date"
              value={draftStartDate}
              onChange={(event) => setDraftStartDate(event.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />
          </label>

          <label className="text-[12px] text-[var(--color-text-secondary)]">
            Target date
            <input
              type="date"
              value={draftTargetDate}
              onChange={(event) => setDraftTargetDate(event.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />
          </label>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <div>
            <h5 className="mb-2 text-[12px] font-medium text-[var(--color-text-secondary)]">
              Members
            </h5>
            <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
              {availableMembers.length > 0 ? (
                availableMembers.map((member) => (
                  <label
                    key={member.id}
                    className="flex items-center gap-2 text-[13px] text-[var(--color-text-primary)]"
                  >
                    <input
                      type="checkbox"
                      checked={draftMemberIds.includes(member.id)}
                      onChange={() =>
                        toggleValue(
                          draftMemberIds,
                          member.id,
                          setDraftMemberIds,
                        )
                      }
                    />
                    {member.name}
                  </label>
                ))
              ) : (
                <p className="text-[12px] text-[var(--color-text-secondary)]">
                  No workspace members available.
                </p>
              )}
            </div>
          </div>

          <div>
            <h5 className="mb-2 text-[12px] font-medium text-[var(--color-text-secondary)]">
              Teams
            </h5>
            <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
              {availableTeams.length > 0 ? (
                availableTeams.map((team) => (
                  <label
                    key={team.id}
                    className="flex items-center gap-2 text-[13px] text-[var(--color-text-primary)]"
                  >
                    <input
                      type="checkbox"
                      checked={draftTeamIds.includes(team.id)}
                      onChange={() =>
                        toggleValue(draftTeamIds, team.id, setDraftTeamIds)
                      }
                    />
                    {team.name}
                  </label>
                ))
              ) : (
                <p className="text-[12px] text-[var(--color-text-secondary)]">
                  No teams available.
                </p>
              )}
            </div>
          </div>

          <div>
            <h5 className="mb-2 text-[12px] font-medium text-[var(--color-text-secondary)]">
              Labels
            </h5>
            <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
              {availableLabels.length > 0 ? (
                availableLabels.map((label) => (
                  <label
                    key={label.id}
                    className="flex items-center gap-2 text-[13px] text-[var(--color-text-primary)]"
                  >
                    <input
                      type="checkbox"
                      checked={draftLabelIds.includes(label.id)}
                      onChange={() =>
                        toggleValue(draftLabelIds, label.id, setDraftLabelIds)
                      }
                    />
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                    {label.name}
                  </label>
                ))
              ) : (
                <p className="text-[12px] text-[var(--color-text-secondary)]">
                  No labels available.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProjectProperties({
  status,
  priority,
  lead,
  members,
  startDate,
  targetDate,
  teams,
  labels,
  slackChannel,
  availableMembers,
  availableTeams,
  availableLabels,
  availableStatuses = [],
  onSave,
}: ProjectPropertiesProps) {
  const [showEditor, setShowEditor] = useState(false);
  const statusOption = getStatusOption(status, availableStatuses);

  return (
    <>
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
            Properties
          </h3>
          {onSave ? (
            <button
              type="button"
              onClick={() => setShowEditor(true)}
              className="rounded-md px-2 py-1 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              Edit
            </button>
          ) : null}
        </div>

        <PropertyRow label="Status">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{
              backgroundColor: `${statusOption.color}22`,
              color: statusOption.color,
            }}
          >
            <span>{statusOption.icon}</span>
            {statusOption.name}
          </span>
        </PropertyRow>

        <PropertyRow label="Priority">
          <PriorityIcon priority={priorityMap[priority]} size={14} />
          <span>{priorityLabels[priority]}</span>
        </PropertyRow>

        <PropertyRow label="Lead">
          {lead ? (
            <>
              <Avatar
                name={lead.name}
                src={lead.image ?? undefined}
                size="sm"
              />
              <span>{lead.name}</span>
            </>
          ) : (
            <span className="text-[var(--color-text-secondary)]">Add lead</span>
          )}
        </PropertyRow>

        <PropertyRow label="Members">
          {members.length > 0 ? (
            <div className="flex -space-x-1">
              {members.map((member) => (
                <Avatar
                  key={member.id}
                  name={member.name}
                  src={member.image ?? undefined}
                  size="sm"
                />
              ))}
            </div>
          ) : (
            <span className="text-[var(--color-text-secondary)]">
              Add members
            </span>
          )}
        </PropertyRow>

        <PropertyRow label="Dates">
          {startDate || targetDate ? (
            <span>
              {startDate ? formatDate(startDate) : "Start"}
              {" → "}
              {targetDate ? formatDate(targetDate) : "Target"}
            </span>
          ) : (
            <span className="text-[var(--color-text-secondary)]">
              Set dates
            </span>
          )}
        </PropertyRow>

        <PropertyRow label="Teams">
          {teams.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {teams.map((team) => (
                <span
                  key={team.id}
                  className="rounded-md bg-[var(--color-surface-active)] px-1.5 py-0.5 text-[12px]"
                >
                  {team.name}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[var(--color-text-secondary)]">Add team</span>
          )}
        </PropertyRow>

        <PropertyRow label="Slack">
          {slackChannel ? (
            <span>{slackChannel}</span>
          ) : (
            <span className="text-[var(--color-text-secondary)]">
              Add Slack channel
            </span>
          )}
        </PropertyRow>

        <PropertyRow label="Labels">
          {labels.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {labels.map((label) => (
                <LabelChip
                  key={label.id}
                  name={label.name}
                  color={label.color}
                />
              ))}
            </div>
          ) : (
            <span className="text-[var(--color-text-secondary)]">
              Add label
            </span>
          )}
        </PropertyRow>
      </div>

      {showEditor && onSave ? (
        <EditProjectPropertiesModal
          status={status}
          priority={priority}
          lead={lead}
          members={members}
          startDate={startDate}
          targetDate={targetDate}
          teams={teams}
          labels={labels}
          slackChannel={slackChannel}
          availableMembers={availableMembers}
          availableTeams={availableTeams}
          availableLabels={availableLabels}
          availableStatuses={availableStatuses}
          onSave={onSave}
          onClose={() => setShowEditor(false)}
        />
      ) : null}
    </>
  );
}
