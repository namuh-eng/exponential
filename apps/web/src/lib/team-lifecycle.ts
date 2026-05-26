import { team } from "@/lib/db/schema";
import { isNull } from "drizzle-orm";

export const TEAM_RESTORATION_WINDOW_DAYS = 30;
export const TEAM_RESTORATION_WINDOW_MS =
  TEAM_RESTORATION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export const activeTeamFilter = isNull(team.deletedAt);

export type TeamLifecycleRecord = {
  retiredAt?: Date | null;
  deletedAt?: Date | null;
  deleteScheduledAt?: Date | null;
  restorableUntil?: Date | null;
};

export function getTeamRestorableUntil(from = new Date()) {
  return new Date(from.getTime() + TEAM_RESTORATION_WINDOW_MS);
}

export function isTeamRetired(teamRecord: TeamLifecycleRecord) {
  return Boolean(teamRecord.retiredAt);
}

export function isTeamDeleted(teamRecord: TeamLifecycleRecord) {
  return Boolean(teamRecord.deletedAt);
}

export function isTeamRestorable(
  teamRecord: TeamLifecycleRecord,
  now = new Date(),
) {
  return Boolean(
    teamRecord.deletedAt &&
      teamRecord.restorableUntil &&
      teamRecord.restorableUntil.getTime() >= now.getTime(),
  );
}
