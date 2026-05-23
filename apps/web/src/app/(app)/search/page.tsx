"use client";

import { IssueRow, priorityMap } from "@/components/issue-row";
import { withWorkspaceSlug } from "@/lib/workspace-paths";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useAppShellContext } from "../app-shell";

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

function SearchContent() {
  const shellContext = useAppShellContext();
  const searchParams = useSearchParams();
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

    let cancelled = false;
    setLoading(true);
    setError(null);

    async function searchIssues() {
      try {
        const res = await fetch(
          `/api/issues/search?q=${encodeURIComponent(query)}`,
        );
        if (!res.ok) {
          throw new Error("Search request failed");
        }

        const data: unknown = await res.json();
        if (!Array.isArray(data) || !data.every(isSearchResult)) {
          throw new Error("Search returned incomplete issue metadata");
        }

        if (!cancelled) {
          setResults(data);
        }
      } catch {
        if (!cancelled) {
          setResults([]);
          setError("Search results could not be loaded. Please try again.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void searchIssues();

    return () => {
      cancelled = true;
    };
  }, [query]);

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
          <div
            role="alert"
            className="py-20 text-center text-[var(--color-text-secondary)]"
          >
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
                  shellContext?.workspaceSlug,
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

  const result = value as Record<string, unknown>;
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

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <SearchContent />
    </Suspense>
  );
}
