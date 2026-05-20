import type { FilterCondition } from "@/components/filter-bar";

export type ViewEntityType = "issues" | "projects";
export type ViewScope = "team" | "workspace";
export type ViewLayout = "list" | "board" | "timeline";
export type ProjectViewStatusFilter = "all" | (string & {});
export type ProjectViewSortOption =
  | "created-desc"
  | "created-asc"
  | "name-asc"
  | "progress-desc"
  | "target-date-asc";

export interface ViewFilterState {
  entityType: ViewEntityType;
  scope: ViewScope;
  issueFilters: FilterCondition[];
  projectStatusFilter: ProjectViewStatusFilter;
  projectSortBy: ProjectViewSortOption;
}

export interface ViewSummary {
  id: string;
  name: string;
  layout: ViewLayout;
  isPersonal: boolean;
  owner: { name: string; image: string | null } | null;
  createdAt: string;
  updatedAt: string;
  entityType: ViewEntityType;
  scope: ViewScope;
  teamId: string | null;
  teamKey: string | null;
  teamName: string | null;
  filterState: ViewFilterState;
}

export const projectViewStatusOptions: Array<{
  value: ProjectViewStatusFilter;
  label: string;
}> = [
  { value: "all", label: "All statuses" },
  { value: "planned", label: "Planned" },
  { value: "started", label: "In progress" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
  { value: "canceled", label: "Canceled" },
];

export const projectViewSortOptions: Array<{
  value: ProjectViewSortOption;
  label: string;
}> = [
  { value: "created-desc", label: "Newest" },
  { value: "created-asc", label: "Oldest" },
  { value: "name-asc", label: "Name" },
  { value: "progress-desc", label: "Progress" },
  { value: "target-date-asc", label: "Target date" },
];

function isFilterCondition(value: unknown): value is FilterCondition {
  if (!value || typeof value !== "object") {
    return false;
  }

  const filter = value as Partial<FilterCondition>;
  return (
    typeof filter.type === "string" &&
    (filter.operator === "is" || filter.operator === "isNot") &&
    Array.isArray(filter.values) &&
    filter.values.every((entry) => typeof entry === "string")
  );
}

export function normalizeViewFilterState(
  value: unknown,
  teamId: string | null = null,
): ViewFilterState {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  const entityType: ViewEntityType =
    record.entityType === "projects" ? "projects" : "issues";
  const scope: ViewScope =
    record.scope === "workspace" || (!teamId && record.scope !== "team")
      ? "workspace"
      : "team";
  const issueFilters = Array.isArray(record.issueFilters)
    ? record.issueFilters.filter(isFilterCondition)
    : [];
  const projectStatusFilter = projectViewStatusOptions.some(
    (option) => option.value === record.projectStatusFilter,
  )
    ? (record.projectStatusFilter as ProjectViewStatusFilter)
    : "all";
  const projectSortBy = projectViewSortOptions.some(
    (option) => option.value === record.projectSortBy,
  )
    ? (record.projectSortBy as ProjectViewSortOption)
    : "created-desc";

  return {
    entityType,
    scope,
    issueFilters,
    projectStatusFilter,
    projectSortBy,
  };
}
