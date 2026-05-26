export const PROJECT_UPDATE_CADENCES = [
  "weekly",
  "biweekly",
  "monthly",
] as const;
export const PROJECT_UPDATE_DUE_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
] as const;
export const PROJECT_UPDATE_SCOPES = [
  "all_projects",
  "active_projects",
  "selected_projects",
] as const;
export const PROJECT_UPDATE_REPORTING_TARGETS = [
  "workspace",
  "slack",
  "email",
] as const;

export type ProjectUpdateCadence = (typeof PROJECT_UPDATE_CADENCES)[number];
export type ProjectUpdateDueDay = (typeof PROJECT_UPDATE_DUE_DAYS)[number];
export type ProjectUpdateScope = (typeof PROJECT_UPDATE_SCOPES)[number];
export type ProjectUpdateReportingTarget =
  (typeof PROJECT_UPDATE_REPORTING_TARGETS)[number];

export type ProjectUpdateConfiguration = {
  id: string;
  name: string;
  enabled: boolean;
  cadence: ProjectUpdateCadence;
  dueDay: ProjectUpdateDueDay;
  dueTime: string;
  timezone: string;
  scope: ProjectUpdateScope;
  projectIds: string[];
  reportingTarget: ProjectUpdateReportingTarget;
  shareTarget: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectUpdateInput = Partial<
  Pick<
    ProjectUpdateConfiguration,
    | "name"
    | "enabled"
    | "cadence"
    | "dueDay"
    | "dueTime"
    | "timezone"
    | "scope"
    | "projectIds"
    | "reportingTarget"
    | "shareTarget"
  >
>;

const DEFAULT_TIMEZONE = "UTC";
const PROJECT_UPDATE_SETTINGS_KEY = "projectUpdateConfigurations";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function isDueTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isTimezone(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 80 &&
    /^[A-Za-z0-9_+\-/]+$/.test(value)
  );
}

function normalizeProjectIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeStoredConfiguration(
  value: unknown,
): ProjectUpdateConfiguration | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
    return null;
  }

  const now = new Date().toISOString();
  const name = typeof value.name === "string" ? value.name.trim() : "";

  return {
    id: value.id,
    name: name || "Project update reminder",
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    cadence: isOneOf(PROJECT_UPDATE_CADENCES, value.cadence)
      ? value.cadence
      : "weekly",
    dueDay: isOneOf(PROJECT_UPDATE_DUE_DAYS, value.dueDay)
      ? value.dueDay
      : "friday",
    dueTime: isDueTime(value.dueTime) ? value.dueTime : "09:00",
    timezone: isTimezone(value.timezone) ? value.timezone : DEFAULT_TIMEZONE,
    scope: isOneOf(PROJECT_UPDATE_SCOPES, value.scope)
      ? value.scope
      : "active_projects",
    projectIds: normalizeProjectIds(value.projectIds),
    reportingTarget: isOneOf(
      PROJECT_UPDATE_REPORTING_TARGETS,
      value.reportingTarget,
    )
      ? value.reportingTarget
      : "workspace",
    shareTarget: typeof value.shareTarget === "string" ? value.shareTarget : "",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
  };
}

export function readProjectUpdateConfigurations(
  settings: unknown,
): ProjectUpdateConfiguration[] {
  if (!isRecord(settings)) {
    return [];
  }

  const rawConfigurations = settings[PROJECT_UPDATE_SETTINGS_KEY];
  if (!Array.isArray(rawConfigurations)) {
    return [];
  }

  return rawConfigurations
    .map(normalizeStoredConfiguration)
    .filter((configuration): configuration is ProjectUpdateConfiguration =>
      Boolean(configuration),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function writeProjectUpdateConfigurations(
  settings: unknown,
  configurations: ProjectUpdateConfiguration[],
) {
  return {
    ...(isRecord(settings) ? settings : {}),
    [PROJECT_UPDATE_SETTINGS_KEY]: configurations,
  };
}

export function validateProjectUpdateInput(
  input: unknown,
  options: { partial?: boolean } = {},
):
  | { ok: true; value: ProjectUpdateInput }
  | { ok: false; error: string; field?: string } {
  if (!isRecord(input)) {
    return { ok: false, error: "Request body must be an object" };
  }

  const value: ProjectUpdateInput = {};
  const partial = Boolean(options.partial);

  if (input.name !== undefined || !partial) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) {
      return { ok: false, error: "Name is required", field: "name" };
    }
    if (name.length > 120) {
      return {
        ok: false,
        error: "Name must be 120 characters or fewer",
        field: "name",
      };
    }
    value.name = name;
  }

  if (input.enabled !== undefined || !partial) {
    value.enabled = typeof input.enabled === "boolean" ? input.enabled : true;
  }

  if (input.cadence !== undefined || !partial) {
    if (!isOneOf(PROJECT_UPDATE_CADENCES, input.cadence)) {
      return { ok: false, error: "Cadence is invalid", field: "cadence" };
    }
    value.cadence = input.cadence;
  }

  if (input.dueDay !== undefined || !partial) {
    if (!isOneOf(PROJECT_UPDATE_DUE_DAYS, input.dueDay)) {
      return { ok: false, error: "Due day is invalid", field: "dueDay" };
    }
    value.dueDay = input.dueDay;
  }

  if (input.dueTime !== undefined || !partial) {
    if (!isDueTime(input.dueTime)) {
      return {
        ok: false,
        error: "Due time must use 24-hour HH:MM format",
        field: "dueTime",
      };
    }
    value.dueTime = input.dueTime;
  }

  if (input.timezone !== undefined || !partial) {
    if (!isTimezone(input.timezone)) {
      return { ok: false, error: "Timezone is invalid", field: "timezone" };
    }
    value.timezone = input.timezone;
  }

  if (input.scope !== undefined || !partial) {
    if (!isOneOf(PROJECT_UPDATE_SCOPES, input.scope)) {
      return { ok: false, error: "Scope is invalid", field: "scope" };
    }
    value.scope = input.scope;
  }

  if (input.projectIds !== undefined) {
    value.projectIds = normalizeProjectIds(input.projectIds);
  } else if (!partial) {
    value.projectIds = [];
  }

  if (input.reportingTarget !== undefined || !partial) {
    if (!isOneOf(PROJECT_UPDATE_REPORTING_TARGETS, input.reportingTarget)) {
      return {
        ok: false,
        error: "Reporting target is invalid",
        field: "reportingTarget",
      };
    }
    value.reportingTarget = input.reportingTarget;
  }

  if (input.shareTarget !== undefined || !partial) {
    const shareTarget =
      typeof input.shareTarget === "string" ? input.shareTarget.trim() : "";
    if (shareTarget.length > 160) {
      return {
        ok: false,
        error: "Share target must be 160 characters or fewer",
        field: "shareTarget",
      };
    }
    value.shareTarget = shareTarget;
  }

  return { ok: true, value };
}

export function buildProjectUpdateConfiguration(
  input: ProjectUpdateInput,
  now = new Date(),
): ProjectUpdateConfiguration {
  const timestamp = now.toISOString();

  return {
    id: crypto.randomUUID(),
    name: input.name ?? "Project update reminder",
    enabled: input.enabled ?? true,
    cadence: input.cadence ?? "weekly",
    dueDay: input.dueDay ?? "friday",
    dueTime: input.dueTime ?? "09:00",
    timezone: input.timezone ?? DEFAULT_TIMEZONE,
    scope: input.scope ?? "active_projects",
    projectIds: input.projectIds ?? [],
    reportingTarget: input.reportingTarget ?? "workspace",
    shareTarget: input.shareTarget ?? "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function updateProjectUpdateConfiguration(
  current: ProjectUpdateConfiguration,
  input: ProjectUpdateInput,
  now = new Date(),
): ProjectUpdateConfiguration {
  return {
    ...current,
    ...input,
    updatedAt: now.toISOString(),
  };
}
