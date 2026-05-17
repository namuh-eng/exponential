export type ProjectStatusKey =
  | "planned"
  | "started"
  | "paused"
  | "completed"
  | "canceled";

export type ProjectStatusConfig = {
  id: string;
  key: ProjectStatusKey | string;
  name: string;
  description: string;
  color: string;
  icon: string;
  position: number;
  isDefault: boolean;
};

export const DEFAULT_PROJECT_STATUSES: ProjectStatusConfig[] = [
  {
    id: "planned",
    key: "planned",
    name: "Planned",
    description: "Projects that are proposed or scheduled but not active yet.",
    color: "#6b6f76",
    icon: "○",
    position: 0,
    isDefault: true,
  },
  {
    id: "started",
    key: "started",
    name: "In progress",
    description: "Projects that are actively being worked on.",
    color: "#b58900",
    icon: "◐",
    position: 1,
    isDefault: true,
  },
  {
    id: "paused",
    key: "paused",
    name: "Paused",
    description: "Projects that are temporarily on hold.",
    color: "#6b6f76",
    icon: "Ⅱ",
    position: 2,
    isDefault: true,
  },
  {
    id: "completed",
    key: "completed",
    name: "Completed",
    description: "Projects that have reached their intended outcome.",
    color: "#2e7d32",
    icon: "✓",
    position: 3,
    isDefault: true,
  },
  {
    id: "canceled",
    key: "canceled",
    name: "Canceled",
    description: "Projects that are no longer planned to continue.",
    color: "#6b6f76",
    icon: "×",
    position: 4,
    isDefault: true,
  },
];

const DEFAULT_KEYS = new Set(
  DEFAULT_PROJECT_STATUSES.map((status) => status.key),
);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_STATUSES = 30;

export type ProjectStatusValidationResult =
  | { ok: true; statuses: ProjectStatusConfig[] }
  | { ok: false; error: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function slugifyKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export function readProjectStatusSettings(settings: unknown) {
  const projectStatuses = asRecord(settings).projectStatuses;
  const statuses = Array.isArray(projectStatuses)
    ? projectStatuses
        .map((status, index): ProjectStatusConfig | null => {
          const record = asRecord(status);
          const id = typeof record.id === "string" ? record.id.trim() : "";
          const key = typeof record.key === "string" ? record.key.trim() : id;
          const name =
            typeof record.name === "string" ? record.name.trim() : "";
          const description =
            typeof record.description === "string"
              ? record.description.trim()
              : "";
          const color =
            typeof record.color === "string" && HEX_COLOR.test(record.color)
              ? record.color
              : "#6b6f76";
          const icon =
            typeof record.icon === "string"
              ? record.icon.trim().slice(0, 4)
              : "";
          const position = Number.isFinite(Number(record.position))
            ? Number(record.position)
            : index;
          const isDefault = DEFAULT_KEYS.has(key);

          if (!id || !key || !name) {
            return null;
          }

          return {
            id,
            key,
            name,
            description,
            color,
            icon: icon || "•",
            position,
            isDefault,
          };
        })
        .filter((status): status is ProjectStatusConfig => Boolean(status))
    : [];

  const byKey = new Map<string, ProjectStatusConfig>();
  for (const status of DEFAULT_PROJECT_STATUSES) {
    byKey.set(status.key, { ...status });
  }
  for (const status of statuses) {
    byKey.set(status.key, status);
  }

  return Array.from(byKey.values())
    .sort((a, b) => a.position - b.position)
    .map((status, position) => ({ ...status, position }));
}

export function validateProjectStatusesInput(
  value: unknown,
  projectCountsByKey: Map<string, number> = new Map(),
): ProjectStatusValidationResult {
  if (!Array.isArray(value)) {
    return { ok: false, error: "Statuses must be an array." };
  }

  if (value.length < DEFAULT_PROJECT_STATUSES.length) {
    return { ok: false, error: "Default project statuses cannot be removed." };
  }

  if (value.length > MAX_STATUSES) {
    return {
      ok: false,
      error: `Project statuses are limited to ${MAX_STATUSES}.`,
    };
  }

  const statuses: ProjectStatusConfig[] = [];
  const seenKeys = new Set<string>();

  for (const [index, rawStatus] of value.entries()) {
    const record = asRecord(rawStatus);
    const rawId = typeof record.id === "string" ? record.id.trim() : "";
    const rawKey = typeof record.key === "string" ? record.key.trim() : rawId;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const description =
      typeof record.description === "string" ? record.description.trim() : "";
    const color = typeof record.color === "string" ? record.color.trim() : "";
    const icon = typeof record.icon === "string" ? record.icon.trim() : "";
    const isDefault = DEFAULT_KEYS.has(rawKey);
    const fallbackKey = name ? slugifyKey(name) : "";
    const key = isDefault ? rawKey : slugifyKey(rawKey || fallbackKey);
    const id = isDefault ? rawKey : slugifyKey(rawId || key || fallbackKey);

    if (!name) {
      return { ok: false, error: "Status name is required." };
    }
    if (name.length > 60) {
      return {
        ok: false,
        error: "Status names must be 60 characters or fewer.",
      };
    }
    if (description.length > 180) {
      return {
        ok: false,
        error: "Status descriptions must be 180 characters or fewer.",
      };
    }
    if (!HEX_COLOR.test(color)) {
      return { ok: false, error: "Status color must be a hex color." };
    }
    if (!icon || icon.length > 4) {
      return { ok: false, error: "Status icon is required and must be short." };
    }
    if (!id || !key) {
      return { ok: false, error: "Status key is required." };
    }
    if (seenKeys.has(key)) {
      return { ok: false, error: "Status names and keys must be unique." };
    }

    seenKeys.add(key);
    statuses.push({
      id,
      key,
      name,
      description,
      color,
      icon: icon.slice(0, 4),
      position: index,
      isDefault,
    });
  }

  for (const defaultStatus of DEFAULT_PROJECT_STATUSES) {
    if (!seenKeys.has(defaultStatus.key)) {
      const projectCount = projectCountsByKey.get(defaultStatus.key) ?? 0;
      return {
        ok: false,
        error:
          projectCount > 0
            ? `${defaultStatus.name} cannot be removed while projects use it.`
            : "Default project statuses cannot be removed.",
      };
    }
  }

  return { ok: true, statuses };
}

export function serializeProjectStatusSettings(
  statuses: ProjectStatusConfig[],
) {
  return statuses.map((status, position) => ({
    id: status.id,
    key: status.key,
    name: status.name,
    description: status.description,
    color: status.color,
    icon: status.icon,
    position,
    isDefault: status.isDefault,
  }));
}
