import type { components } from "@exponential/sdk";

const priorities = new Set(["none", "urgent", "high", "medium", "low"]);

type IssuePriority = components["schemas"]["IssuePriority"];

export function readOption(args: string[], name: string) {
  const long = `--${name}`;
  const index = args.indexOf(long);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

export function readFlag(args: string[], name: string) {
  return args.includes(`--${name}`);
}

export function requireOption(args: string[], name: string) {
  const value = readOption(args, name);
  if (!value) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

export function parsePriority(value: string | undefined): IssuePriority {
  const priority = value ?? "none";
  if (!priorities.has(priority)) {
    throw new Error(`invalid --priority: ${priority}`);
  }
  return priority as IssuePriority;
}

export function parseIssueBody(args: string[]) {
  const estimate = readOption(args, "estimate");
  return {
    title: readOption(args, "title"),
    description: readOption(args, "description") ?? null,
    team_id: readOption(args, "team-id"),
    state_id: readOption(args, "state-id") ?? null,
    priority: parsePriority(readOption(args, "priority")),
    assignee_id: readOption(args, "assignee-id") ?? null,
    project_id: readOption(args, "project-id") ?? null,
    project_milestone_id: readOption(args, "project-milestone-id") ?? null,
    cycle_id: readOption(args, "cycle-id") ?? null,
    parent_issue_id: readOption(args, "parent-issue-id") ?? null,
    due_date: readOption(args, "due-date") ?? null,
    estimate: estimate ? Number(estimate) : null,
  };
}
