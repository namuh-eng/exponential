import type {
  DisplayProperties,
  GroupByOption,
  OrderByOption,
} from "@/components/display-options-panel";
import type { FilterCondition } from "@/components/filter-bar";

export type ViewEntityType = "issues" | "projects";
export type ViewScope = "team" | "workspace";
export type ViewLayout = "list" | "board" | "timeline";
export type ProjectViewStatusFilter =
  | "all"
  | "planned"
  | "started"
  | "paused"
  | "completed"
  | "canceled";
export type ProjectViewSortOption =
  | "created-desc"
  | "created-asc"
  | "name-asc"
  | "progress-desc"
  | "target-date-asc";

export interface ViewDisplayOptions {
  groupBy: GroupByOption;
  subGroupBy: GroupByOption;
  orderBy: OrderByOption;
  displayProperties: DisplayProperties;
  showSubIssues: boolean;
  showTriageIssues: boolean;
  showEmptyColumns: boolean;
}

export type ProjectViewGroupByOption = "status" | "lead" | "team" | "none";

export interface ProjectViewDisplayOptions {
  groupBy: ProjectViewGroupByOption;
  visibleProperties: {
    lead: boolean;
    team: boolean;
    targetDate: boolean;
    progress: boolean;
    status: boolean;
  };
}

export interface ViewFilterState {
  entityType: ViewEntityType;
  scope: ViewScope;
  issueFilters: FilterCondition[];
  issueDisplayOptions: ViewDisplayOptions;
  projectStatusFilter: ProjectViewStatusFilter;
  projectSortBy: ProjectViewSortOption;
  projectDisplayOptions: ProjectViewDisplayOptions;
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

const defaultIssueDisplayProperties: DisplayProperties = {
  id: true,
  status: true,
  assignee: true,
  priority: true,
  project: true,
  dueDate: true,
  milestone: false,
  labels: true,
  links: false,
  timeInStatus: false,
  created: true,
  updated: false,
  pullRequests: false,
};

export const defaultViewDisplayOptions: ViewDisplayOptions = {
  groupBy: "status",
  subGroupBy: "none",
  orderBy: "priority",
  displayProperties: { ...defaultIssueDisplayProperties },
  showSubIssues: true,
  showTriageIssues: false,
  showEmptyColumns: false,
};

export const defaultProjectViewDisplayOptions: ProjectViewDisplayOptions = {
  groupBy: "status",
  visibleProperties: {
    lead: true,
    team: true,
    targetDate: true,
    progress: true,
    status: true,
  },
};

const groupByOptions = new Set<GroupByOption>([
  "status",
  "priority",
  "assignee",
  "label",
  "project",
  "none",
]);
const orderByOptions = new Set<OrderByOption>([
  "priority",
  "created",
  "updated",
  "manual",
]);
const projectGroupByOptions = new Set<ProjectViewGroupByOption>([
  "status",
  "lead",
  "team",
  "none",
]);

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

function normalizeDisplayProperties(value: unknown): DisplayProperties {
  if (!value || typeof value !== "object") {
    return { ...defaultIssueDisplayProperties };
  }

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(defaultIssueDisplayProperties).map((key) => [
      key,
      typeof record[key] === "boolean"
        ? record[key]
        : defaultIssueDisplayProperties[key as keyof DisplayProperties],
    ]),
  ) as unknown as DisplayProperties;
}

function normalizeIssueDisplayOptions(value: unknown): ViewDisplayOptions {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  return {
    groupBy: groupByOptions.has(record.groupBy as GroupByOption)
      ? (record.groupBy as GroupByOption)
      : defaultViewDisplayOptions.groupBy,
    subGroupBy: groupByOptions.has(record.subGroupBy as GroupByOption)
      ? (record.subGroupBy as GroupByOption)
      : defaultViewDisplayOptions.subGroupBy,
    orderBy: orderByOptions.has(record.orderBy as OrderByOption)
      ? (record.orderBy as OrderByOption)
      : defaultViewDisplayOptions.orderBy,
    displayProperties: normalizeDisplayProperties(record.displayProperties),
    showSubIssues:
      typeof record.showSubIssues === "boolean"
        ? record.showSubIssues
        : defaultViewDisplayOptions.showSubIssues,
    showTriageIssues:
      typeof record.showTriageIssues === "boolean"
        ? record.showTriageIssues
        : defaultViewDisplayOptions.showTriageIssues,
    showEmptyColumns:
      typeof record.showEmptyColumns === "boolean"
        ? record.showEmptyColumns
        : defaultViewDisplayOptions.showEmptyColumns,
  };
}

function normalizeProjectDisplayOptions(
  value: unknown,
): ProjectViewDisplayOptions {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const properties =
    record.visibleProperties && typeof record.visibleProperties === "object"
      ? (record.visibleProperties as Record<string, unknown>)
      : {};

  return {
    groupBy: projectGroupByOptions.has(
      record.groupBy as ProjectViewGroupByOption,
    )
      ? (record.groupBy as ProjectViewGroupByOption)
      : defaultProjectViewDisplayOptions.groupBy,
    visibleProperties: {
      lead:
        typeof properties.lead === "boolean"
          ? properties.lead
          : defaultProjectViewDisplayOptions.visibleProperties.lead,
      team:
        typeof properties.team === "boolean"
          ? properties.team
          : defaultProjectViewDisplayOptions.visibleProperties.team,
      targetDate:
        typeof properties.targetDate === "boolean"
          ? properties.targetDate
          : defaultProjectViewDisplayOptions.visibleProperties.targetDate,
      progress:
        typeof properties.progress === "boolean"
          ? properties.progress
          : defaultProjectViewDisplayOptions.visibleProperties.progress,
      status:
        typeof properties.status === "boolean"
          ? properties.status
          : defaultProjectViewDisplayOptions.visibleProperties.status,
    },
  };
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
    issueDisplayOptions: normalizeIssueDisplayOptions(
      record.issueDisplayOptions,
    ),
    projectStatusFilter,
    projectSortBy,
    projectDisplayOptions: normalizeProjectDisplayOptions(
      record.projectDisplayOptions,
    ),
  };
}
