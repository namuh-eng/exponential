export type ImportExportJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed";
export type ImportProvider = "csv" | "github" | "jira";

export type ImportExportJobSummary = {
  id: string;
  type: "import" | "export";
  provider?: ImportProvider;
  status: ImportExportJobStatus;
  createdAt: string;
  completedAt?: string;
  fileName?: string;
  message: string;
  rowCount?: number;
  importedCount?: number;
  errorCount?: number;
  downloadUrl?: string;
};

export type ImportExportState = {
  exports: ImportExportJobSummary[];
  imports: ImportExportJobSummary[];
  artifacts: Record<string, unknown>;
};

export type CsvPreviewRow = {
  rowNumber: number;
  values: Record<string, string>;
  errors: string[];
};

export type CsvPreview = {
  headers: string[];
  rows: CsvPreviewRow[];
  validCount: number;
  errorCount: number;
  rowCount: number;
};

export type CsvMapping = {
  title: string;
  description?: string;
  priority?: string;
  teamKey?: string;
};

export const DEFAULT_CSV_MAPPING: CsvMapping = {
  title: "title",
  description: "description",
  priority: "priority",
  teamKey: "team",
};

const VALID_PRIORITIES = new Set(["none", "urgent", "high", "medium", "low"]);

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readImportExportState(settings: unknown): ImportExportState {
  const raw = asRecord(asRecord(settings).importExport);
  return {
    exports: normalizeJobs(raw.exports),
    imports: normalizeJobs(raw.imports),
    artifacts: asRecord(raw.artifacts),
  };
}

export function writeImportExportState(
  settings: unknown,
  state: ImportExportState,
) {
  return {
    ...asRecord(settings),
    importExport: {
      exports: state.exports.slice(0, 25),
      imports: state.imports.slice(0, 25),
      artifacts: state.artifacts,
    },
  };
}

function normalizeJobs(value: unknown): ImportExportJobSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const id = typeof record.id === "string" ? record.id : "";
    const type =
      record.type === "export" || record.type === "import" ? record.type : null;
    const status =
      typeof record.status === "string" &&
      ["queued", "processing", "completed", "failed"].includes(record.status)
        ? (record.status as ImportExportJobStatus)
        : "queued";
    const createdAt =
      typeof record.createdAt === "string" ? record.createdAt : "";
    const message = typeof record.message === "string" ? record.message : "";
    if (!id || !type || !createdAt || !message) return [];
    return [
      {
        id,
        type,
        provider:
          record.provider === "csv" ||
          record.provider === "github" ||
          record.provider === "jira"
            ? record.provider
            : undefined,
        status,
        createdAt,
        completedAt:
          typeof record.completedAt === "string"
            ? record.completedAt
            : undefined,
        fileName:
          typeof record.fileName === "string" ? record.fileName : undefined,
        message,
        rowCount:
          typeof record.rowCount === "number" ? record.rowCount : undefined,
        importedCount:
          typeof record.importedCount === "number"
            ? record.importedCount
            : undefined,
        errorCount:
          typeof record.errorCount === "number" ? record.errorCount : undefined,
        downloadUrl:
          typeof record.downloadUrl === "string"
            ? record.downloadUrl
            : undefined,
      } satisfies ImportExportJobSummary,
    ];
  });
}

export function parseCsv(text: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && (char === "," || char === "\n" || char === "\r")) {
      row.push(field.trim());
      field = "";
      if (char === "\r" && next === "\n") index += 1;
      if (char === "\n" || char === "\r") {
        if (row.some((value) => value !== "")) rows.push(row);
        row = [];
      }
      continue;
    }
    field += char;
  }

  row.push(field.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  if (rows.length === 0) return { headers: [], rows: [] };

  const headers = rows[0].map((header) => header.trim()).filter(Boolean);
  const records = rows
    .slice(1)
    .map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, values[index]?.trim() ?? ""]),
      ),
    );
  return { headers, rows: records };
}

export function inferCsvMapping(headers: string[]): CsvMapping {
  const byLower = new Map(
    headers.map((header) => [header.toLowerCase(), header]),
  );
  const find = (...names: string[]) =>
    names.map((name) => byLower.get(name)).find(Boolean);
  return {
    title: find("title", "name", "summary") ?? headers[0] ?? "title",
    description: find("description", "body", "details"),
    priority: find("priority"),
    teamKey: find("team", "teamkey", "team key"),
  };
}

export function buildCsvPreview(
  text: string,
  mapping: CsvMapping = DEFAULT_CSV_MAPPING,
): CsvPreview {
  const parsed = parseCsv(text);
  const rows = parsed.rows.map((values, index) => {
    const errors = validateCsvRow(values, mapping);
    return { rowNumber: index + 2, values, errors };
  });
  return {
    headers: parsed.headers,
    rows,
    rowCount: rows.length,
    validCount: rows.filter((row) => row.errors.length === 0).length,
    errorCount: rows.filter((row) => row.errors.length > 0).length,
  };
}

export function validateCsvRow(
  values: Record<string, string>,
  mapping: CsvMapping,
): string[] {
  const errors: string[] = [];
  const title = values[mapping.title]?.trim() ?? "";
  if (!title) errors.push("Title is required");
  if (title.length > 500) errors.push("Title must be 500 characters or less");
  const priorityColumn = mapping.priority;
  const priority = priorityColumn
    ? values[priorityColumn]?.trim().toLowerCase()
    : "";
  if (priority && !VALID_PRIORITIES.has(priority)) {
    errors.push("Priority must be none, urgent, high, medium, or low");
  }
  return errors;
}

export function readCsvValue(values: Record<string, string>, column?: string) {
  if (!column) return "";
  return values[column]?.trim() ?? "";
}

export type IssuePriority = "none" | "urgent" | "high" | "medium" | "low";

export function normalizePriority(value: string): IssuePriority {
  const normalized = value.trim().toLowerCase();
  return VALID_PRIORITIES.has(normalized)
    ? (normalized as IssuePriority)
    : "none";
}

export function makeJobId(prefix: "import" | "export") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
