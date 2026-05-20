"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
import { ContextualInsights } from "@/components/contextual-insights";
import { CycleProgressBar } from "@/components/cycle-progress-bar";
import { EmptyState } from "@/components/empty-state";
import { IssueRow, priorityMap } from "@/components/issue-row";
import { IssuesGroupHeader } from "@/components/issues-group-header";
import { formatCycleDate } from "@/lib/cycle-utils";
import { withWorkspaceSlug } from "@/lib/workspace-paths";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface IssueData {
  id: string;
  number: number;
  identifier: string;
  title: string;
  priority: string;
  stateId: string;
  assigneeId: string | null;
  assignee: { name: string; image?: string } | null;
  labels: { name: string; color: string }[];
  projectId: string | null;
  dueDate: string | null;
  createdAt: string;
}

interface StateGroup {
  state: {
    id: string;
    name: string;
    category: string;
    color: string;
    position: number;
  };
  issues: IssueData[];
}

type StatusCategory =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

interface CycleDetailResponse {
  team: { id: string; name: string; key: string };
  cycle: {
    id: string;
    name: string | null;
    number: number;
    startDate: string;
    endDate: string;
    issueCount: number;
    completedIssueCount: number;
  };
  groups: StateGroup[];
}

export default function CycleDetailPage() {
  const params = useParams<{ key: string; cycleId: string }>();
  const router = useRouter();
  const workspaceSlug = useAppShellContext()?.workspaceSlug;
  const [data, setData] = useState<CycleDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCycleDetail() {
      try {
        const res = await fetch(
          `/api/teams/${params.key}/cycles/${params.cycleId}`,
        );
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } finally {
        setLoading(false);
      }
    }
    fetchCycleDetail();
  }, [params.key, params.cycleId]);

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
        title="Cycle not found"
        description="This cycle may have been deleted."
      />
    );
  }

  const cycleName = data.cycle.name ?? `Cycle ${data.cycle.number}`;
  const nonEmptyGroups = data.groups.filter((g) => g.issues.length > 0);
  const scopedIssueIds = nonEmptyGroups.flatMap((group) =>
    group.issues.map((issue) => issue.id),
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-2">
        <button
          type="button"
          onClick={() =>
            router.push(
              withWorkspaceSlug(`/team/${params.key}/cycles`, workspaceSlug),
            )
          }
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
          Cycles
        </button>
        <span className="text-[var(--color-text-tertiary)]">/</span>
        <h1 className="text-[15px] font-medium text-[var(--color-text-primary)]">
          {cycleName}
        </h1>
        <span className="text-[12px] text-[var(--color-text-secondary)]">
          {formatCycleDate(data.cycle.startDate)} —{" "}
          {formatCycleDate(data.cycle.endDate)}
        </span>
        <div className="ml-2">
          <CycleProgressBar
            completed={data.cycle.completedIssueCount}
            total={data.cycle.issueCount}
          />
        </div>
        <div className="flex-1" />
        <ContextualInsights
          teamKey={data.team.key}
          scopedIssueIds={scopedIssueIds}
          contextLabel={cycleName}
        />
      </div>

      {/* Issues grouped by status */}
      <div className="flex-1 overflow-y-auto">
        {data.cycle.issueCount === 0 ? (
          <EmptyState
            title="No issues in this cycle"
            description="Add issues to this cycle to track progress."
          />
        ) : (
          nonEmptyGroups.map((group) => (
            <div key={group.state.id} className="group">
              <IssuesGroupHeader
                name={group.state.name}
                count={group.issues.length}
                statusCategory={group.state.category as StatusCategory}
                statusColor={group.state.color}
              />
              {group.issues.map((iss) => (
                <IssueRow
                  key={iss.id}
                  href={withWorkspaceSlug(
                    `/team/${params.key}/issue/${iss.identifier}`,
                    workspaceSlug,
                  )}
                  identifier={iss.identifier}
                  title={iss.title}
                  priority={priorityMap[iss.priority] ?? 0}
                  statusCategory={group.state.category as StatusCategory}
                  statusColor={group.state.color}
                  assigneeName={iss.assignee?.name}
                  assigneeImage={iss.assignee?.image ?? undefined}
                  labels={iss.labels}
                  createdAt={iss.createdAt}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center border-t border-[var(--color-border)] px-4 py-1.5 text-[12px] text-[var(--color-text-secondary)]">
        {data.cycle.issueCount} issues
      </div>
    </div>
  );
}
