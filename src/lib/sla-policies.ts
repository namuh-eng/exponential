export type SlaPolicyCondition = {
  priority?: "urgent" | "high" | "medium" | "low";
  teamKey?: string;
};

export type SlaPolicy = {
  id: string;
  name: string;
  description: string | null;
  responseTimeHours: number;
  resolutionTimeHours: number;
  enabled: boolean;
  conditions: SlaPolicyCondition;
  createdAt: string;
  updatedAt: string;
};

export type SlaSettingsState = {
  policies: SlaPolicy[];
};

const PRIORITIES = new Set(["urgent", "high", "medium", "low"]);

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizePositiveHours(value: unknown, fallback: number) {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.round(numberValue * 100) / 100
    : fallback;
}

function normalizeConditions(value: unknown): SlaPolicyCondition {
  const record = asRecord(value);
  const conditions: SlaPolicyCondition = {};
  if (typeof record.priority === "string" && PRIORITIES.has(record.priority)) {
    conditions.priority = record.priority as SlaPolicyCondition["priority"];
  }
  if (typeof record.teamKey === "string" && record.teamKey.trim()) {
    conditions.teamKey = record.teamKey.trim().toUpperCase().slice(0, 12);
  }
  return conditions;
}

export function readSlaSettings(settings: unknown): SlaSettingsState {
  const sla = asRecord(asRecord(settings).sla);
  const policies = Array.isArray(sla.policies) ? sla.policies : [];

  return {
    policies: policies
      .map((policy): SlaPolicy | null => {
        const record = asRecord(policy);
        if (typeof record.id !== "string" || typeof record.name !== "string") {
          return null;
        }
        return {
          id: record.id,
          name: record.name,
          description:
            typeof record.description === "string" && record.description.trim()
              ? record.description.trim()
              : null,
          responseTimeHours: normalizePositiveHours(
            record.responseTimeHours,
            4,
          ),
          resolutionTimeHours: normalizePositiveHours(
            record.resolutionTimeHours,
            24,
          ),
          enabled: record.enabled !== false,
          conditions: normalizeConditions(record.conditions),
          createdAt:
            typeof record.createdAt === "string"
              ? record.createdAt
              : new Date(0).toISOString(),
          updatedAt:
            typeof record.updatedAt === "string"
              ? record.updatedAt
              : new Date(0).toISOString(),
        };
      })
      .filter((policy): policy is SlaPolicy => Boolean(policy)),
  };
}

export function serializeSlaSettings(
  settings: unknown,
  slaSettings: SlaSettingsState,
) {
  return {
    ...asRecord(settings),
    sla: {
      ...asRecord(asRecord(settings).sla),
      policies: slaSettings.policies,
    },
  };
}

export type SlaPolicyInput = {
  name?: unknown;
  description?: unknown;
  responseTimeHours?: unknown;
  resolutionTimeHours?: unknown;
  enabled?: unknown;
  conditions?: unknown;
};

export function normalizeSlaPolicyInput(input: SlaPolicyInput) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) {
    return { error: "Name is required" } as const;
  }
  const responseTimeHours = normalizePositiveHours(input.responseTimeHours, 4);
  const resolutionTimeHours = normalizePositiveHours(
    input.resolutionTimeHours,
    24,
  );
  if (responseTimeHours > resolutionTimeHours) {
    return {
      error: "Response target must be less than or equal to resolution target",
    } as const;
  }
  return {
    value: {
      name: name.slice(0, 80),
      description:
        typeof input.description === "string" && input.description.trim()
          ? input.description.trim().slice(0, 240)
          : null,
      responseTimeHours,
      resolutionTimeHours,
      enabled: input.enabled !== false,
      conditions: normalizeConditions(input.conditions),
    },
  } as const;
}
