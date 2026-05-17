"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
import { IssueProperties } from "@/components/issue-properties";
import { SidebarFavoriteButton } from "@/components/sidebar-favorite-button";
import { LAST_ISSUE_STORAGE_KEY } from "@/lib/command-palette";
import {
  normalizeIssueDescriptionHtml,
  richTextHtmlToPlainText,
} from "@/lib/issue-description";
import { withWorkspaceSlug } from "@/lib/workspace-paths";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

interface IssueReaction {
  emoji: string;
  count: number;
  reacted: boolean;
  reactedByMe?: boolean;
}

interface IssueCommentAttachment {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  downloadUrl: string | null;
}

interface WorkspaceMemberOption {
  userId: string;
  name: string | null;
  email: string | null;
  image: string | null;
  status: "active" | "pending";
}

interface SelectedMention {
  userId: string;
  name: string;
  token: string;
}

interface IssueComment {
  id: string;
  body: string;
  user: { name: string; image: string | null };
  createdAt: string;
  ownedByMe?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  reactions: IssueReaction[];
  attachments: IssueCommentAttachment[];
}

interface IssueSubIssue {
  id: string;
  identifier: string;
  title: string;
  priority: "none" | "urgent" | "high" | "medium" | "low";
  state: {
    name: string;
    category:
      | "triage"
      | "backlog"
      | "unstarted"
      | "started"
      | "completed"
      | "canceled";
    color: string;
  } | null;
}

interface IssueSubscriptionState {
  subscribed: boolean;
  watcherCount: number;
}

interface IssueDetail {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: "none" | "urgent" | "high" | "medium" | "low";
  state: {
    id: string;
    name: string;
    category:
      | "triage"
      | "backlog"
      | "unstarted"
      | "started"
      | "completed"
      | "canceled";
    color: string;
  } | null;
  assignee: { name: string; image: string | null } | null;
  creator: { name: string; image: string | null } | null;
  team: { id: string; name: string; key: string };
  project: { id: string; name: string; icon: string } | null;
  dueDate: string | null;
  estimate: number | null;
  cycle: { id: string; name: string | null; number: number } | null;
  parentIssue: { id: string; identifier: string; title: string } | null;
  relations: {
    id: string;
    type: "blocks" | "blocked_by" | "duplicate" | "related";
    issue: { id: string; identifier: string; title: string };
  }[];
  labels: { name: string; color: string }[];
  subscription: IssueSubscriptionState;
  reactions: IssueReaction[];
  discussionSummary: {
    enabled: boolean;
    status?:
      | "disabled"
      | "ineligible"
      | "ready"
      | "generating"
      | "generated"
      | "stale"
      | "failed";
    text: string | null;
    generatedAt?: string | null;
    generatedBy?: string | null;
    sourceCommentCount?: number;
    sourceCommentVersion?: string | null;
    staleAt?: string | null;
    error?: string | null;
  };
  comments: IssueComment[];
  subIssues: IssueSubIssue[];
  createdAt: string;
  updatedAt: string;
}

type IssueHistoryEventType = "created" | "updated" | "comment_created";

interface IssueHistoryEvent {
  id: string;
  type: IssueHistoryEventType;
  metadata: Record<string, unknown>;
  actor: { id: string; name: string | null; email: string | null } | null;
  createdAt: string;
}

const QUICK_REACTIONS = ["👍", "🚀", "👀", "❤️"];
const EMOJI_REACTIONS = [
  "👍",
  "👎",
  "🚀",
  "👀",
  "❤️",
  "🔥",
  "🎉",
  "💯",
  "🙌",
  "🤔",
  "😄",
  "😕",
];
const COMMENT_FORMAT_ACTIONS = [
  { label: "Bold", prefix: "**", suffix: "**" },
  { label: "Italic", prefix: "_", suffix: "_" },
  { label: "Code", prefix: "`", suffix: "`" },
] as const;
const CANONICAL_MENTION_PATTERN = /@\[([^\]]+)]\(user:([^)]+)\)/g;
const DESCRIPTION_ACTIONS: ReadonlyArray<{
  label: string;
  command: string;
  value?: string;
}> = [
  { label: "Bold", command: "bold" },
  { label: "Italic", command: "italic" },
  { label: "Bullet list", command: "insertUnorderedList" },
  { label: "Quote", command: "formatBlock", value: "blockquote" },
];

function applyIssueReactionToggle(reactions: IssueReaction[], emoji: string) {
  const existing = reactions.find((reaction) => reaction.emoji === emoji);

  if (!existing) {
    return [
      ...reactions,
      { emoji, count: 1, reacted: false, reactedByMe: true },
    ];
  }

  const reactedByMe = existing.reactedByMe ?? false;
  const nextCount = Math.max(0, existing.count + (reactedByMe ? -1 : 1));

  if (nextCount === 0) {
    return reactions.filter((reaction) => reaction.emoji !== emoji);
  }

  return reactions.map((reaction) =>
    reaction.emoji === emoji
      ? { ...reaction, count: nextCount, reactedByMe: !reactedByMe }
      : reaction,
  );
}

function formatFullDate(dateStr: string): string {
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
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeMentionLabel(value: string): string {
  return value.replaceAll("]", "");
}

function getMemberDisplayName(
  member: Pick<WorkspaceMemberOption, "name" | "email">,
) {
  return member.name?.trim() || member.email?.split("@")[0] || "Member";
}

function buildMentionToken(
  member: Pick<WorkspaceMemberOption, "userId" | "name" | "email">,
) {
  return `@[${escapeMentionLabel(getMemberDisplayName(member))}](user:${member.userId})`;
}

function extractSelectedMentionsFromBody(body: string): SelectedMention[] {
  const mentions = new Map<string, SelectedMention>();

  for (const match of body.matchAll(CANONICAL_MENTION_PATTERN)) {
    const name = match[1];
    const userId = match[2];
    const token = match[0];
    if (name && userId && !mentions.has(userId)) {
      mentions.set(userId, { userId, name, token });
    }
  }

  return [...mentions.values()];
}

function renderCommentBodyWithMentions(body: string) {
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of body.matchAll(CANONICAL_MENTION_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push(body.slice(lastIndex, index));
    }

    const name = match[1] ?? "member";
    const userId = match[2] ?? name;
    parts.push(
      <span
        key={`${userId}-${index}`}
        data-user-id={userId}
        className="mx-0.5 inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-accent-muted)] px-2 py-0.5 text-[12px] font-medium text-[var(--color-text-primary)]"
      >
        @{name}
      </span>,
    );
    lastIndex = index + match[0].length;
  }

  if (lastIndex < body.length) {
    parts.push(body.slice(lastIndex));
  }

  return parts.length > 0 ? parts : body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeHistoryEvent(value: unknown): IssueHistoryEvent | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, type, metadata, actor, createdAt } = value;
  if (
    typeof id !== "string" ||
    (type !== "created" && type !== "updated" && type !== "comment_created") ||
    typeof createdAt !== "string"
  ) {
    return null;
  }

  const normalizedActor = isRecord(actor)
    ? {
        id: typeof actor.id === "string" ? actor.id : "",
        name: typeof actor.name === "string" ? actor.name : null,
        email: typeof actor.email === "string" ? actor.email : null,
      }
    : null;

  return {
    id,
    type,
    metadata: isRecord(metadata) ? metadata : {},
    actor: normalizedActor,
    createdAt,
  };
}

function getHistoryActorName(event: IssueHistoryEvent): string {
  return event.actor?.name ?? event.actor?.email ?? "Someone";
}

function getChangedFieldsLabel(metadata: Record<string, unknown>): string {
  const changedFields = metadata.changedFields;
  if (
    !Array.isArray(changedFields) ||
    !changedFields.every((field): field is string => typeof field === "string")
  ) {
    return "issue details";
  }

  const labels = changedFields.map((field) => {
    switch (field) {
      case "stateId":
        return "status";
      case "assigneeId":
        return "assignee";
      case "projectId":
        return "project";
      default:
        return field.replace(/Id$/, "");
    }
  });

  if (labels.length === 0) {
    return "issue details";
  }

  if (labels.length === 1) {
    return labels[0] ?? "issue details";
  }

  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function getHistoryEventDescription(event: IssueHistoryEvent): string {
  const actorName = getHistoryActorName(event);

  switch (event.type) {
    case "created": {
      const legacySuffix =
        event.metadata.migrationFallback === true ? " from legacy data" : "";
      return `${actorName} created this issue${legacySuffix}`;
    }
    case "updated":
      return `${actorName} updated ${getChangedFieldsLabel(event.metadata)}`;
    case "comment_created": {
      const attachmentCount = event.metadata.attachmentCount;
      const attachmentLabel =
        typeof attachmentCount === "number" && attachmentCount > 0
          ? ` with ${attachmentCount} ${
              attachmentCount === 1 ? "attachment" : "attachments"
            }`
          : "";
      return `${actorName} added a comment${attachmentLabel}`;
    }
  }
}

function AttachmentChip({
  attachment,
}: {
  attachment: IssueCommentAttachment;
}) {
  const content = (
    <>
      <span className="font-medium">{attachment.fileName}</span>
      <span className="text-[11px] text-[var(--color-text-secondary)]">
        {formatFileSize(attachment.size)}
      </span>
    </>
  );

  if (!attachment.downloadUrl) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)]">
        {content}
      </span>
    );
  }

  return (
    <a
      href={attachment.downloadUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      {content}
    </a>
  );
}

function CommentReactions({
  comment,
  disabled,
  onToggle,
}: {
  comment: IssueComment;
  disabled: boolean;
  onToggle: (commentId: string, emoji: string) => Promise<void>;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const availableQuickReactions = QUICK_REACTIONS.filter(
    (emoji) => !comment.reactions.some((reaction) => reaction.emoji === emoji),
  );

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {comment.reactions.map((reaction) => (
        <button
          key={`${comment.id}-${reaction.emoji}`}
          type="button"
          disabled={disabled}
          onClick={() => void onToggle(comment.id, reaction.emoji)}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[12px] transition-colors ${
            reaction.reacted
              ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_18%,transparent)] text-[var(--color-text-primary)]"
              : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          }`}
        >
          <span>{reaction.emoji}</span>
          <span>{reaction.count}</span>
        </button>
      ))}
      {availableQuickReactions.slice(0, 2).map((emoji) => (
        <button
          key={`${comment.id}-add-${emoji}`}
          type="button"
          disabled={disabled}
          onClick={() => void onToggle(comment.id, emoji)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)] text-[14px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
          aria-label={`React with ${emoji}`}
        >
          {emoji}
        </button>
      ))}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setPickerOpen((current) => !current)}
          className="inline-flex h-8 items-center justify-center rounded-full border border-[var(--color-border)] px-2 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
          aria-label="Open reaction picker"
          aria-haspopup="menu"
          aria-expanded={pickerOpen}
        >
          + Emoji
        </button>
        {pickerOpen ? (
          <div
            role="menu"
            aria-label="Comment reaction picker"
            className="absolute left-0 z-20 mt-2 grid w-48 grid-cols-6 gap-1 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-content-bg)] p-2 shadow-lg"
          >
            {EMOJI_REACTIONS.map((emoji) => (
              <button
                key={`${comment.id}-picker-${emoji}`}
                type="button"
                role="menuitem"
                className="rounded-lg p-1.5 text-[16px] hover:bg-[var(--color-surface-hover)]"
                onClick={() => {
                  setPickerOpen(false);
                  void onToggle(comment.id, emoji);
                }}
                aria-label={`React with ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function IssueDetailView({
  issueId,
  compact = false,
}: {
  issueId: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const workspaceSlug = useAppShellContext()?.workspaceSlug;
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyEvents, setHistoryEvents] = useState<IssueHistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<
    "title" | "description" | null
  >(null);
  const [commentBody, setCommentBody] = useState("");
  const [workspaceMembers, setWorkspaceMembers] = useState<
    WorkspaceMemberOption[]
  >([]);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [mentionSearch, setMentionSearch] = useState("");
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [subIssueTitle, setSubIssueTitle] = useState("");
  const [showSubIssueForm, setShowSubIssueForm] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [submittingSubIssue, setSubmittingSubIssue] = useState(false);
  const [reactingCommentId, setReactingCommentId] = useState<string | null>(
    null,
  );
  const [reactingIssueEmoji, setReactingIssueEmoji] = useState<string | null>(
    null,
  );
  const [issueReactionPickerOpen, setIssueReactionPickerOpen] = useState(false);
  const [subscriptionSaving, setSubscriptionSaving] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [descriptionFocused, setDescriptionFocused] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [actionsOpen, setActionsOpen] = useState(false);
  const [commentActionMenuId, setCommentActionMenuId] = useState<string | null>(
    null,
  );
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [commentEditBody, setCommentEditBody] = useState("");
  const [commentActionStatus, setCommentActionStatus] = useState<string | null>(
    null,
  );
  const [summaryActionStatus, setSummaryActionStatus] = useState<string | null>(
    null,
  );
  const [summaryGenerating, setSummaryGenerating] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [runningAction, setRunningAction] = useState<
    "archive" | "delete" | null
  >(null);
  const [issueReactionNotice, setIssueReactionNotice] = useState<string | null>(
    null,
  );
  const titleRef = useRef<HTMLHeadingElement>(null);
  const descriptionRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    window.localStorage.setItem(LAST_ISSUE_STORAGE_KEY, issueId);
  }, [issueId]);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(`/api/issues/${issueId}/history`);
      if (!res.ok) {
        throw new Error("Failed to load issue history");
      }

      const json = (await res.json()) as unknown;
      const history =
        isRecord(json) && Array.isArray(json.history)
          ? json.history
              .map((event) => normalizeHistoryEvent(event))
              .filter((event): event is IssueHistoryEvent => event !== null)
          : [];
      setHistoryEvents(history);
    } catch {
      setHistoryEvents([]);
      setHistoryError(
        "Couldn’t load activity history. Comments are still available.",
      );
    } finally {
      setHistoryLoading(false);
    }
  }, [issueId]);

  const fetchIssue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/issues/${issueId}`);
      if (res.ok) {
        const json = (await res.json()) as IssueDetail;
        setIssue({
          ...json,
          subscription: json.subscription ?? {
            subscribed: false,
            watcherCount: 0,
          },
          discussionSummary: json.discussionSummary ?? {
            enabled: false,
            status: "disabled",
            text: null,
            generatedAt: null,
            sourceCommentCount: 0,
          },
        });
        setDescriptionDraft(
          normalizeIssueDescriptionHtml(json.description) ?? "",
        );
      } else {
        setIssue(null);
      }
    } finally {
      setLoading(false);
    }
  }, [issueId]);

  useEffect(() => {
    void fetchIssue();
  }, [fetchIssue]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    let cancelled = false;

    async function fetchWorkspaceMembers() {
      try {
        const res = await fetch("/api/workspaces/members");
        if (!res.ok) {
          return;
        }

        const json = (await res.json()) as {
          members?: WorkspaceMemberOption[];
        };
        if (!cancelled) {
          setWorkspaceMembers(
            (json.members ?? []).filter(
              (member) => member.status === "active" && Boolean(member.userId),
            ),
          );
        }
      } catch {
        if (!cancelled) {
          setWorkspaceMembers([]);
        }
      }
    }

    void fetchWorkspaceMembers();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!issue) {
      return;
    }

    if (titleRef.current && document.activeElement !== titleRef.current) {
      titleRef.current.textContent = issue.title;
    }

    if (
      descriptionRef.current &&
      document.activeElement !== descriptionRef.current
    ) {
      const nextDescription =
        normalizeIssueDescriptionHtml(issue.description) ?? "";
      descriptionRef.current.innerHTML = nextDescription;
      setDescriptionDraft(nextDescription);
    }
  }, [issue]);

  async function patchIssue(
    payload: Partial<Pick<IssueDetail, "title" | "description">>,
    field: "title" | "description",
  ) {
    if (!issue) {
      return;
    }

    setSavingField(field);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`Failed to update issue ${field}`);
      }

      const updated = (await res.json()) as Partial<IssueDetail>;
      setIssue((current) =>
        current
          ? {
              ...current,
              ...payload,
              title: updated.title ?? payload.title ?? current.title,
              description:
                updated.description ??
                (payload.description === undefined
                  ? current.description
                  : payload.description),
              updatedAt: updated.updatedAt ?? current.updatedAt,
            }
          : current,
      );
      void fetchHistory();
    } finally {
      setSavingField(null);
    }
  }

  async function handleTitleBlur() {
    if (!issue || !titleRef.current) {
      return;
    }

    const nextTitle = titleRef.current.textContent?.trim() ?? "";
    if (!nextTitle) {
      titleRef.current.textContent = issue.title;
      return;
    }

    if (nextTitle !== issue.title) {
      await patchIssue({ title: nextTitle }, "title");
    }
  }

  async function handleDescriptionBlur() {
    if (!issue || !descriptionRef.current) {
      return;
    }

    const nextDescription = normalizeIssueDescriptionHtml(
      descriptionRef.current.innerHTML,
    );
    const currentDescription = normalizeIssueDescriptionHtml(issue.description);

    descriptionRef.current.innerHTML = nextDescription ?? "";
    setDescriptionDraft(nextDescription ?? "");

    if (nextDescription !== currentDescription) {
      await patchIssue({ description: nextDescription }, "description");
    }
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFiles = Array.from(event.target.files ?? []);

    setPendingAttachments((current) => {
      const merged = [...current];

      for (const nextFile of nextFiles) {
        const alreadySelected = merged.some(
          (currentFile) =>
            currentFile.name === nextFile.name &&
            currentFile.size === nextFile.size &&
            currentFile.lastModified === nextFile.lastModified,
        );

        if (!alreadySelected) {
          merged.push(nextFile);
        }
      }

      return merged.slice(0, 5);
    });

    event.target.value = "";
  }

  function removePendingAttachment(index: number) {
    setPendingAttachments((current) =>
      current.filter((_, currentIndex) => currentIndex !== index),
    );
  }

  async function handleGenerateDiscussionSummary() {
    if (!issue || summaryGenerating) {
      return;
    }

    setSummaryGenerating(true);
    setSummaryActionStatus(null);
    setIssue((current) =>
      current
        ? {
            ...current,
            discussionSummary: {
              ...current.discussionSummary,
              status: "generating",
              error: null,
            },
          }
        : current,
    );

    try {
      const res = await fetch(
        `/api/issues/${issue.identifier}/discussion-summary`,
        {
          method: "POST",
        },
      );
      const json = (await res.json()) as IssueDetail["discussionSummary"] & {
        error?: string;
      };

      if (!res.ok) {
        throw new Error(json.error ?? "Discussion summary generation failed");
      }

      setIssue((current) =>
        current ? { ...current, discussionSummary: json } : current,
      );
      setSummaryActionStatus("Discussion summary updated.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Discussion summary generation failed";
      setIssue((current) =>
        current
          ? {
              ...current,
              discussionSummary: {
                ...current.discussionSummary,
                status: "failed",
                error: message,
              },
            }
          : current,
      );
      setSummaryActionStatus(message);
    } finally {
      setSummaryGenerating(false);
    }
  }

  async function handleCommentSubmit() {
    const hasBody = commentBody.trim().length > 0;
    const hasAttachments = pendingAttachments.length > 0;

    if (!issue || (!hasBody && !hasAttachments) || submittingComment) {
      return;
    }

    setSubmittingComment(true);
    try {
      const canonicalMentions = extractSelectedMentionsFromBody(commentBody);
      const formData = new FormData();
      formData.set("body", commentBody.trim());
      formData.set(
        "mentionedUserIds",
        JSON.stringify(canonicalMentions.map((mention) => mention.userId)),
      );
      for (const attachment of pendingAttachments) {
        formData.append("attachments", attachment);
      }

      const res = await fetch(`/api/issues/${issue.id}/comments`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error("Failed to create comment");
      }

      const createdComment = (await res.json()) as IssueComment;
      setIssue((current) =>
        current
          ? {
              ...current,
              comments: [...current.comments, createdComment],
              discussionSummary: current.discussionSummary.enabled
                ? {
                    ...current.discussionSummary,
                    status: current.discussionSummary.text ? "stale" : "ready",
                    staleAt: new Date().toISOString(),
                    error: null,
                  }
                : current.discussionSummary,
            }
          : current,
      );
      setCommentBody("");
      setMentionPickerOpen(false);
      setMentionSearch("");
      setPendingAttachments([]);
      window.dispatchEvent(new CustomEvent("notifications:changed"));
      void fetchHistory();

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } finally {
      setSubmittingComment(false);
    }
  }

  async function handleReactionToggle(commentId: string, emoji: string) {
    if (reactingCommentId) {
      return;
    }

    setReactingCommentId(commentId);
    try {
      const res = await fetch(`/api/comments/${commentId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });

      if (!res.ok) {
        throw new Error("Failed to update reaction");
      }

      const nextReactions = (await res.json()) as IssueReaction[];
      setIssue((current) =>
        current
          ? {
              ...current,
              comments: current.comments.map((comment) =>
                comment.id === commentId
                  ? { ...comment, reactions: nextReactions }
                  : comment,
              ),
            }
          : current,
      );
    } finally {
      setReactingCommentId(null);
    }
  }

  async function handleSubIssueSubmit() {
    if (!issue || !subIssueTitle.trim() || submittingSubIssue) {
      return;
    }

    setSubmittingSubIssue(true);
    try {
      const res = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: subIssueTitle.trim(),
          teamId: issue.team.id,
          stateId: issue.state?.id,
          parentIssueId: issue.id,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to create sub-issue");
      }

      setSubIssueTitle("");
      setShowSubIssueForm(false);
      await fetchIssue();
    } finally {
      setSubmittingSubIssue(false);
    }
  }

  function applyDescriptionCommand(command: string, value?: string) {
    descriptionRef.current?.focus();
    document.execCommand(command, false, value);
    const nextDraft = descriptionRef.current?.innerHTML ?? "";
    setDescriptionDraft(nextDraft);
  }

  function applyCommentFormat(prefix: string, suffix: string) {
    const textarea = commentTextareaRef.current;
    if (!textarea) {
      setCommentBody((current) => `${prefix}${current}${suffix}`);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = commentBody.slice(start, end) || "text";
    const nextBody = `${commentBody.slice(0, start)}${prefix}${selectedText}${suffix}${commentBody.slice(end)}`;
    setCommentBody(nextBody);
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + prefix.length,
        start + prefix.length + selectedText.length,
      );
    });
  }

  function insertCommentSnippet(value: string) {
    const textarea = commentTextareaRef.current;
    if (!textarea) {
      setCommentBody((current) => `${current}${value}`);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const nextBody = `${commentBody.slice(0, start)}${value}${commentBody.slice(end)}`;
    setCommentBody(nextBody);
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + value.length, start + value.length);
    });
  }

  function openMentionPicker(search = "") {
    setMentionSearch(search);
    setMentionActiveIndex(0);
    setMentionPickerOpen(true);
  }

  function insertMention(member: WorkspaceMemberOption) {
    const textarea = commentTextareaRef.current;
    const token = buildMentionToken(member);
    const suffix = " ";

    if (!textarea) {
      setCommentBody((current) => `${current}${token}${suffix}`);
      setMentionPickerOpen(false);
      setMentionSearch("");
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const beforeCaret = commentBody.slice(0, start);
    const triggerMatch = beforeCaret.match(/(^|\s)@([\w.-]*)$/);
    const replaceStart = triggerMatch
      ? start - triggerMatch[0].trimStart().length
      : start;
    const nextBody = `${commentBody.slice(0, replaceStart)}${token}${suffix}${commentBody.slice(end)}`;
    const nextCaret = replaceStart + token.length + suffix.length;

    setCommentBody(nextBody);
    setMentionPickerOpen(false);
    setMentionSearch("");
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  }

  const filteredMentionMembers = workspaceMembers.filter((member) => {
    const query = mentionSearch.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return `${member.name ?? ""} ${member.email ?? ""}`
      .toLowerCase()
      .includes(query);
  });
  const selectedMentions = extractSelectedMentionsFromBody(commentBody);

  async function handleSubscriptionToggle() {
    if (!issue || subscriptionSaving) {
      return;
    }

    const wasSubscribed = issue.subscription.subscribed;
    const optimisticCount = Math.max(
      0,
      issue.subscription.watcherCount + (wasSubscribed ? -1 : 1),
    );

    setSubscriptionSaving(true);
    setIssue({
      ...issue,
      subscription: {
        subscribed: !wasSubscribed,
        watcherCount: optimisticCount,
      },
    });

    try {
      const res = await fetch(`/api/issues/${issue.identifier}/subscription`, {
        method: wasSubscribed ? "DELETE" : "POST",
      });

      if (!res.ok) {
        throw new Error("Failed to update subscription");
      }

      const subscription = (await res.json()) as IssueSubscriptionState;
      setIssue((current) => (current ? { ...current, subscription } : current));
    } catch {
      setIssue((current) =>
        current
          ? {
              ...current,
              subscription: {
                subscribed: wasSubscribed,
                watcherCount: issue.subscription.watcherCount,
              },
            }
          : current,
      );
    } finally {
      setSubscriptionSaving(false);
    }
  }

  async function handleCommentEdit(commentId: string) {
    const nextBody = commentEditBody.trim();
    if (!nextBody) {
      return;
    }

    const res = await fetch(`/api/comments/${commentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: nextBody }),
    });

    if (!res.ok) {
      setCommentActionStatus("Comment edit unavailable.");
      return;
    }

    const updated = (await res.json()) as Partial<IssueComment>;
    setIssue((current) =>
      current
        ? {
            ...current,
            comments: current.comments.map((comment) =>
              comment.id === commentId
                ? { ...comment, body: updated.body ?? nextBody }
                : comment,
            ),
            discussionSummary: current.discussionSummary.enabled
              ? {
                  ...current.discussionSummary,
                  status: current.discussionSummary.text ? "stale" : "ready",
                  staleAt: new Date().toISOString(),
                  error: null,
                }
              : current.discussionSummary,
          }
        : current,
    );
    setEditingCommentId(null);
    setCommentActionStatus("Comment updated.");
  }

  async function handleCommentDelete(commentId: string) {
    if (!window.confirm("Delete this comment?")) {
      return;
    }

    const res = await fetch(`/api/comments/${commentId}`, { method: "DELETE" });
    if (!res.ok) {
      setCommentActionStatus("Comment delete unavailable.");
      return;
    }

    setIssue((current) =>
      current
        ? {
            ...current,
            comments: current.comments.filter(
              (comment) => comment.id !== commentId,
            ),
            discussionSummary: current.discussionSummary.enabled
              ? {
                  ...current.discussionSummary,
                  status: current.discussionSummary.text ? "stale" : "ready",
                  staleAt: new Date().toISOString(),
                  error: null,
                }
              : current.discussionSummary,
          }
        : current,
    );
    setCommentActionStatus("Comment deleted.");
  }

  async function handleCopyCommentLink(commentId: string, detailHref: string) {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${detailHref}#comment-${commentId}`,
      );
      setCommentActionStatus("Comment link copied.");
    } catch {
      setCommentActionStatus("Comment link copy failed.");
    }
  }

  async function handleArchiveIssue() {
    if (!issue || runningAction) {
      return;
    }

    if (!window.confirm(`Archive ${issue.identifier}?`)) {
      return;
    }

    setActionStatus("Archiving issue...");
    setRunningAction("archive");
    setActionsOpen(false);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archive: true }),
      });

      if (!res.ok) {
        throw new Error("Archive failed");
      }

      setActionStatus("Issue archived and hidden from active lists.");
    } catch {
      setActionStatus("Archive unavailable");
    } finally {
      setRunningAction(null);
    }
  }

  async function handleDeleteIssue() {
    if (!issue || runningAction) {
      return;
    }

    if (!window.confirm(`Delete ${issue.identifier}? This cannot be undone.`)) {
      return;
    }

    setActionStatus("Deleting issue...");
    setRunningAction("delete");
    setActionsOpen(false);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, { method: "DELETE" });

      if (!res.ok) {
        throw new Error("Delete failed");
      }

      setActionStatus("Issue deleted. Redirecting...");
      setIssue(null);
      router.push(teamIssuesHref);
    } catch {
      setActionStatus("Delete unavailable");
      setRunningAction(null);
    }
  }

  function handleEditIssue() {
    setActionsOpen(false);
    titleRef.current?.focus();
  }

  async function handleIssueReactionClick(emoji: string) {
    if (!issue || reactingIssueEmoji) {
      return;
    }

    const previousReactions = issue.reactions;
    const currentReaction = previousReactions.find(
      (reaction) => reaction.emoji === emoji,
    );
    const wasReacted = currentReaction?.reactedByMe ?? false;
    const optimisticReactions = applyIssueReactionToggle(
      previousReactions,
      emoji,
    );

    setReactingIssueEmoji(emoji);
    setIssueReactionNotice(null);
    setIssue({ ...issue, reactions: optimisticReactions });

    try {
      const res = await fetch(`/api/issues/${issue.id}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });

      if (!res.ok) {
        throw new Error("Failed to update issue reaction");
      }

      const nextReactions = (await res.json()) as IssueReaction[];
      setIssue((current) =>
        current ? { ...current, reactions: nextReactions } : current,
      );
      setIssueReactionNotice(
        wasReacted ? `${emoji} reaction removed.` : `${emoji} reaction saved.`,
      );
    } catch {
      setIssue((current) =>
        current ? { ...current, reactions: previousReactions } : current,
      );
      setIssueReactionNotice("Couldn’t save reaction. Try again.");
    } finally {
      setReactingIssueEmoji(null);
    }
  }

  async function handleCopyLink(detailHref: string) {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${detailHref}`,
      );
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }

    window.setTimeout(() => {
      setCopyState("idle");
    }, 2000);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Issue not found
      </div>
    );
  }

  const teamIssuesHref = withWorkspaceSlug(
    `/team/${issue.team.key}/all`,
    workspaceSlug,
  );
  const detailHref = withWorkspaceSlug(
    `/team/${issue.team.key}/issue/${issue.identifier}`,
    workspaceSlug,
  );
  const descriptionIsEmpty =
    richTextHtmlToPlainText(descriptionDraft).trim().length === 0;

  return (
    <div className="flex h-full overflow-y-auto bg-[var(--color-content-bg)]">
      <div
        className={`mx-auto grid w-full grid-cols-1 ${
          compact
            ? "max-w-full gap-5 px-4 py-5"
            : "max-w-[1440px] gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-10"
        }`}
      >
        <div className="min-w-0">
          <div className="flex flex-col gap-6 border-b border-[var(--color-border)] pb-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[12px] uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                <Link
                  href={teamIssuesHref}
                  className="transition-colors hover:text-[var(--color-text-primary)]"
                >
                  {issue.team.name}
                </Link>
                <span>{issue.identifier}</span>
                <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] tracking-normal text-[var(--color-text-secondary)]">
                  {issue.state?.name ?? "No status"}
                </span>
              </div>
              <div
                ref={titleRef}
                contentEditable
                suppressContentEditableWarning
                onBlur={() => void handleTitleBlur()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.currentTarget.textContent = issue.title;
                    event.currentTarget.blur();
                  }
                }}
                className={`mt-4 min-h-[44px] rounded-md font-semibold leading-tight text-[var(--color-text-primary)] outline-none transition-shadow focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_25%,transparent)] ${
                  compact ? "text-[24px]" : "text-[36px]"
                }`}
                aria-label="Issue title"
              >
                {issue.title}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-[var(--color-text-secondary)]">
                <span>
                  {savingField === "title"
                    ? "Saving title..."
                    : `Updated ${formatFullDate(issue.updatedAt)}`}
                </span>
                <span>Created by {issue.creator?.name ?? "Unknown"}</span>
                {actionStatus && <span>{actionStatus}</span>}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <SidebarFavoriteButton
                objectType="issue"
                objectId={issue.id}
                label={issue.identifier}
              />
              <Link
                href={teamIssuesHref}
                className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                Back to issues
              </Link>
              <button
                type="button"
                onClick={() => void handleCopyLink(detailHref)}
                className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                {copyState === "copied"
                  ? "Copied"
                  : copyState === "failed"
                    ? "Copy failed"
                    : "Copy link"}
              </button>
              <button
                type="button"
                onClick={() => void handleSubscriptionToggle()}
                disabled={subscriptionSaving}
                aria-label={
                  issue.subscription.subscribed
                    ? "Unsubscribe from issue notifications"
                    : "Subscribe to issue notifications"
                }
                aria-pressed={issue.subscription.subscribed}
                className={`rounded-full border px-3 py-1.5 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  issue.subscription.subscribed
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                {subscriptionSaving
                  ? "Saving..."
                  : issue.subscription.subscribed
                    ? "Subscribed"
                    : "Subscribe"}
                {issue.subscription.watcherCount > 0
                  ? ` · ${issue.subscription.watcherCount}`
                  : ""}
              </button>
              <Link
                href={detailHref}
                target="_blank"
                className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                Open in tab
              </Link>
              <div className="relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={actionsOpen}
                  onClick={() => setActionsOpen((current) => !current)}
                  className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                >
                  Actions
                </button>
                {actionsOpen && (
                  <div
                    role="menu"
                    aria-label="Issue actions"
                    className="absolute right-0 z-10 mt-2 w-40 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-content-bg)] p-1 shadow-lg"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleEditIssue}
                      className="block w-full rounded-[10px] px-3 py-2 text-left text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleArchiveIssue()}
                      disabled={runningAction !== null}
                      className="block w-full rounded-[10px] px-3 py-2 text-left text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                    >
                      {runningAction === "archive" ? "Archiving..." : "Archive"}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleDeleteIssue()}
                      disabled={runningAction !== null}
                      className="block w-full rounded-[10px] px-3 py-2 text-left text-[13px] text-red-500 hover:bg-[var(--color-surface-hover)]"
                    >
                      {runningAction === "delete" ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-8 space-y-6">
            <section className="rounded-[24px] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                    Description
                  </div>
                  <div className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
                    Rich text supported. Changes save when focus leaves the
                    editor.
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {DESCRIPTION_ACTIONS.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() =>
                        applyDescriptionCommand(action.command, action.value)
                      }
                      className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative rounded-[20px] border border-[var(--color-border)] bg-[var(--color-content-bg)] px-4 py-4">
                {!descriptionFocused && descriptionIsEmpty && (
                  <span className="pointer-events-none absolute left-4 top-4 text-[15px] text-[var(--color-text-secondary)]">
                    Add a description...
                  </span>
                )}
                <div
                  ref={descriptionRef}
                  contentEditable
                  suppressContentEditableWarning
                  onFocus={() => setDescriptionFocused(true)}
                  onInput={(event) =>
                    setDescriptionDraft(event.currentTarget.innerHTML)
                  }
                  onBlur={() => {
                    setDescriptionFocused(false);
                    void handleDescriptionBlur();
                  }}
                  className="min-h-[180px] rounded-md text-[15px] leading-7 text-[var(--color-text-primary)] outline-none transition-shadow focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_20%,transparent)] [&_a]:text-[var(--color-accent)] [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-4 [&_li]:ml-4 [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc"
                  aria-label="Issue description"
                />
              </div>
              <div className="mt-3 text-[12px] text-[var(--color-text-secondary)]">
                {savingField === "description"
                  ? "Saving description..."
                  : "Use Bold, Italic, Bullet list, and Quote for richer notes."}
              </div>
            </section>

            <section className="rounded-[24px] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-[13px] font-medium text-[var(--color-text-secondary)]">
                  Sub-issues
                </h2>
                <button
                  type="button"
                  onClick={() => setShowSubIssueForm((current) => !current)}
                  className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                >
                  {showSubIssueForm ? "Cancel" : "Create sub-issue"}
                </button>
              </div>

              {showSubIssueForm && (
                <div className="mb-4 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={subIssueTitle}
                    onChange={(event) => setSubIssueTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleSubIssueSubmit();
                      }
                    }}
                    placeholder="Sub-issue title"
                    className="flex-1 rounded-full border border-[var(--color-border)] bg-[var(--color-content-bg)] px-4 py-2.5 text-[13px] text-[var(--color-text-primary)] outline-none transition-shadow focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_25%,transparent)]"
                  />
                  <button
                    type="button"
                    disabled={submittingSubIssue || !subIssueTitle.trim()}
                    onClick={() => void handleSubIssueSubmit()}
                    className="rounded-full bg-[var(--color-accent)] px-4 py-2.5 text-[12px] font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submittingSubIssue ? "Creating..." : "Create"}
                  </button>
                </div>
              )}

              {issue.subIssues.length > 0 ? (
                <div className="space-y-2">
                  {issue.subIssues.map((subIssue) => (
                    <Link
                      key={subIssue.id}
                      href={withWorkspaceSlug(
                        `/team/${issue.team.key}/issue/${subIssue.identifier}`,
                        workspaceSlug,
                      )}
                      className="flex items-center justify-between rounded-[18px] border border-[var(--color-border)] bg-[var(--color-content-bg)] px-4 py-3 text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
                    >
                      <div className="min-w-0">
                        <div className="text-[12px] text-[var(--color-text-secondary)]">
                          {subIssue.identifier}
                        </div>
                        <div className="truncate text-[var(--color-text-primary)]">
                          {subIssue.title}
                        </div>
                      </div>
                      <div className="text-[12px] text-[var(--color-text-secondary)]">
                        {subIssue.state?.name ?? "No status"}
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  No sub-issues yet
                </p>
              )}
            </section>

            <section className="rounded-[24px] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
              <h2 className="mb-4 text-[13px] font-medium text-[var(--color-text-secondary)]">
                Activity
              </h2>

              {issue.discussionSummary.enabled ? (
                <div
                  className="mb-5 rounded-[18px] border border-[var(--color-border)] bg-[var(--color-content-bg)] px-4 py-3"
                  aria-label="Discussion summary"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                        AI discussion summary
                      </div>
                      {issue.discussionSummary.generatedAt ? (
                        <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                          Generated{" "}
                          {formatFullDate(issue.discussionSummary.generatedAt)}
                          {issue.discussionSummary.status === "stale"
                            ? " · stale after new discussion"
                            : ""}
                        </p>
                      ) : null}
                    </div>
                    {issue.comments.length >= 2 ? (
                      <button
                        type="button"
                        className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-card-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => void handleGenerateDiscussionSummary()}
                        disabled={summaryGenerating}
                      >
                        {issue.discussionSummary.text
                          ? "Regenerate"
                          : "Generate"}
                      </button>
                    ) : null}
                  </div>
                  {issue.discussionSummary.status === "generating" ||
                  summaryGenerating ? (
                    <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
                      Generating an AI summary from the full discussion...
                    </p>
                  ) : issue.discussionSummary.error ? (
                    <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-[var(--color-text-primary)]">
                      <p>{issue.discussionSummary.error}</p>
                      <p className="text-[var(--color-text-secondary)]">
                        Retry when the AI summarizer is available.
                      </p>
                    </div>
                  ) : issue.discussionSummary.text ? (
                    <div className="mt-2 space-y-2">
                      {issue.discussionSummary.status === "stale" ? (
                        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[12px] text-amber-700 dark:text-amber-300">
                          New discussion was added after this summary.
                          Regenerate to refresh it.
                        </p>
                      ) : null}
                      <p className="whitespace-pre-line text-[13px] leading-relaxed text-[var(--color-text-primary)]">
                        {issue.discussionSummary.text}
                      </p>
                    </div>
                  ) : issue.comments.length >= 2 ? (
                    <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
                      This discussion is ready for an AI summary. Generate one
                      to persist it for the team.
                    </p>
                  ) : (
                    <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
                      Add at least two comments to generate an AI summary of the
                      discussion.
                    </p>
                  )}
                  {summaryActionStatus ? (
                    <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)]">
                      {summaryActionStatus}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {historyLoading && (
                <div className="mb-4 rounded-[18px] border border-[var(--color-border)] bg-[var(--color-content-bg)] px-4 py-3 text-[13px] text-[var(--color-text-secondary)]">
                  Loading activity history...
                </div>
              )}

              {historyError && (
                <div className="mb-4 rounded-[18px] border border-[var(--color-border)] bg-[var(--color-content-bg)] px-4 py-3 text-[13px] text-[var(--color-text-secondary)]">
                  {historyError}
                </div>
              )}

              {!historyLoading && !historyError && historyEvents.length > 0 && (
                <div className="mb-5 space-y-3">
                  {historyEvents.map((event) => (
                    <div
                      key={event.id}
                      className="flex gap-3 rounded-[18px] border border-[var(--color-border)] bg-[var(--color-content-bg)] px-4 py-3"
                    >
                      <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
                      <div className="min-w-0">
                        <div className="text-[13px] text-[var(--color-text-primary)]">
                          {getHistoryEventDescription(event)}
                        </div>
                        <div className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
                          {formatFullDate(event.createdAt)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!historyLoading &&
              !historyError &&
              historyEvents.length === 0 &&
              issue.comments.length === 0 ? (
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  No activity yet
                </p>
              ) : null}

              {commentActionStatus ? (
                <div className="mb-4 rounded-[18px] border border-[var(--color-border)] bg-[var(--color-content-bg)] px-4 py-3 text-[13px] text-[var(--color-text-secondary)]">
                  {commentActionStatus}
                </div>
              ) : null}

              {issue.comments.length > 0 ? (
                <div className="space-y-5">
                  {issue.comments.map((comment) => (
                    <div
                      key={comment.id}
                      id={`comment-${comment.id}`}
                      className="rounded-[20px] border border-[var(--color-border)] bg-[var(--color-content-bg)] px-4 py-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-[10px] font-medium text-white">
                            {comment.user.name?.[0]?.toUpperCase() ?? "?"}
                          </div>
                          <div>
                            <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                              {comment.user.name}
                            </div>
                            <div className="text-[12px] text-[var(--color-text-secondary)]">
                              {formatFullDate(comment.createdAt)}
                            </div>
                          </div>
                        </div>
                        <div className="relative">
                          <button
                            type="button"
                            aria-haspopup="menu"
                            aria-expanded={commentActionMenuId === comment.id}
                            aria-label="More actions"
                            onClick={() =>
                              setCommentActionMenuId((current) =>
                                current === comment.id ? null : comment.id,
                              )
                            }
                            className="rounded-full border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                          >
                            •••
                          </button>
                          {commentActionMenuId === comment.id ? (
                            <div
                              role="menu"
                              aria-label="More actions"
                              className="absolute right-0 z-20 mt-2 w-36 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-content-bg)] p-1 shadow-lg"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                className="block w-full rounded-[10px] px-3 py-2 text-left text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                                onClick={() => {
                                  setCommentActionMenuId(null);
                                  void handleCopyCommentLink(
                                    comment.id,
                                    detailHref,
                                  );
                                }}
                              >
                                Copy link
                              </button>
                              {comment.canEdit ? (
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="block w-full rounded-[10px] px-3 py-2 text-left text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                                  onClick={() => {
                                    setCommentActionMenuId(null);
                                    setEditingCommentId(comment.id);
                                    setCommentEditBody(comment.body);
                                  }}
                                >
                                  Edit
                                </button>
                              ) : null}
                              {comment.canDelete ? (
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="block w-full rounded-[10px] px-3 py-2 text-left text-[13px] text-red-500 hover:bg-[var(--color-surface-hover)]"
                                  onClick={() => {
                                    setCommentActionMenuId(null);
                                    void handleCommentDelete(comment.id);
                                  }}
                                >
                                  Delete
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      {editingCommentId === comment.id ? (
                        <div className="mt-3 space-y-2">
                          <textarea
                            value={commentEditBody}
                            onChange={(event) =>
                              setCommentEditBody(event.target.value)
                            }
                            className="w-full resize-none rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none"
                            rows={3}
                            aria-label="Edit comment"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="rounded-full bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white"
                              onClick={() => void handleCommentEdit(comment.id)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)]"
                              onClick={() => setEditingCommentId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : comment.body.trim().length > 0 ? (
                        <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-text-primary)]">
                          {renderCommentBodyWithMentions(comment.body)}
                        </p>
                      ) : null}
                      {comment.attachments.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {comment.attachments.map((attachment) => (
                            <AttachmentChip
                              key={attachment.id}
                              attachment={attachment}
                            />
                          ))}
                        </div>
                      )}
                      <CommentReactions
                        comment={comment}
                        disabled={reactingCommentId === comment.id}
                        onToggle={handleReactionToggle}
                      />
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="mt-6 rounded-[24px] border border-[var(--color-border)] bg-[var(--color-content-bg)] px-4 py-4">
                <div
                  className="mb-3 flex flex-wrap items-center gap-2"
                  aria-label="Comment composer toolbar"
                >
                  {COMMENT_FORMAT_ACTIONS.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      aria-label={`Format ${action.label.toLowerCase()}`}
                      onClick={() =>
                        applyCommentFormat(action.prefix, action.suffix)
                      }
                      className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                    >
                      {action.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => openMentionPicker()}
                    className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                    aria-haspopup="listbox"
                    aria-expanded={mentionPickerOpen}
                  >
                    Mention
                  </button>
                  <button
                    type="button"
                    onClick={() => insertCommentSnippet("🎉")}
                    className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                  >
                    Emoji
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                  >
                    Attach
                  </button>
                </div>
                <textarea
                  ref={commentTextareaRef}
                  placeholder="Leave a comment..."
                  value={commentBody}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setCommentBody(nextValue);
                    const caret = event.target.selectionStart;
                    const triggerMatch = nextValue
                      .slice(0, caret)
                      .match(/(^|\s)@([\w.-]*)$/);
                    if (triggerMatch) {
                      openMentionPicker(triggerMatch[2] ?? "");
                    }
                  }}
                  onKeyDown={(event) => {
                    if (mentionPickerOpen) {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setMentionPickerOpen(false);
                        return;
                      }

                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setMentionActiveIndex((current) =>
                          filteredMentionMembers.length === 0
                            ? 0
                            : (current + 1) % filteredMentionMembers.length,
                        );
                        return;
                      }

                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setMentionActiveIndex((current) =>
                          filteredMentionMembers.length === 0
                            ? 0
                            : (current - 1 + filteredMentionMembers.length) %
                              filteredMentionMembers.length,
                        );
                        return;
                      }

                      if (event.key === "Enter") {
                        const activeMember =
                          filteredMentionMembers[mentionActiveIndex];
                        if (activeMember) {
                          event.preventDefault();
                          insertMention(activeMember);
                          return;
                        }
                      }
                    }

                    if (
                      (event.metaKey || event.ctrlKey) &&
                      event.key === "Enter"
                    ) {
                      event.preventDefault();
                      void handleCommentSubmit();
                    }
                  }}
                  className="w-full resize-none bg-transparent text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none"
                  rows={4}
                />
                {mentionPickerOpen ? (
                  <div
                    role="menu"
                    aria-label="Mention members"
                    className="mt-2 max-h-56 overflow-y-auto rounded-[16px] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-lg"
                  >
                    {filteredMentionMembers.length > 0 ? (
                      filteredMentionMembers.map((member, index) => (
                        <button
                          key={member.userId}
                          type="button"
                          role="menuitem"
                          aria-current={
                            index === mentionActiveIndex ? "true" : undefined
                          }
                          onMouseEnter={() => setMentionActiveIndex(index)}
                          onClick={() => insertMention(member)}
                          className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left text-[13px] ${
                            index === mentionActiveIndex
                              ? "bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]"
                              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                          }`}
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-[10px] font-medium text-white">
                            {getMemberDisplayName(member)[0]?.toUpperCase() ??
                              "?"}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {getMemberDisplayName(member)}
                            </span>
                            {member.email ? (
                              <span className="block truncate text-[12px] text-[var(--color-text-secondary)]">
                                {member.email}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-[13px] text-[var(--color-text-secondary)]">
                        No matching workspace members
                      </div>
                    )}
                  </div>
                ) : null}
                {selectedMentions.length > 0 ? (
                  <div
                    className="mt-3 flex flex-wrap gap-2"
                    aria-label="Selected mentions"
                  >
                    {selectedMentions.map((mention) => (
                      <span
                        key={mention.userId}
                        className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-accent-muted)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-text-primary)]"
                      >
                        @{mention.name}
                      </span>
                    ))}
                  </div>
                ) : null}
                {pendingAttachments.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {pendingAttachments.map((attachment, index) => (
                      <button
                        key={`${attachment.name}-${attachment.size}-${attachment.lastModified}`}
                        type="button"
                        onClick={() => removePendingAttachment(index)}
                        className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                      >
                        <span>{attachment.name}</span>
                        <span className="text-[var(--color-text-secondary)]">
                          {formatFileSize(attachment.size)}
                        </span>
                        <span className="text-[var(--color-text-secondary)]">
                          Remove
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      onChange={handleAttachmentChange}
                      aria-label="Add attachments"
                      className="sr-only"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                    >
                      Add attachments
                    </button>
                    <div className="text-[12px] text-[var(--color-text-secondary)]">
                      Up to 5 files, 10 MB each
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[12px] text-[var(--color-text-secondary)]">
                      Send with Cmd/Ctrl + Enter
                    </div>
                    <button
                      type="button"
                      disabled={
                        submittingComment ||
                        (commentBody.trim().length === 0 &&
                          pendingAttachments.length === 0)
                      }
                      onClick={() => void handleCommentSubmit()}
                      className="rounded-full bg-[var(--color-accent)] px-4 py-2 text-[12px] font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {submittingComment ? "Posting..." : "Comment"}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <aside className="h-fit rounded-[24px] border border-[var(--color-border)] bg-[var(--color-sidebar-bg)] p-5 lg:sticky lg:top-4">
          <div className="rounded-[20px] border border-[var(--color-border)] bg-[var(--color-content-bg)] p-4">
            <div className="mb-3 text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
              Properties
            </div>
            {issue.state && (
              <IssueProperties
                status={{
                  name: issue.state.name,
                  category: issue.state.category,
                  color: issue.state.color,
                }}
                priority={issue.priority}
                assignee={issue.assignee}
                labels={issue.labels.map((label, index) => ({
                  id: `${label.name}-${index}`,
                  name: label.name,
                  color: label.color,
                }))}
                project={issue.project}
                dueDate={issue.dueDate}
                estimate={issue.estimate}
                cycle={issue.cycle}
                parentIssue={issue.parentIssue}
                relations={issue.relations}
                issueId={issue.id}
                onRelationAdded={(relation) =>
                  setIssue((current) =>
                    current
                      ? {
                          ...current,
                          relations: [...current.relations, relation],
                        }
                      : current,
                  )
                }
                onRelationRemoved={(relationId) =>
                  setIssue((current) =>
                    current
                      ? {
                          ...current,
                          relations: current.relations.filter(
                            (relation) => relation.id !== relationId,
                          ),
                        }
                      : current,
                  )
                }
                onNavigateToIssue={(identifier) =>
                  router.push(
                    withWorkspaceSlug(`/issue/${identifier}`, workspaceSlug),
                  )
                }
              />
            )}
          </div>

          <div className="mt-4 rounded-[20px] border border-[var(--color-border)] bg-[var(--color-content-bg)] p-4">
            <div className="mb-3 text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
              Issue reactions
            </div>
            <div
              className="flex flex-wrap gap-2"
              aria-label="Issue-level reactions"
            >
              {[
                ...QUICK_REACTIONS,
                ...issue.reactions
                  .map((reaction) => reaction.emoji)
                  .filter((emoji) => !QUICK_REACTIONS.includes(emoji)),
              ].map((emoji) => {
                const reaction = issue.reactions.find(
                  (currentReaction) => currentReaction.emoji === emoji,
                );
                const count = reaction?.count ?? 0;
                const reactedByMe = reaction?.reactedByMe ?? false;

                return (
                  <button
                    key={`issue-reaction-${emoji}`}
                    type="button"
                    onClick={() => handleIssueReactionClick(emoji)}
                    disabled={reactingIssueEmoji !== null}
                    className={`inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-full border px-2 text-[14px] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60 ${
                      reactedByMe
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]"
                        : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
                    }`}
                    aria-label={`Issue reaction ${emoji}${
                      reactedByMe ? " selected" : ""
                    }`}
                    aria-pressed={reactedByMe}
                  >
                    <span>{emoji}</span>
                    {count > 0 ? <span>{count}</span> : null}
                  </button>
                );
              })}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setIssueReactionPickerOpen((current) => !current)
                  }
                  disabled={reactingIssueEmoji !== null}
                  className="inline-flex h-8 items-center justify-center rounded-full border border-[var(--color-border)] px-3 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="Open issue reaction picker"
                  aria-haspopup="menu"
                  aria-expanded={issueReactionPickerOpen}
                >
                  + Emoji
                </button>
                {issueReactionPickerOpen ? (
                  <div
                    role="menu"
                    aria-label="Issue reaction picker"
                    className="absolute right-0 z-20 mt-2 grid w-48 grid-cols-6 gap-1 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-content-bg)] p-2 shadow-lg"
                  >
                    {EMOJI_REACTIONS.map((emoji) => (
                      <button
                        key={`issue-picker-${emoji}`}
                        type="button"
                        role="menuitem"
                        className="rounded-lg p-1.5 text-[16px] hover:bg-[var(--color-surface-hover)]"
                        onClick={() => {
                          setIssueReactionPickerOpen(false);
                          handleIssueReactionClick(emoji);
                        }}
                        aria-label={`Issue reaction ${emoji}`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            {issueReactionNotice ? (
              <p className="mt-3 text-[12px] text-[var(--color-text-secondary)]">
                {issueReactionNotice}
              </p>
            ) : null}
          </div>

          <div className="mt-4 rounded-[20px] border border-[var(--color-border)] bg-[var(--color-content-bg)] p-4">
            <div className="mb-3 text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
              Details
            </div>
            <div className="space-y-3 text-[12px]">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[var(--color-text-secondary)]">
                  Created
                </span>
                <span className="text-right text-[var(--color-text-primary)]">
                  {formatFullDate(issue.createdAt)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[var(--color-text-secondary)]">
                  Updated
                </span>
                <span className="text-right text-[var(--color-text-primary)]">
                  {formatFullDate(issue.updatedAt)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[var(--color-text-secondary)]">
                  Creator
                </span>
                <span className="max-w-[150px] truncate text-right text-[var(--color-text-primary)]">
                  {issue.creator?.name ?? "Unknown"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[var(--color-text-secondary)]">
                  Team route
                </span>
                <Link
                  href={detailHref}
                  className="truncate text-[var(--color-accent)] transition-colors hover:opacity-80"
                >
                  {issue.identifier}
                </Link>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
