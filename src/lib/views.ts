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

export type TimelineByOption = "created" | "updated" | "dueDate";
export type IssueViewGroupByOption =
  | "status"
  | "priority"
  | "assignee"
  | "label"
  | "project"
  | "none";
export type IssueViewOrderByOption =
  | "priority"
  | "created"
  | "updated"
  | "manual";
export interface IssueViewVisibleProperties {
  id: boolean;
  status: boolean;
  assignee: boolean;
  priority: boolean;
  project: boolean;
  dueDate: boolean;
  milestone: boolean;
  labels: boolean;
  links: boolean;
  timeInStatus: boolean;
  created: boolean;
  updated: boolean;
  pullRequests: boolean;
}

export interface IssueViewDisplayOptions {
  groupBy: IssueViewGroupByOption;
  orderBy: IssueViewOrderByOption;
  visibleProperties: IssueViewVisibleProperties;
  timelineBy: TimelineByOption;
}

export interface ViewFilterState {
  entityType: ViewEntityType;
  scope: ViewScope;
  issueFilters: FilterCondition[];
  issueDisplayOptions: IssueViewDisplayOptions;
  projectStatusFilter: ProjectViewStatusFilter;
  projectSortBy: ProjectViewSortOption;
  projectGroupBy: "status" | "team" | "none";
  projectVisibleProperties: {
    lead: boolean;
    team: boolean;
    status: boolean;
    progress: boolean;
    targetDate: boolean;
  };
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

export const defaultIssueViewDisplayOptions: IssueViewDisplayOptions = {
  groupBy: "status",
  orderBy: "priority",
  visibleProperties: {
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
  },
  timelineBy: "created",
};

export const projectViewGroupOptions = [
  { value: "none", label: "No grouping" },
  { value: "status", label: "Status" },
  { value: "team", label: "Team" },
] as const;

export const defaultProjectViewVisibleProperties = {
  lead: true,
  team: true,
  status: true,
  progress: true,
  targetDate: true,
};

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
  const rawIssueDisplay =
    record.issueDisplayOptions && typeof record.issueDisplayOptions === "object"
      ? (record.issueDisplayOptions as Record<string, unknown>)
      : {};
  const rawIssueProperties =
    rawIssueDisplay.visibleProperties &&
    typeof rawIssueDisplay.visibleProperties === "object"
      ? (rawIssueDisplay.visibleProperties as Record<string, unknown>)
      : {};
  const issueDisplayOptions: IssueViewDisplayOptions = {
    groupBy: [
      "status",
      "priority",
      "assignee",
      "label",
      "project",
      "none",
    ].includes(String(rawIssueDisplay.groupBy))
      ? (rawIssueDisplay.groupBy as IssueViewGroupByOption)
      : defaultIssueViewDisplayOptions.groupBy,
    orderBy: ["priority", "created", "updated", "manual"].includes(
      String(rawIssueDisplay.orderBy),
    )
      ? (rawIssueDisplay.orderBy as IssueViewOrderByOption)
      : defaultIssueViewDisplayOptions.orderBy,
    visibleProperties: {
      ...defaultIssueViewDisplayOptions.visibleProperties,
      ...Object.fromEntries(
        Object.keys(defaultIssueViewDisplayOptions.visibleProperties).map(
          (key) => [
            key,
            typeof rawIssueProperties[key] === "boolean"
              ? rawIssueProperties[key]
              : defaultIssueViewDisplayOptions.visibleProperties[
                  key as keyof IssueViewVisibleProperties
                ],
          ],
        ),
      ),
    } as IssueViewVisibleProperties,
    timelineBy: ["created", "updated", "dueDate"].includes(
      String(rawIssueDisplay.timelineBy),
    )
      ? (rawIssueDisplay.timelineBy as TimelineByOption)
      : defaultIssueViewDisplayOptions.timelineBy,
  };
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
  const projectGroupBy = projectViewGroupOptions.some(
    (option) => option.value === record.projectGroupBy,
  )
    ? (record.projectGroupBy as ViewFilterState["projectGroupBy"])
    : "none";
  const rawProjectProperties =
    record.projectVisibleProperties &&
    typeof record.projectVisibleProperties === "object"
      ? (record.projectVisibleProperties as Record<string, unknown>)
      : {};

  return {
    entityType,
    scope,
    issueFilters,
    issueDisplayOptions,
    projectStatusFilter,
    projectSortBy,
    projectGroupBy,
    projectVisibleProperties: {
      lead:
        typeof rawProjectProperties.lead === "boolean"
          ? rawProjectProperties.lead
          : defaultProjectViewVisibleProperties.lead,
      team:
        typeof rawProjectProperties.team === "boolean"
          ? rawProjectProperties.team
          : defaultProjectViewVisibleProperties.team,
      status:
        typeof rawProjectProperties.status === "boolean"
          ? rawProjectProperties.status
          : defaultProjectViewVisibleProperties.status,
      progress:
        typeof rawProjectProperties.progress === "boolean"
          ? rawProjectProperties.progress
          : defaultProjectViewVisibleProperties.progress,
      targetDate:
        typeof rawProjectProperties.targetDate === "boolean"
          ? rawProjectProperties.targetDate
          : defaultProjectViewVisibleProperties.targetDate,
    },
  };
}
