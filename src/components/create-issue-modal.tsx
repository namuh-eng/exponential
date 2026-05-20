"use client";

import { normalizeIssueDescriptionHtml } from "@/lib/issue-description";
import {
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

interface CreateIssueModalProps {
  open: boolean;
  onClose: () => void;
  variant?: "modal" | "fullscreen";
  teamKey: string;
  teamName: string;
  teamId: string;
  defaultStateId?: string;
  defaultStateName?: string;
  defaultProjectId?: string | null;
  onCreated?: () => void | Promise<void>;
}

interface IssueTemplateOption {
  id: string;
  name: string;
  description: string;
  settings: {
    title?: string;
    body?: string;
    defaultPriority?: string;
    defaultStatusId?: string;
    defaultStatusName?: string;
    defaultTeamId?: string;
    defaultTeamKey?: string;
    defaultScope?: string;
    defaultProjectId?: string | null;
  };
}

interface CreateIssueOptions {
  team: {
    id: string;
    name: string;
    key: string;
  };
  statuses: Array<{
    id: string;
    name: string;
    category: string;
    color: string;
  }>;
  priorities: Array<{
    value: string;
    label: string;
  }>;
  assignees: Array<{
    id: string;
    name: string;
    image?: string | null;
  }>;
  labels: Array<{
    id: string;
    name: string;
    color: string;
  }>;
  projects: Array<{
    id: string;
    name: string;
    icon?: string | null;
  }>;
}

type ToolbarMenu = "status" | "priority" | "assignee" | "project" | "labels";

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function StatusIcon({
  color,
  dotted,
}: {
  color: string;
  dotted?: boolean;
}) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="5.5"
        stroke={color}
        strokeWidth="1.5"
        strokeDasharray={dotted ? "2.4 2" : undefined}
        strokeLinecap="round"
      />
    </svg>
  );
}

function PriorityIcon({ priority }: { priority: string }) {
  const colorMap: Record<string, string> = {
    urgent: "#ef4444",
    high: "#f97316",
    medium: "#f59e0b",
    low: "#22c55e",
    none: "var(--color-priority-none)",
  };

  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 5.5h10M3 8h10M3 10.5h10"
        stroke={colorMap[priority] ?? colorMap.none}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeOpacity={priority === "none" ? 0.4 : 1}
      />
    </svg>
  );
}

function LabelsIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
      <path d="M7 7h.01" />
    </svg>
  );
}

function AssigneeIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ProjectIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M8 20h8" />
    </svg>
  );
}

function AttachIcon() {
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
      aria-hidden="true"
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.48l9.2-9.2a4 4 0 0 1 5.65 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.82l8.49-8.48" />
    </svg>
  );
}

function ToolbarButton({
  label,
  value,
  active,
  onClick,
  icon,
  ariaLabel,
}: {
  label: string;
  value?: string;
  active?: boolean;
  onClick: () => void;
  icon: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? label}
      onClick={onClick}
      className={classNames(
        "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors",
        active
          ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] text-[var(--color-text-primary)]"
          : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
      )}
    >
      {icon}
      <span>{value ?? label}</span>
    </button>
  );
}

export function CreateIssueModal({
  open,
  onClose,
  variant = "modal",
  teamKey,
  teamName,
  teamId,
  defaultStateId,
  defaultStateName = "Backlog",
  defaultProjectId = null,
  onCreated,
}: CreateIssueModalProps) {
  const [title, setTitle] = useState("");
  const [descriptionHtml, setDescriptionHtml] = useState("");
  const [priority, setPriority] = useState("none");
  const [createMore, setCreateMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [openMenu, setOpenMenu] = useState<ToolbarMenu | null>(null);
  const [options, setOptions] = useState<CreateIssueOptions | null>(null);
  const [templates, setTemplates] = useState<IssueTemplateOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedStateId, setSelectedStateId] = useState(defaultStateId ?? "");
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string | null>(
    null,
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<File[]>([]);

  const titleRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setOpenMenu(null);
      setError(null);
      return;
    }

    setTitle("");
    setDescriptionHtml("");
    setPriority("none");
    setSelectedStateId(defaultStateId ?? "");
    setSelectedAssigneeId(null);
    setSelectedProjectId(defaultProjectId);
    setSelectedLabelIds([]);
    setAttachments([]);
    setSelectedTemplateId("");
    setError(null);

    if (titleRef.current) {
      titleRef.current.textContent = "";
    }

    if (descriptionRef.current) {
      descriptionRef.current.innerHTML = "";
    }
  }, [defaultProjectId, defaultStateId, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    async function loadOptions() {
      setLoadingOptions(true);
      try {
        const response = await fetch(
          `/api/teams/${encodeURIComponent(teamKey)}/create-issue-options`,
        );

        if (!response.ok) {
          throw new Error("Failed to load issue options");
        }

        const data = (await response.json()) as CreateIssueOptions;
        if (cancelled) {
          return;
        }

        setOptions(data);

        const nextStateId =
          defaultStateId ||
          data.statuses.find((status) => status.name === defaultStateName)
            ?.id ||
          data.statuses[0]?.id ||
          "";
        setSelectedStateId(nextStateId);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load issue options",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingOptions(false);
        }
      }
    }

    void loadOptions();

    return () => {
      cancelled = true;
    };
  }, [defaultStateId, defaultStateName, open, teamKey]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function loadTemplates() {
      try {
        const response = await fetch(
          `/api/issue-templates?teamKey=${encodeURIComponent(teamKey)}`,
        );
        if (!response.ok) return;
        const data = (await response.json()) as {
          templates?: IssueTemplateOption[];
        };
        if (!cancelled) setTemplates(data.templates ?? []);
      } catch {
        if (!cancelled) setTemplates([]);
      }
    }
    void loadTemplates();
    return () => {
      cancelled = true;
    };
  }, [open, teamKey]);

  useEffect(() => {
    if (!openMenu) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }

      setOpenMenu(null);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [openMenu]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const selectedState =
    (options?.statuses ?? []).find((status) => status.id === selectedStateId) ??
    null;
  const selectedPriority =
    (options?.priorities ?? []).find((item) => item.value === priority) ?? null;
  const selectedAssignee =
    (options?.assignees ?? []).find(
      (assignee) => assignee.id === selectedAssigneeId,
    ) ?? null;
  const selectedProject =
    (options?.projects ?? []).find(
      (project) => project.id === selectedProjectId,
    ) ?? null;
  const selectedLabels = (options?.labels ?? []).filter((labelItem) =>
    selectedLabelIds.includes(labelItem.id),
  );
  const canSubmit = title.trim().length > 0 && !submitting && !loadingOptions;
  const isFullscreen = variant === "fullscreen";

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: normalizeIssueDescriptionHtml(descriptionHtml),
          teamId,
          stateId: selectedStateId || defaultStateId,
          priority,
          assigneeId: selectedAssigneeId,
          projectId: selectedProjectId,
          labelIds: selectedLabelIds,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error || "Failed to create issue");
      }

      const createdIssue = (await response.json()) as { id: string };

      if (attachments.length > 0) {
        const formData = new FormData();
        for (const attachment of attachments) {
          formData.append("attachments", attachment);
        }

        const uploadResponse = await fetch(
          `/api/issues/${createdIssue.id}/comments`,
          {
            method: "POST",
            body: formData,
          },
        );

        if (!uploadResponse.ok) {
          throw new Error("Issue created, but attachment upload failed");
        }
      }

      window.dispatchEvent(
        new CustomEvent("issue-created", {
          detail: { teamId, teamKey, issueId: createdIssue.id },
        }),
      );
      window.dispatchEvent(new CustomEvent("notifications:changed"));
      await onCreated?.();

      if (createMore) {
        setTitle("");
        setDescriptionHtml("");
        setSelectedAssigneeId(null);
        setSelectedProjectId(defaultProjectId);
        setSelectedLabelIds([]);
        setAttachments([]);

        if (titleRef.current) {
          titleRef.current.textContent = "";
        }

        if (descriptionRef.current) {
          descriptionRef.current.innerHTML = "";
        }

        return;
      }

      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to create issue",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function applyTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    const settings = template.settings ?? {};
    const nextTitle = settings.title || template.name;
    const nextBody = settings.body || template.description;
    if (!title.trim() && titleRef.current) {
      titleRef.current.textContent = nextTitle;
      setTitle(nextTitle);
    }
    const currentDescriptionText =
      descriptionRef.current?.textContent?.trim() ?? "";
    if (!currentDescriptionText && descriptionRef.current) {
      descriptionRef.current.textContent = nextBody;
      setDescriptionHtml(descriptionRef.current.innerHTML);
    }
    if (settings.defaultPriority) setPriority(settings.defaultPriority);
    if (settings.defaultStatusId) setSelectedStateId(settings.defaultStatusId);
    else if (settings.defaultStatusName) {
      const matchingStatus = options?.statuses.find(
        (status) =>
          status.name.toLowerCase() ===
          settings.defaultStatusName?.toLowerCase(),
      );
      if (matchingStatus) setSelectedStateId(matchingStatus.id);
    }
    if (settings.defaultProjectId !== undefined)
      setSelectedProjectId(settings.defaultProjectId);
  }

  function handleLabelToggle(labelId: string) {
    setSelectedLabelIds((current) =>
      current.includes(labelId)
        ? current.filter((value) => value !== labelId)
        : [...current, labelId],
    );
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    setAttachments((current) => {
      const seen = new Set(current.map((file) => `${file.name}-${file.size}`));
      const nextFiles = files.filter((file) => {
        const key = `${file.name}-${file.size}`;
        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      });

      return [...current, ...nextFiles];
    });

    event.target.value = "";
  }

  function renderMenu() {
    if (!openMenu) {
      return null;
    }

    if (openMenu === "labels") {
      return (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-[220px] rounded-lg border border-[var(--color-border)] bg-[var(--color-content-bg)] py-1 shadow-xl">
          <div className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
            Labels
          </div>
          {options?.labels.length ? (
            options.labels.map((labelItem) => {
              const selected = selectedLabelIds.includes(labelItem.id);
              return (
                <button
                  key={labelItem.id}
                  type="button"
                  onClick={() => handleLabelToggle(labelItem.id)}
                  className={classNames(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors",
                    selected
                      ? "bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
                      : "text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]",
                  )}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: labelItem.color }}
                  />
                  <span className="flex-1">{labelItem.name}</span>
                  {selected && <span>✓</span>}
                </button>
              );
            })
          ) : (
            <div className="px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">
              No labels available
            </div>
          )}
        </div>
      );
    }

    const menuItems =
      openMenu === "status"
        ? (options?.statuses ?? []).map((status) => ({
            id: status.id,
            label: status.name,
            icon: (
              <StatusIcon
                color={status.color}
                dotted={status.category === "backlog"}
              />
            ),
            onSelect: () => {
              setSelectedStateId(status.id);
              setOpenMenu(null);
            },
          }))
        : openMenu === "priority"
          ? (options?.priorities ?? []).map((item) => ({
              id: item.value,
              label: item.label,
              icon: <PriorityIcon priority={item.value} />,
              onSelect: () => {
                setPriority(item.value);
                setOpenMenu(null);
              },
            }))
          : openMenu === "assignee"
            ? [
                {
                  id: "unassigned",
                  label: "No assignee",
                  icon: <AssigneeIcon />,
                  onSelect: () => {
                    setSelectedAssigneeId(null);
                    setOpenMenu(null);
                  },
                },
                ...(options?.assignees ?? []).map((assignee) => ({
                  id: assignee.id,
                  label: assignee.name,
                  icon: (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-surface-active)] text-[9px] font-medium text-[var(--color-text-primary)]">
                      {getInitials(assignee.name)}
                    </span>
                  ),
                  onSelect: () => {
                    setSelectedAssigneeId(assignee.id);
                    setOpenMenu(null);
                  },
                })),
              ]
            : [
                {
                  id: "no-project",
                  label: "No project",
                  icon: <ProjectIcon />,
                  onSelect: () => {
                    setSelectedProjectId(null);
                    setOpenMenu(null);
                  },
                },
                ...(options?.projects ?? []).map((projectItem) => ({
                  id: projectItem.id,
                  label: projectItem.name,
                  icon: (
                    <span className="flex h-4 w-4 items-center justify-center rounded bg-[var(--color-surface-active)] text-[10px] text-[var(--color-text-primary)]">
                      {projectItem.icon || "P"}
                    </span>
                  ),
                  onSelect: () => {
                    setSelectedProjectId(projectItem.id);
                    setOpenMenu(null);
                  },
                })),
              ];

    return (
      <div className="absolute bottom-full left-0 z-20 mb-2 w-[220px] rounded-lg border border-[var(--color-border)] bg-[var(--color-content-bg)] py-1 shadow-xl">
        <div className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
          {openMenu}
        </div>
        {menuItems.length ? (
          menuItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={item.onSelect}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))
        ) : (
          <div className="px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">
            No options available
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={classNames(
        "fixed inset-0 z-50 flex justify-center",
        isFullscreen ? "items-stretch p-4" : "items-start pt-[14vh]",
      )}
    >
      <div
        className="absolute inset-0 bg-black/55"
        onClick={onClose}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onClose();
          }
        }}
        role="presentation"
        tabIndex={-1}
      />

      <dialog
        open
        aria-modal="true"
        data-testid="create-issue-composer"
        data-variant={variant}
        aria-label={
          isFullscreen
            ? `Create issue fullscreen for ${teamName}`
            : `Create issue for ${teamName}`
        }
        className={classNames(
          "relative z-10 w-full border border-[var(--color-border)] bg-[var(--color-content-bg)] shadow-2xl",
          isFullscreen
            ? "flex h-[calc(100vh-2rem)] max-w-[1120px] flex-col rounded-3xl"
            : "max-w-[760px] rounded-2xl",
        )}
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
          <span className="flex items-center gap-1.5 rounded-md bg-[var(--color-surface)] px-2 py-0.5 text-[12px] font-medium text-[var(--color-text-primary)]">
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-[var(--color-accent)] text-[7px] font-bold text-white">
              {teamKey.charAt(0)}
            </span>
            {teamKey}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-[var(--color-text-secondary)]"
            aria-hidden="true"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="text-[13px] text-[var(--color-text-primary)]">
            New issue
          </span>
          {isFullscreen && (
            <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
              Fullscreen composer
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
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

        <div
          className={classNames(
            "px-4 pb-3 pt-4",
            isFullscreen && "flex-1 overflow-y-auto px-8 py-8",
          )}
        >
          {templates.length > 0 && (
            <label className="mt-3 block text-[12px] text-[var(--color-text-secondary)]">
              Template
              <select
                aria-label="Issue template"
                className="mt-1 w-full max-w-[320px] rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-[13px] text-[var(--color-text-primary)]"
                value={selectedTemplateId}
                onChange={(event) => applyTemplate(event.target.value)}
              >
                <option value="">No template</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div
            ref={titleRef}
            role="textbox"
            tabIndex={0}
            aria-label="Issue title"
            contentEditable
            suppressContentEditableWarning
            data-placeholder="Issue title"
            onInput={(event) =>
              setTitle(
                event.currentTarget.textContent?.replace(/\n/g, "") ?? "",
              )
            }
            onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
              if (event.key === "Enter") {
                event.preventDefault();
              }
            }}
            className={classNames(
              "relative min-h-[42px] w-full whitespace-pre-wrap break-words bg-transparent text-[36px] font-semibold leading-[1.15] text-[var(--color-text-primary)] focus:outline-none",
              isFullscreen && "text-[44px]",
              !title &&
                "before:pointer-events-none before:absolute before:left-0 before:top-0 before:text-[var(--color-text-tertiary)] before:content-[attr(data-placeholder)]",
            )}
          />

          <div
            ref={descriptionRef}
            role="textbox"
            tabIndex={0}
            aria-label="Issue description"
            contentEditable
            suppressContentEditableWarning
            data-placeholder="Add description..."
            onInput={(event) =>
              setDescriptionHtml(event.currentTarget.innerHTML)
            }
            className={classNames(
              "relative mt-4 min-h-[96px] w-full whitespace-pre-wrap break-words bg-transparent text-[15px] leading-6 text-[var(--color-text-primary)] focus:outline-none",
              isFullscreen && "min-h-[360px] text-[16px] leading-7",
              !descriptionHtml &&
                "before:pointer-events-none before:absolute before:left-0 before:top-0 before:text-[var(--color-text-tertiary)] before:content-[attr(data-placeholder)]",
            )}
          />

          {attachments.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {attachments.map((file) => (
                <span
                  key={`${file.name}-${file.size}`}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-[12px] text-[var(--color-text-primary)]"
                >
                  <AttachIcon />
                  <span>{file.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter(
                          (attachment) =>
                            `${attachment.name}-${attachment.size}` !==
                            `${file.name}-${file.size}`,
                        ),
                      )
                    }
                    className="text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-[var(--color-border)] px-4 py-2">
          <div
            ref={menuRef}
            className="relative flex flex-wrap items-center gap-1"
          >
            <ToolbarButton
              label="Status"
              value={selectedState?.name ?? defaultStateName}
              active={openMenu === "status"}
              onClick={() =>
                setOpenMenu((current) =>
                  current === "status" ? null : "status",
                )
              }
              icon={
                <StatusIcon
                  color={selectedState?.color ?? "var(--color-status-backlog)"}
                  dotted={(selectedState?.category ?? "backlog") === "backlog"}
                />
              }
            />
            <ToolbarButton
              label="Priority"
              value={selectedPriority?.label ?? "Priority"}
              active={openMenu === "priority" || priority !== "none"}
              onClick={() =>
                setOpenMenu((current) =>
                  current === "priority" ? null : "priority",
                )
              }
              icon={<PriorityIcon priority={priority} />}
            />
            <ToolbarButton
              label="Assignee"
              value={selectedAssignee?.name ?? "Assignee"}
              active={openMenu === "assignee" || Boolean(selectedAssignee)}
              onClick={() =>
                setOpenMenu((current) =>
                  current === "assignee" ? null : "assignee",
                )
              }
              icon={
                selectedAssignee ? (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-surface-active)] text-[9px] font-medium text-[var(--color-text-primary)]">
                    {getInitials(selectedAssignee.name)}
                  </span>
                ) : (
                  <AssigneeIcon />
                )
              }
            />
            <ToolbarButton
              label="Project"
              value={selectedProject?.name ?? "Project"}
              active={openMenu === "project" || Boolean(selectedProject)}
              onClick={() =>
                setOpenMenu((current) =>
                  current === "project" ? null : "project",
                )
              }
              icon={
                selectedProject?.icon ? (
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-[var(--color-surface-active)] text-[10px] text-[var(--color-text-primary)]">
                    {selectedProject.icon}
                  </span>
                ) : (
                  <ProjectIcon />
                )
              }
            />
            <ToolbarButton
              label="Labels"
              value={
                selectedLabels.length === 0
                  ? "Labels"
                  : selectedLabels.length === 1
                    ? selectedLabels[0].name
                    : `${selectedLabels.length} labels`
              }
              active={openMenu === "labels" || selectedLabels.length > 0}
              onClick={() =>
                setOpenMenu((current) =>
                  current === "labels" ? null : "labels",
                )
              }
              icon={<LabelsIcon />}
            />
            {renderMenu()}
            <div className="flex-1" />
            <button
              type="button"
              aria-label="More actions"
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
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
                <circle cx="12" cy="12" r="1" />
                <circle cx="19" cy="12" r="1" />
                <circle cx="5" cy="12" r="1" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-2.5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Attach files"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              <AttachIcon />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleAttachmentChange}
            />
            {error && (
              <p className="text-[12px] text-[#f87171]" role="alert">
                {error}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
              <input
                type="checkbox"
                checked={createMore}
                onChange={(event) => setCreateMore(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-[var(--color-border)] bg-transparent accent-[var(--color-accent)]"
              />
              Create more
            </label>

            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void handleSubmit()}
              className="rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? "Creating..." : "Create Issue"}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
