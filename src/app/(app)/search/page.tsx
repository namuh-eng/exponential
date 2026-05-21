"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
import { IssueRow, priorityMap } from "@/components/issue-row";
import {
  getWorkspaceSlugFromPath,
  withWorkspaceSlug,
} from "@/lib/workspace-paths";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

type StatusCategory =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

interface SearchResult {
  id: string;
  identifier: string;
  title: string;
  priority: string;
  stateName: string;
  stateCategory: StatusCategory;
  stateColor: string;
  teamKey: string;
  assigneeName?: string | null;
  assigneeImage?: string | null;
  createdAt: string;
}

function SearchContent() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const shellContext = useAppShellContext();
  const workspaceSlug =
    shellContext?.workspaceSlug ?? getWorkspaceSlugFromPath(pathname);
  const workspaceId = shellContext?.workspaceId;
  const query = searchParams.get("q") || "";
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }

    const apiParams = new URLSearchParams({ q: query });
    if (workspaceId) {
      apiParams.set("workspaceId", workspaceId);
    }

    setLoading(true);
    fetch(`/api/issues/search?${apiParams.toString()}`)
      .then((res) => res.json())
      .then((data) => setResults(data))
      .finally(() => setLoading(false));
  }, [query, workspaceId]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center border-b border-[var(--color-border)] px-6 py-4">
        <h1 className="text-[18px] font-semibold text-[var(--color-text-primary)]">
          Search results for "{query}"
        </h1>
        <span className="ml-3 text-[13px] text-[var(--color-text-tertiary)]">
          {results.length} {results.length === 1 ? "issue" : "issues"}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="text-[var(--color-text-secondary)]">Searching...</div>
        ) : results.length === 0 ? (
          <div className="py-20 text-center text-[var(--color-text-secondary)]">
            No issues found matching your search.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            {results.map((issue) => (
              <IssueRow
                key={issue.id}
                identifier={issue.identifier}
                title={issue.title}
                priority={priorityMap[issue.priority] ?? 0}
                statusCategory={issue.stateCategory}
                statusColor={issue.stateColor}
                assigneeName={issue.assigneeName ?? undefined}
                assigneeImage={issue.assigneeImage ?? undefined}
                createdAt={issue.createdAt}
                href={withWorkspaceSlug(
                  `/team/${issue.teamKey}/issue/${issue.identifier}`,
                  workspaceSlug,
                )}
                labels={[]}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <SearchContent />
    </Suspense>
  );
}
