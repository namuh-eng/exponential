import { createHmac, timingSafeEqual } from "node:crypto";
import type { components } from "@namuh-eng/expn-sdk";

type Issue = components["schemas"]["Issue"];
type Project = components["schemas"]["Project"];
type Comment = components["schemas"]["Comment"];
type AttachmentUpload =
  components["schemas"]["AttachmentPresignedUploadResponse"];

type JsonObject = Record<string, unknown>;

type AuthData = {
  access_token?: string;
  refresh_token?: string;
  apiKey?: string;
  baseUrl?: string;
};

type Bundle<TInput extends JsonObject = JsonObject> = {
  authData?: AuthData;
  inputData?: TInput;
  targetUrl?: string;
  cleanedRequest?: {
    rawBody?: string;
    json?: unknown;
    headers?: Record<string, string | string[] | undefined>;
  };
  subscribeData?: JsonObject;
};

type RequestOptions = {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: JsonObject;
};

type ZapierResponse = {
  status?: number;
  statusCode?: number;
  json?: unknown;
  content?: string;
};

type ZObject = {
  request: (options: RequestOptions) => Promise<ZapierResponse>;
};

type TriggerDefinition = {
  key: string;
  noun: string;
  event: string;
  sample: JsonObject;
  listPath?: string;
  listProperty?: string;
};

const DEFAULT_BASE_URL = "https://exponential.app/api";
const ZAPIER_SCOPES = [
  "issues:read",
  "issues:write",
  "comments:write",
  "projects:read",
  "projects:write",
  "attachments:write",
  "webhooks:write",
];

const issueSample: Issue = {
  id: "00000000-0000-4000-8000-000000000101",
  number: 101,
  identifier: "ENG-101",
  title: "Zapier sample issue",
  description: "Created from the Exponential Zapier app sample.",
  team_id: "00000000-0000-4000-8000-000000000201",
  state_id: "00000000-0000-4000-8000-000000000301",
  assignee_id: null,
  creator_id: "user_123",
  priority: "medium",
  estimate: null,
  parent_issue_id: null,
  project_id: null,
  project_milestone_id: null,
  cycle_id: null,
  due_date: null,
  sort_order: 0,
  created_at: "2026-06-18T12:00:00Z",
  updated_at: "2026-06-18T12:00:00Z",
  archived_at: null,
  canceled_at: null,
  completed_at: null,
};

const projectSample: Project = {
  id: "00000000-0000-4000-8000-000000000401",
  name: "Zapier launch",
  description: "Coordinate the public Zapier app launch.",
  icon: "⚡",
  slug: "zapier-launch",
  status: "planned",

  priority: "medium",
  lead_id: null,
  workspace_id: "00000000-0000-4000-8000-000000000501",
  start_date: null,
  target_date: null,
  completed_at: null,
  canceled_at: null,
  teams: [],

  progress: { total: 0, completed: 0, percentage: 0 },
  created_at: "2026-06-18T12:00:00Z",
  updated_at: "2026-06-18T12:00:00Z",
};

const commentSample: Comment = {
  id: "00000000-0000-4000-8000-000000000601",
  issue_id: issueSample.id,
  user_id: "user_123",
  user: { name: "Zapier User", image: null },
  owned_by_me: true,
  can_edit: true,
  can_delete: true,
  reactions: [],
  body: "Zapier sample comment.",
  created_at: "2026-06-18T12:00:00Z",
  updated_at: "2026-06-18T12:00:00Z",
};

const triggerDefinitions: TriggerDefinition[] = [
  {
    key: "new_issue",
    noun: "Issue",
    event: "issue.created",
    sample: issueSample,
    listPath: "/issues?limit=20",
    listProperty: "data",
  },
  {
    key: "updated_issue",
    noun: "Issue",
    event: "issue.updated",
    sample: issueSample,
    listPath: "/issues?limit=20",
    listProperty: "data",
  },
  {
    key: "issue_status_changed",
    noun: "Issue Status Change",
    event: "issue.status_changed",
    sample: {
      issue: issueSample,
      previousStateId: "00000000-0000-4000-8000-000000000300",
      currentStateId: issueSample.state_id,
    },
  },
  {
    key: "new_comment",
    noun: "Comment",
    event: "comment.created",
    sample: commentSample,
  },
  {
    key: "new_project",
    noun: "Project",
    event: "project.created",
    sample: projectSample,
    listPath: "/projects",
    listProperty: "projects",
  },
];

function baseUrl(bundle: Bundle): string {
  return (bundle.authData?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function authToken(bundle: Bundle): string {
  const token = bundle.authData?.access_token ?? bundle.authData?.apiKey;
  if (!token) {
    throw new Error(
      "Exponential authentication is missing. Reconnect the Zapier account.",
    );
  }
  return token;
}

function readString(
  input: JsonObject | undefined,
  key: string,
): string | undefined {
  const value = input?.[key];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function readNumber(
  input: JsonObject | undefined,
  key: string,
): number | undefined {
  const value = input?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return undefined;
}

function readNullableString(
  input: JsonObject | undefined,
  key: string,
): string | null | undefined {
  if (!input || !(key in input)) return undefined;
  const value = input[key];
  if (value === null || value === "") return null;
  return typeof value === "string" ? value.trim() : undefined;
}

function readStringList(
  input: JsonObject | undefined,
  key: string,
): string[] | undefined {
  const value = input?.[key];
  if (Array.isArray(value)) {
    return value
      .filter(
        (item): item is string =>
          typeof item === "string" && item.trim() !== "",
      )
      .map((item) => item.trim());
  }
  if (typeof value === "string" && value.trim() !== "") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return undefined;
}

function responsePayload(response: ZapierResponse): unknown {
  if (response.json !== undefined) return response.json;
  if (response.content !== undefined && response.content.trim() !== "") {
    return JSON.parse(response.content);
  }
  return {};
}

function problemMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object")
    return "Exponential API request failed.";
  const record = payload as JsonObject;
  const title =
    typeof record.title === "string"
      ? record.title
      : "Exponential API request failed";
  const detail =
    typeof record.detail === "string" && record.detail !== ""
      ? `: ${record.detail}`
      : "";
  return `${title}${detail}`;
}

async function apiRequest<T>(
  z: ZObject,
  bundle: Bundle,
  method: string,
  path: string,
  body?: JsonObject,
): Promise<T> {
  const options: RequestOptions = {
    url: `${baseUrl(bundle)}${path}`,
    method,
    headers: {
      Authorization: `Bearer ${authToken(bundle)}`,
      "Content-Type": "application/json",
      "User-Agent": "exponential-zapier/0.1",
    },
  };
  if (body !== undefined) options.body = body;
  const response = await z.request(options);
  const status = response.status ?? response.statusCode ?? 200;
  const payload = responsePayload(response);
  if (status < 200 || status >= 300) {
    throw new Error(problemMessage(payload));
  }
  return payload as T;
}

function envelopeData(
  cleanedRequest: Bundle["cleanedRequest"],
): JsonObject | undefined {
  const json = cleanedRequest?.json;
  if (!json || typeof json !== "object") return undefined;
  const envelope = json as JsonObject;
  const data = envelope.data;
  return data && typeof data === "object" ? (data as JsonObject) : envelope;
}

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) continue;
    if (Array.isArray(value)) return value[0];
    return value;
  }
  return undefined;
}

export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signature: string | undefined,
): boolean {
  if (!secret || !rawBody || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(signature);
  return (
    expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes)
  );
}

function performWebhook(definition: TriggerDefinition) {
  return async (_z: ZObject, bundle: Bundle): Promise<JsonObject[]> => {
    const cleaned = bundle.cleanedRequest;
    const rawBody = cleaned?.rawBody;
    const secret = readString(bundle.subscribeData, "secret");
    if (secret && rawBody) {
      const signature =
        headerValue(cleaned?.headers, "X-Exponential-Signature") ??
        headerValue(cleaned?.headers, "X-Hub-Signature-256");
      if (!verifyWebhookSignature(secret, rawBody, signature)) {
        throw new Error("Exponential webhook signature verification failed.");
      }
    }
    const json = cleaned?.json;
    if (json && typeof json === "object") {
      const envelope = json as JsonObject;
      if (
        typeof envelope.type === "string" &&
        envelope.type !== definition.event
      )
        return [];
    }
    const data = envelopeData(cleaned);
    return data ? [data] : [];
  };
}

function performList(definition: TriggerDefinition) {
  return async (z: ZObject, bundle: Bundle): Promise<JsonObject[]> => {
    if (!definition.listPath || !definition.listProperty)
      return [definition.sample];
    const response = await apiRequest<JsonObject>(
      z,
      bundle,
      "GET",
      definition.listPath,
    );
    const value = response[definition.listProperty];
    return Array.isArray(value)
      ? value.filter(
          (item): item is JsonObject =>
            Boolean(item) && typeof item === "object",
        )
      : [definition.sample];
  };
}

function performSubscribe(definition: TriggerDefinition) {
  return async (z: ZObject, bundle: Bundle): Promise<JsonObject> => {
    if (!bundle.targetUrl) {
      throw new Error(
        "Zapier did not provide a target URL for the webhook subscription.",
      );
    }
    const response = await apiRequest<{ createdCredential?: JsonObject }>(
      z,
      bundle,
      "POST",
      "/workspaces/current/api",
      {
        action: "createWebhook",
        label: `Zapier ${definition.noun}`,
        url: bundle.targetUrl,
        events: [definition.event],
      },
    );
    const credential = response.createdCredential;
    return {
      id: readString(credential, "id") ?? "",
      secret: readString(credential, "secret") ?? "",
      event: definition.event,
    };
  };
}

async function performUnsubscribe(
  z: ZObject,
  bundle: Bundle,
): Promise<JsonObject> {
  const id = readString(bundle.subscribeData, "id");
  if (!id) return { skipped: true };
  await apiRequest<JsonObject>(z, bundle, "POST", "/workspaces/current/api", {
    action: "deleteWebhook",
    id,
  });
  return { id, deleted: true };
}

function trigger(definition: TriggerDefinition): JsonObject {
  return {
    key: definition.key,
    noun: definition.noun,
    display: {
      label: definition.noun.startsWith("Issue Status")
        ? "Issue Status Changed"
        : `New/Updated ${definition.noun}`,
      description: `Triggers from Exponential ${definition.event} webhook events with polling sample data.`,
    },
    operation: {
      type: "hook",
      performSubscribe: performSubscribe(definition),
      performUnsubscribe,
      perform: performWebhook(definition),
      performList: performList(definition),
      sample: definition.sample,
    },
  };
}

export async function createIssue(z: ZObject, bundle: Bundle): Promise<Issue> {
  const input = bundle.inputData;
  const title = readString(input, "title");
  const teamID = readString(input, "team_id") ?? readString(input, "teamId");
  if (!title || !teamID)
    throw new Error("Issue title and team ID are required.");
  return apiRequest<Issue>(z, bundle, "POST", "/issues", {
    title,
    team_id: teamID,
    description: readNullableString(input, "description"),
    state_id: readNullableString(input, "state_id"),
    priority: readString(input, "priority"),
    assignee_id: readNullableString(input, "assignee_id"),
    project_id: readNullableString(input, "project_id"),
    due_date: readNullableString(input, "due_date"),
    estimate: readNumber(input, "estimate"),
  });
}

export async function updateIssue(z: ZObject, bundle: Bundle): Promise<Issue> {
  const input = bundle.inputData;
  const id = readString(input, "id") ?? readString(input, "issue_id");
  if (!id) throw new Error("Issue ID is required.");
  return apiRequest<Issue>(
    z,
    bundle,
    "PATCH",
    `/issues/${encodeURIComponent(id)}`,
    {
      title: readString(input, "title"),
      description: readNullableString(input, "description"),
      state_id: readNullableString(input, "state_id"),
      priority: readString(input, "priority"),
      assignee_id: readNullableString(input, "assignee_id"),
      project_id: readNullableString(input, "project_id"),
      due_date: readNullableString(input, "due_date"),
      estimate: readNumber(input, "estimate"),
    },
  );
}

export async function createComment(
  z: ZObject,
  bundle: Bundle,
): Promise<Comment> {
  const input = bundle.inputData;
  const issueID = readString(input, "issue_id") ?? readString(input, "issueId");
  const body = readString(input, "body");
  if (!issueID || !body)
    throw new Error("Issue ID and comment body are required.");
  return apiRequest<Comment>(
    z,
    bundle,
    "POST",
    `/issues/${encodeURIComponent(issueID)}/comments`,
    { body },
  );
}

export async function createProject(
  z: ZObject,
  bundle: Bundle,
): Promise<Project> {
  const input = bundle.inputData;
  const name = readString(input, "name");
  if (!name) throw new Error("Project name is required.");
  return apiRequest<Project>(z, bundle, "POST", "/projects", {
    name,
    description: readNullableString(input, "description"),
    icon: readString(input, "icon"),
    slug: readString(input, "slug"),
    status: readString(input, "status"),
    priority: readString(input, "priority"),
    team_ids: readStringList(input, "team_ids"),
    team_keys: readStringList(input, "team_keys"),
    target_date: readNullableString(input, "target_date"),
  });
}

export async function createAttachment(
  z: ZObject,
  bundle: Bundle,
): Promise<AttachmentUpload> {
  const input = bundle.inputData;
  const fileName =
    readString(input, "fileName") ?? readString(input, "file_name");
  if (!fileName) throw new Error("Attachment file name is required.");
  return apiRequest<AttachmentUpload>(
    z,
    bundle,
    "POST",
    "/attachments/presigned-upload",
    {
      fileName,
      size: readNumber(input, "size") ?? 0,
      contentType:
        readString(input, "contentType") ?? readString(input, "content_type"),
    },
  );
}

const inputFields = {
  issueCreate: [
    { key: "title", required: true, type: "string", label: "Title" },
    { key: "team_id", required: true, type: "string", label: "Team ID" },
    { key: "description", type: "text", label: "Description" },
    { key: "priority", type: "string", label: "Priority" },
    { key: "state_id", type: "string", label: "Workflow State ID" },
    { key: "assignee_id", type: "string", label: "Assignee User ID" },
    { key: "project_id", type: "string", label: "Project ID" },
    { key: "due_date", type: "string", label: "Due Date (YYYY-MM-DD)" },
  ],
  issueUpdate: [
    {
      key: "id",
      required: true,
      type: "string",
      label: "Issue ID or identifier",
    },
    { key: "title", type: "string", label: "Title" },
    { key: "description", type: "text", label: "Description" },
    { key: "priority", type: "string", label: "Priority" },
    { key: "state_id", type: "string", label: "Workflow State ID" },
    { key: "assignee_id", type: "string", label: "Assignee User ID" },
    { key: "project_id", type: "string", label: "Project ID" },
    { key: "due_date", type: "string", label: "Due Date (YYYY-MM-DD)" },
  ],
  commentCreate: [
    {
      key: "issue_id",
      required: true,
      type: "string",
      label: "Issue ID or identifier",
    },
    { key: "body", required: true, type: "text", label: "Comment Body" },
  ],
  projectCreate: [
    { key: "name", required: true, type: "string", label: "Name" },
    { key: "description", type: "text", label: "Description" },
    { key: "slug", type: "string", label: "Slug" },
    { key: "status", type: "string", label: "Status" },
    { key: "priority", type: "string", label: "Priority" },
    { key: "team_ids", type: "string", label: "Team IDs (comma-separated)" },
    { key: "team_keys", type: "string", label: "Team Keys (comma-separated)" },
    { key: "target_date", type: "string", label: "Target Date (YYYY-MM-DD)" },
  ],
  attachmentCreate: [
    { key: "fileName", required: true, type: "string", label: "File Name" },
    { key: "size", type: "integer", label: "File Size" },
    { key: "contentType", type: "string", label: "Content Type" },
  ],
};

const triggers = Object.fromEntries(
  triggerDefinitions.map((definition) => [definition.key, trigger(definition)]),
);

const App = {
  version: "0.1.0",
  platformVersion: "15.0.0",
  authentication: {
    type: "oauth2",
    test: async (z: ZObject, bundle: Bundle) =>
      apiRequest<JsonObject>(z, bundle, "GET", "/auth/session"),
    oauth2Config: {
      authorizeUrl: {
        url: "{{bundle.authData.baseUrl}}/oauth/authorize",
        params: {
          client_id: "{{process.env.CLIENT_ID}}",
          redirect_uri: "{{bundle.inputData.redirect_uri}}",
          response_type: "code",
          scope: ZAPIER_SCOPES.join(" "),
          state: "{{bundle.inputData.state}}",
        },
      },
      getAccessToken: {
        url: "{{bundle.authData.baseUrl}}/oauth/token",
        method: "POST",
        body: {
          grant_type: "authorization_code",
          code: "{{bundle.inputData.code}}",
          client_id: "{{process.env.CLIENT_ID}}",
          client_secret: "{{process.env.CLIENT_SECRET}}",
          redirect_uri: "{{bundle.inputData.redirect_uri}}",
        },
      },
      autoRefresh: false,
    },
    fields: [
      {
        key: "baseUrl",
        type: "string",
        required: false,
        default: DEFAULT_BASE_URL,
        helpText:
          "Use https://exponential.app/api for hosted Exponential or your self-hosted /api base URL.",
      },
    ],
    connectionLabel: "{{bundle.authData.baseUrl}}",
  },
  triggers,
  creates: {
    create_issue: {
      key: "create_issue",
      noun: "Issue",
      display: {
        label: "Create Issue",
        description: "Create an Exponential issue.",
      },
      operation: {
        inputFields: inputFields.issueCreate,
        perform: createIssue,
        sample: issueSample,
      },
    },
    update_issue: {
      key: "update_issue",
      noun: "Issue",
      display: {
        label: "Update Issue",
        description: "Update an Exponential issue.",
      },
      operation: {
        inputFields: inputFields.issueUpdate,
        perform: updateIssue,
        sample: issueSample,
      },
    },
    create_comment: {
      key: "create_comment",
      noun: "Comment",
      display: {
        label: "Create Comment",
        description: "Create a comment on an Exponential issue.",
      },
      operation: {
        inputFields: inputFields.commentCreate,
        perform: createComment,
        sample: commentSample,
      },
    },
    create_project: {
      key: "create_project",
      noun: "Project",
      display: {
        label: "Create Project",
        description: "Create an Exponential project.",
      },
      operation: {
        inputFields: inputFields.projectCreate,
        perform: createProject,
        sample: projectSample,
      },
    },
    create_attachment: {
      key: "create_attachment",
      noun: "Attachment Upload",
      display: {
        label: "Create Attachment Upload",
        description:
          "Create a presigned upload URL for an Exponential attachment.",
      },
      operation: {
        inputFields: inputFields.attachmentCreate,
        perform: createAttachment,
      },
    },
  },
};

export {
  DEFAULT_BASE_URL,
  ZAPIER_SCOPES,
  triggerDefinitions,
  performSubscribe,
  performUnsubscribe,
  performWebhook,
  performList,
  apiRequest,
};
export default App;
