"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
import { IssueRow, priorityMap } from "@/components/issue-row";
import { withWorkspaceSlug } from "@/lib/workspace-paths";
import { useSearchParams } from "next/navigation";
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
  assigneeName?: string | null;
  assigneeImage?: string | null;
  createdAt: string;
}

function isStatusCategory(value: unknown): value is StatusCategory {
  return (
    value === "triage" ||
    value === "backlog" ||
    value === "unstarted" ||
    value === "started" ||
    value === "completed" ||
    value === "canceled"
  );
}

function isSearchResult(value: unknown): value is SearchResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const result = value as Partial<SearchResult>;
  return (
    typeof result.id === "string" &&
    typeof result.identifier === "string" &&
    typeof result.title === "string" &&
    typeof result.priority === "string" &&
    typeof result.stateName === "string" &&
    isStatusCategory(result.stateCategory) &&
    typeof result.stateColor === "string" &&
    typeof result.createdAt === "string" &&
    (result.assigneeName === undefined ||
      result.assigneeName === null ||
      typeof result.assigneeName === "string") &&
    (result.assigneeImage === undefined ||
      result.assigneeImage === null ||
      typeof result.assigneeImage === "string")
  );
}

function SearchContent() {
  const searchParams = useSearchParams();
  const shellContext = useAppShellContext();
  const workspaceSlug = shellContext?.workspaceSlug;
  const query = searchParams.get("q") || "";
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query) {
      setResults([]);
      setError(null);
      return;
    }

    const params = new URLSearchParams({ q: query });
    if (workspaceSlug) {
      params.set("workspaceSlug", workspaceSlug);
    }

    let ignore = false;
    setLoading(true);
    setError(null);
    fetch(`/api/issues/search?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("Search failed. Please try again.");
        }

        const data = await res.json();
        if (!Array.isArray(data) || !data.every(isSearchResult)) {
          throw new Error(
            "Search results are missing required issue metadata.",
          );
        }

        if (!ignore) {
          setResults(data);
        }
      })
      .catch((searchError: unknown) => {
        if (!ignore) {
          setResults([]);
          setError(
            searchError instanceof Error
              ? searchError.message
              : "Search failed. Please try again.",
          );
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [query, workspaceSlug]);

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
        ) : error ? (
          <div className="py-20 text-center text-[var(--color-text-secondary)]">
            {error}
          </div>
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
                  `/issue/${issue.identifier}`,
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
