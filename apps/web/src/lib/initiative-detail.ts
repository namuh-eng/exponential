export type InitiativeUpdateHealth = "onTrack" | "atRisk" | "offTrack";
export type InitiativeHealth = InitiativeUpdateHealth | "unknown";

export interface InitiativeUpdateEntry {
  id: string;
  health: InitiativeUpdateHealth;
  body: string;
  actorName: string;
  actorImage: string | null;
  createdAt: string;
}

export interface InitiativeActivityEntry {
  id: string;
  type: "property_change" | "project_linked" | "project_unlinked";
  message: string;
  actorName: string;
  actorImage: string | null;
  createdAt: string;
}

export interface InitiativeSettingsShape {
  updates: InitiativeUpdateEntry[];
  activity: InitiativeActivityEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInitiativeUpdateEntry(
  value: unknown,
): value is InitiativeUpdateEntry {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    (value.health === "onTrack" ||
      value.health === "atRisk" ||
      value.health === "offTrack") &&
    typeof value.body === "string" &&
    typeof value.actorName === "string" &&
    (typeof value.actorImage === "string" || value.actorImage === null) &&
    typeof value.createdAt === "string"
  );
}

function isInitiativeActivityEntry(
  value: unknown,
): value is InitiativeActivityEntry {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    (value.type === "property_change" ||
      value.type === "project_linked" ||
      value.type === "project_unlinked") &&
    typeof value.message === "string" &&
    typeof value.actorName === "string" &&
    (typeof value.actorImage === "string" || value.actorImage === null) &&
    typeof value.createdAt === "string"
  );
}

export function readInitiativeSettings(
  settings: unknown,
): InitiativeSettingsShape {
  if (!isRecord(settings)) {
    return { updates: [], activity: [] };
  }

  return {
    updates: Array.isArray(settings.updates)
      ? settings.updates.filter(isInitiativeUpdateEntry)
      : [],
    activity: Array.isArray(settings.activity)
      ? settings.activity.filter(isInitiativeActivityEntry)
      : [],
  };
}

export function makeInitiativeUpdateEntry({
  health,
  body,
  actorName,
  actorImage,
}: {
  health: InitiativeUpdateHealth;
  body: string;
  actorName: string;
  actorImage: string | null;
}): InitiativeUpdateEntry {
  return {
    id: crypto.randomUUID(),
    health,
    body,
    actorName,
    actorImage,
    createdAt: new Date().toISOString(),
  };
}

export function makeInitiativeActivityEntry({
  type,
  message,
  actorName,
  actorImage,
}: {
  type: InitiativeActivityEntry["type"];
  message: string;
  actorName: string;
  actorImage: string | null;
}): InitiativeActivityEntry {
  return {
    id: crypto.randomUUID(),
    type,
    message,
    actorName,
    actorImage,
    createdAt: new Date().toISOString(),
  };
}

export function isInitiativeHealth(value: unknown): value is InitiativeHealth {
  return (
    value === "onTrack" ||
    value === "atRisk" ||
    value === "offTrack" ||
    value === "unknown"
  );
}
