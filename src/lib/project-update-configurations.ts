export const PROJECT_UPDATE_CADENCES = [
  "weekly",
  "biweekly",
  "monthly",
] as const;
export const PROJECT_UPDATE_PROJECT_SCOPES = [
  "all",
  "active",
  "statuses",
] as const;
export const PROJECT_UPDATE_SHARE_TARGETS = [
  "workspace",
  "slack",
  "email",
] as const;
export const PROJECT_UPDATE_STATUS_SCOPES = [
  "planned",
  "started",
  "paused",
  "completed",
  "canceled",
] as const;

export type ProjectUpdateCadence = (typeof PROJECT_UPDATE_CADENCES)[number];
export type ProjectUpdateProjectScope =
  (typeof PROJECT_UPDATE_PROJECT_SCOPES)[number];
export type ProjectUpdateShareTarget =
  (typeof PROJECT_UPDATE_SHARE_TARGETS)[number];
export type ProjectUpdateStatusScope =
  (typeof PROJECT_UPDATE_STATUS_SCOPES)[number];

export type ProjectUpdateConfiguration = {
  id: string;
  name: string;
  enabled: boolean;
  cadence: ProjectUpdateCadence;
  dayOfWeek: number;
  timeOfDay: string;
  timezone: string;
  projectScope: ProjectUpdateProjectScope;
  statusScope: ProjectUpdateStatusScope[];
  shareTargets: ProjectUpdateShareTarget[];
  slackChannel: string | null;
  createdAt: string;
  updatedAt: string;
};

type ValidationResult =
  | {
      ok: true;
      configuration: Omit<
        ProjectUpdateConfiguration,
        "createdAt" | "updatedAt"
      >;
    }
  | { ok: false; error: string };

const DEFAULT_TIMEZONE = "UTC";
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function uniqueAllowed<T extends string>(
  value: unknown,
  allowed: readonly T[],
) {
  const allowedSet = new Set<string>(allowed);
  return Array.from(
    new Set(stringArray(value).filter((item) => allowedSet.has(item))),
  ) as T[];
}

function isCadence(value: unknown): value is ProjectUpdateCadence {
  return PROJECT_UPDATE_CADENCES.includes(value as ProjectUpdateCadence);
}

function isProjectScope(value: unknown): value is ProjectUpdateProjectScope {
  return PROJECT_UPDATE_PROJECT_SCOPES.includes(
    value as ProjectUpdateProjectScope,
  );
}

export function readProjectUpdateConfigurations(
  settings: unknown,
): ProjectUpdateConfiguration[] {
  if (
    !isRecord(settings) ||
    !Array.isArray(settings.projectUpdateConfigurations)
  ) {
    return [];
  }

  return settings.projectUpdateConfigurations.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string") {
      return [];
    }

    const validation = validateProjectUpdateConfigurationInput(item, item.id);
    if (!validation.ok) {
      return [];
    }

    return [
      {
        ...validation.configuration,
        createdAt:
          typeof item.createdAt === "string"
            ? item.createdAt
            : new Date().toISOString(),
        updatedAt:
          typeof item.updatedAt === "string"
            ? item.updatedAt
            : new Date().toISOString(),
      },
    ];
  });
}

export function writeProjectUpdateConfigurations(
  settings: unknown,
  configurations: ProjectUpdateConfiguration[],
) {
  return {
    ...(isRecord(settings) ? settings : {}),
    projectUpdateConfigurations: configurations,
  };
}

export function validateProjectUpdateConfigurationInput(
  input: unknown,
  existingId?: string,
): ValidationResult {
  if (!isRecord(input)) {
    return { ok: false, error: "Configuration is required" };
  }

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) {
    return { ok: false, error: "Configuration name is required" };
  }

  if (!isCadence(input.cadence)) {
    return { ok: false, error: "Choose a valid reminder cadence" };
  }

  const dayOfWeek = Number(input.dayOfWeek);
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
    return { ok: false, error: "Choose a valid reminder day" };
  }

  const timeOfDay = typeof input.timeOfDay === "string" ? input.timeOfDay : "";
  if (!TIME_PATTERN.test(timeOfDay)) {
    return { ok: false, error: "Use a valid reminder time" };
  }

  const timezone =
    typeof input.timezone === "string" && input.timezone.trim()
      ? input.timezone.trim()
      : DEFAULT_TIMEZONE;

  if (!isProjectScope(input.projectScope)) {
    return { ok: false, error: "Choose a valid project scope" };
  }

  const statusScope = uniqueAllowed(
    input.statusScope,
    PROJECT_UPDATE_STATUS_SCOPES,
  );
  if (input.projectScope === "statuses" && statusScope.length === 0) {
    return {
      ok: false,
      error: "Select at least one project status for this scope",
    };
  }

  const shareTargets = uniqueAllowed(
    input.shareTargets,
    PROJECT_UPDATE_SHARE_TARGETS,
  );
  if (shareTargets.length === 0) {
    return { ok: false, error: "Select at least one reporting target" };
  }

  const slackChannel =
    typeof input.slackChannel === "string" && input.slackChannel.trim()
      ? input.slackChannel.trim()
      : null;
  if (shareTargets.includes("slack") && !slackChannel) {
    return { ok: false, error: "Slack channel is required for Slack reports" };
  }

  return {
    ok: true,
    configuration: {
      id: existingId ?? crypto.randomUUID(),
      name,
      enabled: typeof input.enabled === "boolean" ? input.enabled : true,
      cadence: input.cadence,
      dayOfWeek,
      timeOfDay,
      timezone,
      projectScope: input.projectScope,
      statusScope,
      shareTargets,
      slackChannel,
    },
  };
}
