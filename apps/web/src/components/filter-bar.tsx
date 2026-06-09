"use client";

import { useCallback, useRef, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────

export type FilterType =
  | "status"
  | "priority"
  | "assignee"
  | "label"
  | "project"
  | "cycle"
  | "creator"
  | "dueDate"
  | "estimate"
  | "team";

export type FilterOperator = "is" | "isNot";

export interface FilterCondition {
  type: FilterType;
  operator: FilterOperator;
  values: string[];
}

interface StatusOption {
  id: string;
  name: string;
  category: string;
  color: string;
}

interface LabelOption {
  id: string;
  name: string;
  color: string;
}

interface AssigneeOption {
  id: string;
  name: string;
  image?: string | null;
}

interface PriorityOption {
  value: string;
  label: string;
}

interface ProjectOption {
  id: string;
  name: string;
}

interface CreatorOption {
  id: string;
  name: string;
}

interface CycleOption {
  id: string;
  name: string;
}

interface EstimateOption {
  value: string;
  label: string;
}

interface DueDateOption {
  value: string;
  label: string;
}

interface TeamOption {
  id: string;
  name: string;
}

export interface FilterBarProps {
  filters: FilterCondition[];
  onFiltersChange: (filters: FilterCondition[]) => void;
  availableStatuses: StatusOption[];
  availableLabels: LabelOption[];
  availableAssignees: AssigneeOption[];
  availablePriorities: PriorityOption[];
  availableProjects?: ProjectOption[];
  availableCreators?: CreatorOption[];
  availableCycles?: CycleOption[];
  availableEstimates?: EstimateOption[];
  availableDueDates?: DueDateOption[];
  availableTeams?: TeamOption[];
}

// ─── Filter Application Logic ────────────────────────────────────────

interface FilterableIssue {
  id: string;
  stateId: string;
  priority: string;
  assigneeId: string | null;
  labelIds: string[];
  projectId: string | null;
  creatorId?: string | null;
  cycleId?: string | null;
  dueDate?: string | Date | null;
  estimate?: number | string | null;
  teamId?: string | null;
}

export function applyFilters<T extends FilterableIssue>(
  issues: T[],
  filters: FilterCondition[],
): T[] {
  if (filters.length === 0) return issues;

  return issues.filter((issue) =>
    filters.every((filter) => {
      const match = matchesValue(issue, filter);
      return filter.operator === "isNot" ? !match : match;
    }),
  );
}

function matchesValue(
  issue: FilterableIssue,
  filter: FilterCondition,
): boolean {
  const { type, values } = filter;

  switch (type) {
    case "status":
      return values.includes(issue.stateId);
    case "priority":
      return values.includes(issue.priority);
    case "assignee":
      return values.includes(issue.assigneeId ?? "");
    case "label":
      return values.some((v) => issue.labelIds.includes(v));
    case "project":
      return values.includes(issue.projectId ?? "");
    case "cycle":
      return values.includes(issue.cycleId ?? "");
    case "creator":
      return values.includes(issue.creatorId ?? "");
    case "dueDate":
      return values.includes(normalizeDueDate(issue.dueDate));
    case "estimate":
      return values.includes(normalizeEstimate(issue.estimate));
    case "team":
      return values.includes(issue.teamId ?? "");
    default:
      return true;
  }
}

function normalizeDueDate(value: string | Date | null | undefined): string {
  if (!value) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString().split("T")[0] ?? "";
  }

  return value.includes("T") ? (value.split("T")[0] ?? value) : value;
}

function formatDueDateLabel(value: string): string {
  if (!value) {
    return "No due date";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

function normalizeEstimate(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (typeof value === "number") {
    return String(value);
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? value : String(parsed);
}

// ─── Filter Type Menu ────────────────────────────────────────────────

const filterTypeLabels: { type: FilterType; label: string }[] = [
  { type: "status", label: "Status" },
  { type: "priority", label: "Priority" },
  { type: "assignee", label: "Assignee" },
  { type: "label", label: "Label" },
  { type: "project", label: "Project" },
  { type: "cycle", label: "Cycle" },
  { type: "creator", label: "Creator" },
  { type: "dueDate", label: "Due date" },
  { type: "estimate", label: "Estimate" },
  { type: "team", label: "Team" },
];

// ─── Component ───────────────────────────────────────────────────────

type MenuState =
  | { step: "closed" }
  | { step: "types" }
  | { step: "values"; filterType: FilterType };

export function FilterBar({
  filters,
  onFiltersChange,
  availableStatuses,
  availableLabels,
  availableAssignees,
  availablePriorities,
  availableProjects = [],
  availableCreators = [],
  availableCycles = [],
  availableEstimates = [],
  availableDueDates = [],
  availableTeams = [],
}: FilterBarProps) {
  const [menu, setMenu] = useState<MenuState>({ step: "closed" });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleFilterButtonClick = useCallback(() => {
    setMenu((prev) =>
      prev.step === "closed" ? { step: "types" } : { step: "closed" },
    );
  }, []);

  const handleSelectFilterType = useCallback((type: FilterType) => {
    setMenu({ step: "values", filterType: type });
  }, []);

  const handleSelectValue = useCallback(
    (filterType: FilterType, valueId: string) => {
      const existing = filters.find((f) => f.type === filterType);
      if (existing) {
        const newValues = existing.values.includes(valueId)
          ? existing.values.filter((v) => v !== valueId)
          : [...existing.values, valueId];
        if (newValues.length === 0) {
          onFiltersChange(filters.filter((f) => f.type !== filterType));
        } else {
          onFiltersChange(
            filters.map((f) =>
              f.type === filterType ? { ...f, values: newValues } : f,
            ),
          );
        }
      } else {
        onFiltersChange([
          ...filters,
          { type: filterType, operator: "is", values: [valueId] },
        ]);
      }
      setMenu({ step: "closed" });
    },
    [filters, onFiltersChange],
  );

  const handleRemoveFilter = useCallback(
    (index: number) => {
      onFiltersChange(filters.filter((_, i) => i !== index));
    },
    [filters, onFiltersChange],
  );

  const handleClearAll = useCallback(() => {
    onFiltersChange([]);
  }, [onFiltersChange]);

  const resolveValueLabel = (type: FilterType, valueId: string): string => {
    switch (type) {
      case "status":
        return availableStatuses.find((s) => s.id === valueId)?.name ?? valueId;
      case "priority":
        return (
          availablePriorities.find((p) => p.value === valueId)?.label ?? valueId
        );
      case "assignee":
        return (
          availableAssignees.find((a) => a.id === valueId)?.name ?? valueId
        );
      case "label":
        return availableLabels.find((l) => l.id === valueId)?.name ?? valueId;
      case "project":
        return availableProjects.find((p) => p.id === valueId)?.name ?? valueId;
      case "cycle":
        return availableCycles.find((c) => c.id === valueId)?.name ?? valueId;
      case "creator":
        return availableCreators.find((c) => c.id === valueId)?.name ?? valueId;
      case "dueDate":
        return (
          availableDueDates.find((d) => d.value === valueId)?.label ??
          formatDueDateLabel(valueId)
        );
      case "estimate":
        return (
          availableEstimates.find((e) => e.value === valueId)?.label ?? valueId
        );
      case "team":
        return availableTeams.find((t) => t.id === valueId)?.name ?? valueId;
      default:
        return valueId;
    }
  };

  const filterTypeLabel = (type: FilterType): string =>
    filterTypeLabels.find((f) => f.type === type)?.label ?? type;

  return (
    <div className="flex items-center gap-1.5" ref={containerRef}>
      {/* Active filter chips */}
      {filters.map((filter, index) => (
        <div
          key={`${filter.type}-${index}`}
          className="flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-active)] px-2 py-0.5 text-[12px] text-[var(--color-text-primary)]"
        >
          <span className="text-[var(--color-text-secondary)]">
            {filterTypeLabel(filter.type)}
          </span>
          <span className="text-[var(--color-text-tertiary)]">
            {filter.operator === "isNot" ? "is not" : "is"}
          </span>
          <span>
            {filter.values
              .map((v) => resolveValueLabel(filter.type, v))
              .join(", ")}
          </span>
          <button
            type="button"
            aria-label="Remove filter"
            onClick={() => handleRemoveFilter(index)}
            className="ml-0.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
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
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}

      {/* Add filter button */}
      <div className="relative">
        <button
          type="button"
          onClick={handleFilterButtonClick}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
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
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          Add filter
        </button>

        {/* Filter type menu */}
        {menu.step === "types" && (
          <div className="absolute left-0 z-50 mt-1 w-[200px] rounded-lg border border-[var(--color-border)] bg-[var(--color-content-bg)] py-1 shadow-xl">
            {filterTypeLabels.map(({ type, label }) => (
              <button
                key={type}
                type="button"
                onClick={() => handleSelectFilterType(type)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
              >
                <FilterTypeIcon type={type} />
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Filter values menu */}
        {menu.step === "values" && (
          <div className="absolute left-0 z-50 mt-1 w-[220px] rounded-lg border border-[var(--color-border)] bg-[var(--color-content-bg)] py-1 shadow-xl">
            <div className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
              {filterTypeLabel(menu.filterType)}
            </div>
            {renderValueOptions(
              menu.filterType,
              filters,
              availableStatuses,
              availableLabels,
              availableAssignees,
              availablePriorities,
              availableProjects,
              availableCreators,
              availableCycles,
              availableEstimates,
              availableDueDates,
              availableTeams,
              handleSelectValue,
            )}
          </div>
        )}
      </div>

      {/* Clear all */}
      {filters.length > 0 && (
        <button
          type="button"
          onClick={handleClearAll}
          className="ml-1 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Clear
        </button>
      )}
    </div>
  );
}

// ─── Filter Type Icons ───────────────────────────────────────────────

function FilterTypeIcon({ type }: { type: FilterType }) {
  const className = "text-[var(--color-text-secondary)]";
  const svgProps = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true as const,
  };

  switch (type) {
    case "status":
      return (
        <svg {...svgProps}>
          <title>Status icon</title>
          <circle cx="12" cy="12" r="10" />
        </svg>
      );
    case "priority":
      return (
        <svg {...svgProps}>
          <title>Priority icon</title>
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" x2="4" y1="22" y2="15" />
        </svg>
      );
    case "assignee":
    case "creator":
      return (
        <svg {...svgProps}>
          <title>{type === "creator" ? "Creator icon" : "Assignee icon"}</title>
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      );
    case "label":
      return (
        <svg {...svgProps}>
          <title>Label icon</title>
          <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
          <path d="M7 7h.01" />
        </svg>
      );
    case "project":
      return (
        <svg {...svgProps}>
          <title>Project icon</title>
          <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
        </svg>
      );
    case "cycle":
      return (
        <svg {...svgProps}>
          <title>Cycle icon</title>
          <path d="M21 12a9 9 0 1 1-3.29-6.94" />
          <path d="M21 3v6h-6" />
        </svg>
      );
    case "dueDate":
      return (
        <svg {...svgProps}>
          <title>Due date icon</title>
          <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
          <line x1="16" x2="16" y1="2" y2="6" />
          <line x1="8" x2="8" y1="2" y2="6" />
          <line x1="3" x2="21" y1="10" y2="10" />
        </svg>
      );
    case "team":
      return (
        <svg {...svgProps}>
          <title>Team icon</title>
          <rect x="3" y="4" width="7" height="7" rx="1" />
          <rect x="14" y="4" width="7" height="7" rx="1" />
          <rect x="3" y="15" width="7" height="7" rx="1" />
          <rect x="14" y="15" width="7" height="7" rx="1" />
        </svg>
      );
    case "estimate":
      return (
        <svg {...svgProps}>
          <title>Estimate icon</title>
          <path d="M4 19h16" />
          <path d="M7 15h2" />
          <path d="M11 11h2" />
          <path d="M15 7h2" />
        </svg>
      );
    default:
      return null;
  }
}

// ─── Value Options Renderer ──────────────────────────────────────────

function renderValueOptions(
  filterType: FilterType,
  currentFilters: FilterCondition[],
  statuses: StatusOption[],
  labels: LabelOption[],
  assignees: AssigneeOption[],
  priorities: PriorityOption[],
  projects: ProjectOption[],
  creators: CreatorOption[],
  cycles: CycleOption[],
  estimates: EstimateOption[],
  dueDates: DueDateOption[],
  teams: TeamOption[],
  onSelect: (type: FilterType, value: string) => void,
) {
  const activeFilter = currentFilters.find((f) => f.type === filterType);
  const activeValues = activeFilter?.values ?? [];

  switch (filterType) {
    case "status":
      return statuses.map((s) => (
        <ValueOption
          key={s.id}
          label={s.name}
          selected={activeValues.includes(s.id)}
          onClick={() => onSelect(filterType, s.id)}
          icon={
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: s.color }}
            />
          }
        />
      ));
    case "priority":
      return priorities.map((p) => (
        <ValueOption
          key={p.value}
          label={p.label}
          selected={activeValues.includes(p.value)}
          onClick={() => onSelect(filterType, p.value)}
        />
      ));
    case "assignee":
      return assignees.map((a) => (
        <ValueOption
          key={a.id}
          label={a.name}
          selected={activeValues.includes(a.id)}
          onClick={() => onSelect(filterType, a.id)}
          icon={
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-surface-active)] text-[9px] font-medium text-[var(--color-text-primary)]">
              {a.name.charAt(0).toUpperCase()}
            </span>
          }
        />
      ));
    case "label":
      return labels.map((l) => (
        <ValueOption
          key={l.id}
          label={l.name}
          selected={activeValues.includes(l.id)}
          onClick={() => onSelect(filterType, l.id)}
          icon={
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: l.color }}
            />
          }
        />
      ));
    case "project":
      return renderSelectOptions(projects, activeValues, filterType, onSelect);
    case "cycle":
      return renderSelectOptions(cycles, activeValues, filterType, onSelect);
    case "creator":
      return renderSelectOptions(creators, activeValues, filterType, onSelect);
    case "estimate":
      return renderSelectOptions(
        estimates.map((estimate) => ({
          id: estimate.value,
          name: estimate.label,
        })),
        activeValues,
        filterType,
        onSelect,
      );
    case "team":
      return renderSelectOptions(teams, activeValues, filterType, onSelect);
    case "dueDate":
      return renderSelectOptions(
        dueDates.map((dueDate) => ({
          id: dueDate.value,
          name: dueDate.label,
        })),
        activeValues,
        filterType,
        onSelect,
      );
    default:
      return <EmptyValueOptions />;
  }
}

function renderSelectOptions(
  options: { id: string; name: string }[],
  activeValues: string[],
  filterType: FilterType,
  onSelect: (type: FilterType, value: string) => void,
) {
  if (options.length === 0) {
    return <EmptyValueOptions />;
  }

  return options.map((option) => (
    <ValueOption
      key={option.id}
      label={option.name}
      selected={activeValues.includes(option.id)}
      onClick={() => onSelect(filterType, option.id)}
    />
  ));
}

function EmptyValueOptions() {
  return (
    <div className="px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">
      No options available
    </div>
  );
}

function ValueOption({
  label,
  selected,
  onClick,
  icon,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <span
        className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border ${
          selected
            ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
            : "border-[var(--color-border)]"
        }`}
      >
        {selected && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
      {icon}
      <span className="text-[var(--color-text-primary)]">{label}</span>
    </button>
  );
}
