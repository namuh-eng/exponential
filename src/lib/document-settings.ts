import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export type DocumentTemplate = {
  id: string;
  name: string;
  description: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type DocumentFolder = {
  id: string;
  name: string;
  description: string;
  color: string;
  createdAt: string;
  updatedAt: string;
};

export type DocumentSettings = {
  templates: DocumentTemplate[];
  folders: DocumentFolder[];
};

export type DocumentSettingsAccess = {
  id: string;
  settings: unknown;
  role: string;
};

const DEFAULT_FOLDER_COLOR = "gray";
const FOLDER_COLORS = new Set([
  "gray",
  "blue",
  "green",
  "yellow",
  "orange",
  "purple",
  "pink",
]);

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function readTimestamp(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? fallback : value;
}

function normalizeTemplate(value: unknown): DocumentTemplate | null {
  const record = asRecord(value);
  const id = readString(record.id).trim();
  const name = readString(record.name).trim();
  if (!id || !name) return null;
  const now = new Date().toISOString();
  return {
    id,
    name,
    description: readString(record.description).trim(),
    content: readString(record.content).trim(),
    createdAt: readTimestamp(record.createdAt, now),
    updatedAt: readTimestamp(record.updatedAt, now),
  };
}

function normalizeFolder(value: unknown): DocumentFolder | null {
  const record = asRecord(value);
  const id = readString(record.id).trim();
  const name = readString(record.name).trim();
  if (!id || !name) return null;
  const color = readString(record.color, DEFAULT_FOLDER_COLOR).trim();
  const now = new Date().toISOString();
  return {
    id,
    name,
    description: readString(record.description).trim(),
    color: FOLDER_COLORS.has(color) ? color : DEFAULT_FOLDER_COLOR,
    createdAt: readTimestamp(record.createdAt, now),
    updatedAt: readTimestamp(record.updatedAt, now),
  };
}

export function readDocumentSettings(settings: unknown): DocumentSettings {
  const root = asRecord(settings);
  const documents = asRecord(root.documents);
  const templates = Array.isArray(documents.templates)
    ? documents.templates.map(normalizeTemplate).filter(Boolean)
    : [];
  const folders = Array.isArray(documents.folders)
    ? documents.folders.map(normalizeFolder).filter(Boolean)
    : [];

  return {
    templates: templates as DocumentTemplate[],
    folders: folders as DocumentFolder[],
  };
}

export function mergeDocumentSettings(
  existingSettings: unknown,
  documents: DocumentSettings,
) {
  const root = asRecord(existingSettings);
  return {
    ...root,
    documents,
  };
}

export function canManageDocumentSettings(role: string) {
  return role === "owner" || role === "admin";
}

export function parseTemplateInput(body: unknown, existing?: DocumentTemplate) {
  const record = asRecord(body);
  const name =
    record.name === undefined
      ? (existing?.name ?? "")
      : readString(record.name).trim();
  const description =
    record.description === undefined
      ? (existing?.description ?? "")
      : readString(record.description).trim();
  const content =
    record.content === undefined
      ? (existing?.content ?? "")
      : readString(record.content).trim();

  if (!name) throw new Error("Template name is required");
  if (!content) throw new Error("Template content is required");

  return { name, description, content };
}

export function parseFolderInput(body: unknown, existing?: DocumentFolder) {
  const record = asRecord(body);
  const name =
    record.name === undefined
      ? (existing?.name ?? "")
      : readString(record.name).trim();
  const description =
    record.description === undefined
      ? (existing?.description ?? "")
      : readString(record.description).trim();
  const rawColor =
    record.color === undefined
      ? (existing?.color ?? DEFAULT_FOLDER_COLOR)
      : readString(record.color, DEFAULT_FOLDER_COLOR).trim();
  const color = FOLDER_COLORS.has(rawColor) ? rawColor : DEFAULT_FOLDER_COLOR;

  if (!name) throw new Error("Folder name is required");

  return { name, description, color };
}

export async function findDocumentSettingsAccess(
  userId: string,
  request: Request,
): Promise<DocumentSettingsAccess | null> {
  const workspaceId = await resolveRequestWorkspaceId(userId, request);
  if (!workspaceId) return null;

  const [currentWorkspace] = await db
    .select({
      id: workspace.id,
      settings: workspace.settings,
      role: member.role,
    })
    .from(workspace)
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, workspace.id),
        eq(member.userId, userId),
        eq(member.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  return currentWorkspace ?? null;
}

export async function persistDocumentSettings(
  access: DocumentSettingsAccess,
  documents: DocumentSettings,
) {
  const settings = mergeDocumentSettings(access.settings, documents);
  await db
    .update(workspace)
    .set({ settings, updatedAt: new Date() })
    .where(eq(workspace.id, access.id));
  return settings;
}
