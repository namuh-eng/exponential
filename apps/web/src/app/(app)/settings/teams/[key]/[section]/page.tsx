"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

const SECTION_CONTENT: Record<string, { title: string; description: string }> =
  {
    members: {
      title: "Members",
      description:
        "Review and manage team membership for this team from the shared settings flow.",
    },
    "slack-notifications": {
      title: "Slack notifications",
      description:
        "Connect a Slack channel and configure which team events are broadcast.",
    },
    labels: {
      title: "Issue labels",
      description:
        "Configure labels that are available to issues for this team.",
    },
    templates: {
      title: "Templates",
      description:
        "Create reusable issue, document, and project templates for this team.",
    },
    "recurring-issues": {
      title: "Recurring issues",
      description:
        "Set up scheduled issues that repeat for the team on a fixed cadence.",
    },
    workflows: {
      title: "Workflows & automations",
      description:
        "Adjust workflow rules, automations, and status transitions for the team.",
    },
    triage: {
      title: "Triage",
      description:
        "Configure whether incoming work requires triage before entering the backlog.",
    },
    cycles: {
      title: "Cycles",
      description:
        "Adjust the team's cycle cadence, duration, and scheduling defaults.",
    },
    agents: {
      title: "Agents",
      description:
        "Manage AI agent guidance and team-specific automation behavior.",
    },
    "discussion-summaries": {
      title: "Discussion summaries",
      description:
        "Configure whether AI-generated discussion summaries are enabled for the team.",
    },
    hierarchy: {
      title: "Parent team",
      description:
        "Set the parent team relationship used when organizing team hierarchies.",
    },
  };

export default function TeamSettingsPlaceholderPage() {
  const params = useParams();
  const key = params.key as string;
  const section = params.section as string;
  const content = SECTION_CONTENT[section] ?? {
    title: "Team settings",
    description: "This team settings section is not available.",
  };

  return (
    <div className="max-w-[720px]">
      <div className="mb-6">
        <Link
          href={`/settings/teams/${encodeURIComponent(key)}`}
          className="text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Back to team settings
        </Link>
      </div>

      <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">
        {content.title}
      </h1>
      <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
        {content.description}
      </p>

      <div className="mt-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Team-scoped navigation is now wired from the hub. This section keeps a
          dedicated destination in the settings tree while the detailed controls
          continue to evolve.
        </p>
      </div>
    </div>
  );
}
