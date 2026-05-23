"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface DisplayProperties {
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

export type GroupByOption =
  | "status"
  | "priority"
  | "assignee"
  | "label"
  | "project"
  | "none";
export type OrderByOption = "priority" | "created" | "updated" | "manual";

export interface DisplayOptionsPanelProps {
  open: boolean;
  onClose: () => void;
  layout: "list" | "board";
  onLayoutChange: (layout: "list" | "board") => void;
  groupBy: GroupByOption;
  onGroupByChange: (groupBy: GroupByOption) => void;
  subGroupBy: GroupByOption;
  onSubGroupByChange: (subGroupBy: GroupByOption) => void;
  orderBy: OrderByOption;
  onOrderByChange: (orderBy: OrderByOption) => void;
  displayProperties: DisplayProperties;
  onDisplayPropertyToggle: (key: keyof DisplayProperties) => void;
  showSubIssues: boolean;
  onShowSubIssuesToggle: () => void;
  showTriageIssues: boolean;
  onShowTriageIssuesToggle: () => void;
  showEmptyColumns: boolean;
  onShowEmptyColumnsToggle: () => void;
  onReset?: () => void;
  onSaveAsDefault?: () => void;
}

export const defaultDisplayProperties: DisplayProperties = {
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

const propertyLabels: { key: keyof DisplayProperties; label: string }[] = [
  { key: "id", label: "ID" },
  { key: "status", label: "Status" },
  { key: "assignee", label: "Assignee" },
  { key: "priority", label: "Priority" },
  { key: "project", label: "Project" },
  { key: "dueDate", label: "Due date" },
  { key: "milestone", label: "Milestone" },
  { key: "labels", label: "Labels" },
  { key: "links", label: "Links" },
  { key: "timeInStatus", label: "Time in status" },
  { key: "created", label: "Created" },
  { key: "updated", label: "Updated" },
  { key: "pullRequests", label: "Pull requests" },
];

const groupByLabels: Record<GroupByOption, string> = {
  status: "Status",
  priority: "Priority",
  assignee: "Assignee",
  label: "Label",
  project: "Project",
  none: "No grouping",
};

const orderByLabels: Record<OrderByOption, string> = {
  priority: "Priority",
  created: "Created",
  updated: "Updated",
  manual: "Manual",
};

function ToggleSwitch({
  checked,
  onToggle,
  testId,
}: {
  checked: boolean;
  onToggle: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid={testId}
      className={`relative h-4 w-7 rounded-full transition-colors ${
        checked ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
      }`}
      role="switch"
      aria-checked={checked}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
          checked ? "translate-x-3" : ""
        }`}
      />
    </button>
  );
}

function OptionRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[13px] text-[var(--color-text-primary)]">
        {label}
      </span>
      {children}
    </div>
  );
}

function InlineSelect<T extends string>({
  value,
  options,
  labels,
  onChange,
  isOpen,
  onToggle,
  testId,
}: {
  value: T;
  options: T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
  isOpen: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        data-testid={testId}
        onClick={onToggle}
        aria-expanded={isOpen}
        className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
      >
        {labels[value]}
      </button>
      {isOpen && (
        <div
          data-testid={`${testId}-menu`}
          className="absolute right-0 z-50 mt-1 min-w-[140px] rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] py-1 shadow-lg"
        >
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={`flex w-full px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-[var(--color-surface-hover)] ${
                opt === value
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--color-text-primary)]"
              }`}
            >
              {labels[opt]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DisplayOptionsPanel({
  open,
  onClose,
  layout,
  onLayoutChange,
  groupBy,
  onGroupByChange,
  subGroupBy,
  onSubGroupByChange,
  orderBy,
  onOrderByChange,
  displayProperties,
  onDisplayPropertyToggle,
  showSubIssues,
  onShowSubIssuesToggle,
  showTriageIssues,
  onShowTriageIssuesToggle,
  showEmptyColumns,
  onShowEmptyColumnsToggle,
  onReset,
  onSaveAsDefault,
}: DisplayOptionsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [openSelect, setOpenSelect] = useState<
    "grouping" | "subgroup" | "ordering" | null
  >(null);

  useEffect(() => {
    if (!open) {
      setOpenSelect(null);
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (
        panelRef.current &&
        event.target instanceof Node &&
        !panelRef.current.contains(event.target)
      ) {
        setOpenSelect(null);
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenSelect(null);
        onClose();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  function handleSelectChange<T extends string>(onChange: (value: T) => void) {
    return (value: T) => {
      onChange(value);
      setOpenSelect(null);
    };
  }

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className="absolute top-8 right-0 z-40 w-[320px] rounded-lg border border-[var(--color-border)] bg-[var(--color-content-bg)] shadow-xl"
    >
      <div className="p-3">
        {/* Layout toggle */}
        <div className="mb-3 flex rounded-md border border-[var(--color-border)]">
          <button
            type="button"
            onClick={() => onLayoutChange("list")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-l-md py-1.5 text-[12px] transition-colors ${
              layout === "list"
                ? "bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
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
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
            List
          </button>
          <button
            type="button"
            onClick={() => onLayoutChange("board")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-r-md py-1.5 text-[12px] transition-colors ${
              layout === "board"
                ? "bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
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
              <rect width="6" height="14" x="4" y="5" rx="1" />
              <rect width="6" height="10" x="14" y="7" rx="1" />
            </svg>
            Board
          </button>
        </div>

        {/* Grouping */}
        <OptionRow label="Grouping">
          <InlineSelect
            value={groupBy}
            options={[
              "status",
              "priority",
              "assignee",
              "label",
              "project",
              "none",
            ]}
            labels={groupByLabels}
            onChange={handleSelectChange(onGroupByChange)}
            isOpen={openSelect === "grouping"}
            onToggle={() =>
              setOpenSelect((current) =>
                current === "grouping" ? null : "grouping",
              )
            }
            testId="grouping-select"
          />
        </OptionRow>

        {/* Sub-group */}
        <OptionRow label="Sub-group">
          <InlineSelect
            value={subGroupBy}
            options={["none", "status", "priority", "assignee"]}
            labels={groupByLabels}
            onChange={handleSelectChange(onSubGroupByChange)}
            isOpen={openSelect === "subgroup"}
            onToggle={() =>
              setOpenSelect((current) =>
                current === "subgroup" ? null : "subgroup",
              )
            }
            testId="subgroup-select"
          />
        </OptionRow>

        {/* Ordering */}
        <OptionRow label="Ordering">
          <InlineSelect
            value={orderBy}
            options={["priority", "created", "updated", "manual"]}
            labels={orderByLabels}
            onChange={handleSelectChange(onOrderByChange)}
            isOpen={openSelect === "ordering"}
            onToggle={() =>
              setOpenSelect((current) =>
                current === "ordering" ? null : "ordering",
              )
            }
            testId="ordering-select"
          />
        </OptionRow>

        <div className="my-2 border-t border-[var(--color-border)]" />

        {/* Toggles */}
        <OptionRow label="Show sub-issues">
          <ToggleSwitch
            checked={showSubIssues}
            onToggle={onShowSubIssuesToggle}
          />
        </OptionRow>

        <OptionRow label="Show triage issues">
          <ToggleSwitch
            checked={showTriageIssues}
            onToggle={onShowTriageIssuesToggle}
          />
        </OptionRow>

        <div className="my-2 border-t border-[var(--color-border)]" />

        {/* Board options */}
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
          Board options
        </p>
        <OptionRow label="Show empty columns">
          <ToggleSwitch
            checked={showEmptyColumns}
            onToggle={onShowEmptyColumnsToggle}
          />
        </OptionRow>

        <div className="my-2 border-t border-[var(--color-border)]" />

        {/* Display properties */}
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
          Display properties
        </p>
        <div className="flex flex-wrap gap-1">
          {propertyLabels.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              data-testid={`property-${key}`}
              onClick={() => onDisplayPropertyToggle(key)}
              className={`rounded-md border px-2 py-0.5 text-[12px] transition-colors ${
                displayProperties[key]
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)] bg-opacity-10 text-[var(--color-text-primary)]"
                  : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-[var(--color-border)] px-3 py-2">
        <button
          type="button"
          onClick={onReset}
          className="text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={onSaveAsDefault}
          className="text-[12px] text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
        >
          Set default for everyone
        </button>
      </div>
    </div>
  );
}
