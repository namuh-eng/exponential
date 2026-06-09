import { readFlag, readOption } from "./args.js";

export type OutputMode = "json" | "human";

export function resolveOutputMode(input: {
  args: string[];
  defaultHuman: boolean;
  isTTY: boolean;
  env: NodeJS.ProcessEnv;
}): OutputMode {
  if (readFlag(input.args, "json")) {
    return "json";
  }

  const format = readOption(input.args, "format");
  if (format === "json") {
    return "json";
  }
  if (format === "table" || format === "detail") {
    return "human";
  }
  if (format) {
    throw new Error("--format must be json, table, or detail");
  }

  if (input.defaultHuman && input.isTTY && !input.env.CI) {
    return "human";
  }
  return "json";
}

export function formatHumanResult(kind: string, data: unknown): string {
  if (kind === "issue-list") {
    return formatRows(extractRows(data, ["issues"]), [
      ["identifier", "ID"],
      ["title", "Title"],
      ["priority", "Priority"],
      ["state", "State"],
    ]);
  }

  if (kind === "issue-detail") {
    const issue = unwrapRecord(data, ["issue"]);
    return formatDetail(issue, [
      "identifier",
      "title",
      "description",
      "priority",
      "status",
      "state",
      "teamKey",
      "projectName",
      "assigneeName",
      "createdAt",
      "updatedAt",
    ]);
  }

  if (kind === "project-list") {
    return formatRows(extractRows(data, ["projects"]), [
      ["slug", "Slug"],
      ["name", "Name"],
      ["status", "Status"],
      ["priority", "Priority"],
      ["progress", "Progress"],
    ]);
  }

  if (kind === "project-detail") {
    return formatDetail(unwrapRecord(data, ["project"]), [
      "slug",
      "name",
      "description",
      "status",
      "priority",
      "start_date",
      "target_date",
      "createdAt",
      "updatedAt",
    ]);
  }

  if (kind === "cycle-current") {
    const cycle = unwrapRecord(data, ["cycle"]);
    if (!cycle) {
      return "No current cycle found.";
    }
    return formatDetail(cycle, ["id", "name", "start_date", "end_date"]);
  }

  if (kind === "whoami") {
    const profile = unwrapRecord(data, ["profile"]);
    const workspaceAccess = isRecord(data) ? data.workspaceAccess : undefined;
    return [
      formatDetail(profile, ["id", "name", "email"]),
      workspaceAccess
        ? `workspaceAccess: ${stringifyValue(workspaceAccess)}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return JSON.stringify(data, null, 2);
}

function extractRows(data: unknown, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter(isRecord);
  }
  if (!isRecord(data)) {
    return [];
  }
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }
  return [];
}

function unwrapRecord(
  data: unknown,
  keys: string[],
): Record<string, unknown> | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  for (const key of keys) {
    const value = data[key];
    if (isRecord(value)) {
      return value;
    }
  }
  return data;
}

function formatRows(
  rows: Record<string, unknown>[],
  columns: [field: string, label: string][],
) {
  if (rows.length === 0) {
    return "No results.";
  }

  const values = rows.map((row) =>
    columns.map(([field]) => stringifyValue(row[field])),
  );
  const widths = columns.map(([_, label], columnIndex) =>
    Math.max(label.length, ...values.map((row) => row[columnIndex].length)),
  );
  const header = columns
    .map(([, label], index) => label.padEnd(widths[index]))
    .join("  ")
    .trimEnd();
  const separator = widths.map((width) => "-".repeat(width)).join("  ");
  const body = values.map((row) =>
    row
      .map((value, index) => value.padEnd(widths[index]))
      .join("  ")
      .trimEnd(),
  );

  return [header, separator, ...body].join("\n");
}

function formatDetail(
  record: Record<string, unknown> | undefined,
  fields: string[],
) {
  if (!record) {
    return "No result.";
  }
  return fields
    .filter((field) => record[field] !== undefined && record[field] !== null)
    .map((field) => `${field}: ${stringifyValue(record[field])}`)
    .join("\n");
}

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
