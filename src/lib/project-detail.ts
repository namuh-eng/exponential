export interface ProjectResource {
  id: string;
  title: string;
  type: "document" | "link";
  url: string | null;
  createdAt: string;
}

export interface ProjectActivityEntry {
  id: string;
  type: "update" | "resource" | "properties" | "milestone";
  title: string;
  body: string | null;
  actorName: string;
  actorImage: string | null;
  createdAt: string;
}

export interface ProjectSettingsShape {
  slackChannel: string | null;
  labelIds: string[];
  projectStatusKey: string | null;
  resources: ProjectResource[];
  activity: ProjectActivityEntry[];
  milestoneDescriptions: Record<string, string>;
}

export interface ProjectMilestoneInput {
  id: string;
  name: string;
  description?: string | null;
}

export interface ProjectIssueInput {
  id: string;
  projectMilestoneId: string | null;
  completedAt: string | Date | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResource(value: unknown): value is ProjectResource {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    (value.type === "document" || value.type === "link") &&
    (typeof value.url === "string" || value.url === null) &&
    typeof value.createdAt === "string"
  );
}

function isActivityEntry(value: unknown): value is ProjectActivityEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    (value.type === "update" ||
      value.type === "resource" ||
      value.type === "properties" ||
      value.type === "milestone") &&
    typeof value.title === "string" &&
    (typeof value.body === "string" || value.body === null) &&
    typeof value.actorName === "string" &&
    (typeof value.actorImage === "string" || value.actorImage === null) &&
    typeof value.createdAt === "string"
  );
}

export function readProjectSettings(settings: unknown): ProjectSettingsShape {
  if (!isRecord(settings)) {
    return {
      slackChannel: null,
      labelIds: [],
      projectStatusKey: null,
      resources: [],
      activity: [],
      milestoneDescriptions: {},
    };
  }

  return {
    slackChannel:
      typeof settings.slackChannel === "string" && settings.slackChannel.trim()
        ? settings.slackChannel
        : null,
    labelIds: Array.isArray(settings.labelIds)
      ? settings.labelIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    projectStatusKey:
      typeof settings.projectStatusKey === "string" &&
      settings.projectStatusKey.trim()
        ? settings.projectStatusKey.trim()
        : null,
    resources: Array.isArray(settings.resources)
      ? settings.resources.filter(isResource)
      : [],
    activity: Array.isArray(settings.activity)
      ? settings.activity.filter(isActivityEntry)
      : [],
    milestoneDescriptions: isRecord(settings.milestoneDescriptions)
      ? Object.fromEntries(
          Object.entries(settings.milestoneDescriptions).filter(
            (entry): entry is [string, string] =>
              typeof entry[0] === "string" && typeof entry[1] === "string",
          ),
        )
      : {},
  };
}

export function buildMilestoneData(
  milestones: ProjectMilestoneInput[],
  issues: ProjectIssueInput[],
) {
  return milestones.map((milestone) => {
    const milestoneIssues = issues.filter(
      (issue) => issue.projectMilestoneId === milestone.id,
    );
    const issueCount = milestoneIssues.length;
    const completedCount = milestoneIssues.filter(
      (issue) => issue.completedAt !== null,
    ).length;

    return {
      id: milestone.id,
      name: milestone.name,
      ...(milestone.description !== undefined
        ? { description: milestone.description }
        : {}),
      issueCount,
      completedCount,
      progress:
        issueCount > 0 ? Math.round((completedCount / issueCount) * 100) : 0,
    };
  });
}

export function haveSameIds(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const leftIds = [...left].sort();
  const rightIds = [...right].sort();

  return leftIds.every((value, index) => value === rightIds[index]);
}
