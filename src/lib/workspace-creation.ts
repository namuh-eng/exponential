export const MAX_WORKSPACE_NAME_LENGTH = 255;
export const MAX_WORKSPACE_SLUG_LENGTH = 63;
const TEAM_KEY_LENGTH = 3;

const DEFAULT_WORKFLOW_STATE_DEFINITIONS = [
  {
    name: "Triage",
    category: "triage" as const,
    color: "#f59e0b",
    isDefault: true,
  },
  {
    name: "Backlog",
    category: "backlog" as const,
    color: "#6b6f76",
    isDefault: true,
  },
  {
    name: "Todo",
    category: "unstarted" as const,
    color: "#6b6f76",
    isDefault: true,
  },
  {
    name: "In Progress",
    category: "started" as const,
    color: "#f59e0b",
    isDefault: true,
  },
  {
    name: "Done",
    category: "completed" as const,
    color: "#22c55e",
    isDefault: true,
  },
  {
    name: "Canceled",
    category: "canceled" as const,
    color: "#6b6f76",
    isDefault: true,
  },
];

export function sanitizeWorkspaceSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_WORKSPACE_SLUG_LENGTH)
    .replace(/-+$/g, "");
}

export function validateWorkspaceSlug(value: string) {
  const trimmedSlug = value.trim();

  if (
    trimmedSlug.length < 2 ||
    trimmedSlug.length > MAX_WORKSPACE_SLUG_LENGTH
  ) {
    return `URL slug must be between 2 and ${MAX_WORKSPACE_SLUG_LENGTH} characters`;
  }

  if (trimmedSlug !== value) {
    return "URL slug cannot include leading or trailing spaces";
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmedSlug)) {
    return "URL slug can only use lowercase letters, numbers, and single hyphens";
  }

  return null;
}

export function validateWorkspaceName(name: string) {
  const trimmedName = name.trim();

  if (!trimmedName) {
    return "Name is required";
  }

  if (trimmedName.length > MAX_WORKSPACE_NAME_LENGTH) {
    return `Workspace name must be ${MAX_WORKSPACE_NAME_LENGTH} characters or fewer`;
  }

  return null;
}

function getTeamKeyPrefix(name: string) {
  return name
    .trim()
    .substring(0, TEAM_KEY_LENGTH)
    .toUpperCase()
    .replace(/[^A-Z]/g, "X")
    .padEnd(TEAM_KEY_LENGTH, "X");
}

export function generateTeamKey(
  name: string,
  existingKeys: Iterable<string>,
): string {
  const prefix = getTeamKeyPrefix(name);
  const normalizedKeys = new Set(
    Array.from(existingKeys, (key) => key.trim().toUpperCase()),
  );

  if (!normalizedKeys.has(prefix)) {
    return prefix;
  }

  let suffix = 2;
  while (normalizedKeys.has(`${prefix}${suffix}`)) {
    suffix += 1;
  }

  return `${prefix}${suffix}`;
}

export function getDefaultWorkflowStates(teamId: string) {
  return DEFAULT_WORKFLOW_STATE_DEFINITIONS.map((state, index) => ({
    ...state,
    teamId,
    position: index,
  }));
}
