export const PROJECT_TEMPLATE_STATUSES = [
  "planned",
  "started",
  "paused",
  "completed",
  "canceled",
] as const;

export const PROJECT_TEMPLATE_PRIORITIES = [
  "none",
  "urgent",
  "high",
  "medium",
  "low",
] as const;

export type ProjectTemplateStatus = (typeof PROJECT_TEMPLATE_STATUSES)[number];
export type ProjectTemplatePriority =
  (typeof PROJECT_TEMPLATE_PRIORITIES)[number];

export type ProjectTemplateSettings = {
  status: ProjectTemplateStatus | null;
  priority: ProjectTemplatePriority | null;
  labelIds: string[];
  milestones: string[];
};

export const emptyProjectTemplateSettings: ProjectTemplateSettings = {
  status: null,
  priority: null,
  labelIds: [],
  milestones: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeStatus(value: unknown): ProjectTemplateStatus | null {
  return typeof value === "string" &&
    PROJECT_TEMPLATE_STATUSES.includes(value as ProjectTemplateStatus)
    ? (value as ProjectTemplateStatus)
    : null;
}

function normalizePriority(value: unknown): ProjectTemplatePriority | null {
  return typeof value === "string" &&
    PROJECT_TEMPLATE_PRIORITIES.includes(value as ProjectTemplatePriority)
    ? (value as ProjectTemplatePriority)
    : null;
}

export function readProjectTemplateSettings(
  settings: unknown,
): ProjectTemplateSettings {
  if (!isRecord(settings)) return emptyProjectTemplateSettings;

  return {
    status: normalizeStatus(settings.status),
    priority: normalizePriority(settings.priority),
    labelIds: normalizeStringList(settings.labelIds),
    milestones: normalizeStringList(settings.milestones),
  };
}

export function buildProjectTemplateSettings(input: {
  status?: unknown;
  priority?: unknown;
  labelIds?: unknown;
  milestones?: unknown;
}): ProjectTemplateSettings {
  return readProjectTemplateSettings(input);
}
