type ZapierHttpMethod = "GET" | "POST";

type ZapierAuthData = {
  access_token?: string;
  api_key?: string;
  baseUrl?: string;
};

type ZapierBundle = {
  authData?: ZapierAuthData;
  inputData?: Record<string, unknown>;
  meta?: {
    isLoadingSample?: boolean;
  };
  targetUrl?: string;
  subscribeData?: {
    id?: string;
  };
};

type ZapierRequestOptions = {
  url: string;
  method?: ZapierHttpMethod;
  params?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
};

type ZapierResponse = {
  status: number;
  json?: unknown;
  content?: string;
};

type ZapierZ = {
  request: (options: ZapierRequestOptions) => Promise<ZapierResponse>;
};

type ZapierInputField =
  | string
  | {
      key: string;
      label?: string;
      type?: string;
      required?: boolean;
      helpText?: string;
      choices?: Record<string, string>;
      list?: boolean;
    };

type ZapierOperation = {
  inputFields?: ZapierInputField[];
  perform: (z: ZapierZ, bundle: ZapierBundle) => Promise<unknown>;
  performList?: (z: ZapierZ, bundle: ZapierBundle) => Promise<unknown>;
  performSubscribe?: (z: ZapierZ, bundle: ZapierBundle) => Promise<unknown>;
  performUnsubscribe?: (z: ZapierZ, bundle: ZapierBundle) => Promise<unknown>;
  sample?: Record<string, unknown>;
};

type ZapierAppDefinition = {
  version: string;
  platformVersion: string;
  authentication: {
    type: "oauth2";
    test: (z: ZapierZ, bundle: ZapierBundle) => Promise<unknown>;
    oauth2Config: {
      authorizeUrl: (bundle: ZapierBundle) => {
        url: string;
        params: Record<string, string>;
      };
      getAccessToken: (z: ZapierZ, bundle: ZapierBundle) => Promise<unknown>;
      autoRefresh: boolean;
    };
    fields: ZapierInputField[];
  };
  triggers: Record<
    string,
    {
      key: string;
      noun: string;
      display: {
        label: string;
        description: string;
      };
      operation: ZapierOperation;
    }
  >;
  creates: Record<
    string,
    {
      key: string;
      noun: string;
      display: {
        label: string;
        description: string;
      };
      operation: ZapierOperation;
    }
  >;
};

export const ZAPIER_BASE_URL_PLACEHOLDER =
  "https://app.exponential.example.com";

const DEFAULT_BASE_URL = "https://app.exponential.example.com";
const DEFAULT_SCOPE =
  "read write issues:read issues:write comments:read comments:write projects:read projects:write webhooks:read webhooks:write";

const triggerSamples = {
  new_issue: {
    id: "issue_123",
    identifier: "ENG-123",
    title: "Follow up from Zapier",
    priority: "medium",
    teamKey: "ENG",
    stateName: "Backlog",
    createdAt: "2026-06-09T12:00:00.000Z",
    updatedAt: "2026-06-09T12:00:00.000Z",
  },
  updated_issue: {
    id: "issue_123",
    identifier: "ENG-123",
    title: "Follow up from Zapier",
    priority: "medium",
    teamKey: "ENG",
    stateName: "Backlog",
    createdAt: "2026-06-09T12:00:00.000Z",
    updatedAt: "2026-06-09T12:00:00.000Z",
  },
  new_comment: {
    id: "comment_123",
    issueId: "issue_123",
    issueIdentifier: "ENG-123",
    body: "Customer asked for an export.",
    authorName: "Avery Nguyen",
    createdAt: "2026-06-09T12:00:00.000Z",
  },
  new_project: {
    id: "project_123",
    name: "Zapier launch",
    slug: "zapier-launch",
    status: "planned",
    createdAt: "2026-06-09T12:00:00.000Z",
  },
  status_change: {
    id: "issue_123",
    identifier: "ENG-123",
    title: "Follow up from Zapier",
    priority: "medium",
    teamKey: "ENG",
    stateName: "In Progress",
    createdAt: "2026-06-09T12:00:00.000Z",
    updatedAt: "2026-06-09T12:00:00.000Z",
  },
} satisfies Record<string, Record<string, unknown>>;

const triggerLabels = {
  new_issue: {
    noun: "Issue",
    label: "New Issue",
    description: "Triggers when an issue is created.",
  },
  updated_issue: {
    noun: "Issue",
    label: "Updated Issue",
    description: "Triggers when an issue is updated.",
  },
  new_comment: {
    noun: "Comment",
    label: "New Comment",
    description: "Triggers when a new issue comment is created.",
  },
  new_project: {
    noun: "Project",
    label: "New Project",
    description: "Triggers when a project is created.",
  },
  status_change: {
    noun: "Status Change",
    label: "Issue Status Changed",
    description: "Triggers when an issue workflow status changes.",
  },
} satisfies Record<
  string,
  { noun: string; label: string; description: string }
>;

const commonIssueFields: ZapierInputField[] = [
  {
    key: "title",
    label: "Title",
    required: true,
    type: "string",
  },
  {
    key: "teamKey",
    label: "Team Key",
    type: "string",
    helpText: "Use either Team Key or Team ID.",
  },
  {
    key: "teamId",
    label: "Team ID",
    type: "string",
    helpText: "Use either Team ID or Team Key.",
  },
  {
    key: "description",
    label: "Description",
    type: "text",
  },
  {
    key: "stateId",
    label: "Workflow State ID",
    type: "string",
  },
  {
    key: "priority",
    label: "Priority",
    type: "string",
    choices: {
      none: "None",
      urgent: "Urgent",
      high: "High",
      medium: "Medium",
      low: "Low",
    },
  },
  {
    key: "assigneeId",
    label: "Assignee User ID",
    type: "string",
  },
  {
    key: "projectId",
    label: "Project ID",
    type: "string",
  },
  {
    key: "dueDate",
    label: "Due Date",
    type: "datetime",
  },
];

function baseUrl(bundle: ZapierBundle) {
  return (
    bundle.authData?.baseUrl?.replace(/\/+$/g, "") ||
    process.env.ZAPIER_EXPONENTIAL_BASE_URL ||
    DEFAULT_BASE_URL
  );
}

function authHeaders(bundle: ZapierBundle): Record<string, string> {
  const token = bundle.authData?.access_token || bundle.authData?.api_key;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function parseError(response: ZapierResponse) {
  if (
    response.json &&
    typeof response.json === "object" &&
    "error" in response.json
  ) {
    const payload = response.json as {
      error?: string | { code?: string; message?: string; field?: string };
    };
    if (typeof payload.error === "string") {
      return payload.error;
    }
    if (payload.error?.message) {
      return [
        payload.error.message,
        payload.error.field ? `Field: ${payload.error.field}.` : "",
        payload.error.code ? `Code: ${payload.error.code}.` : "",
      ]
        .filter(Boolean)
        .join(" ");
    }
  }

  return (
    response.content || `Exponential API request failed (${response.status}).`
  );
}

async function requestExponential(
  z: ZapierZ,
  bundle: ZapierBundle,
  options: Omit<ZapierRequestOptions, "url"> & { path: string },
) {
  const response = await z.request({
    url: `${baseUrl(bundle)}${options.path}`,
    method: options.method ?? "GET",
    params: options.params,
    headers: {
      ...authHeaders(bundle),
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    body: options.body,
  });

  if (response.status >= 400) {
    throw new Error(parseError(response));
  }

  return response.json;
}

function pollTrigger(triggerKey: keyof typeof triggerSamples) {
  return (z: ZapierZ, bundle: ZapierBundle) =>
    requestExponential(z, bundle, {
      path: `/api/zapier/triggers/${triggerKey}`,
      params: {
        since:
          typeof bundle.inputData?.since === "string"
            ? bundle.inputData.since
            : undefined,
        limit:
          typeof bundle.inputData?.limit === "number" ||
          typeof bundle.inputData?.limit === "string"
            ? bundle.inputData.limit
            : undefined,
      },
    });
}

function subscribeTrigger(triggerKey: keyof typeof triggerSamples) {
  return (z: ZapierZ, bundle: ZapierBundle) =>
    requestExponential(z, bundle, {
      path: "/api/zapier/hooks/subscribe",
      method: "POST",
      body: {
        trigger: triggerKey,
        targetUrl: bundle.targetUrl,
      },
    });
}

function unsubscribeTrigger(z: ZapierZ, bundle: ZapierBundle) {
  return requestExponential(z, bundle, {
    path: "/api/zapier/hooks/unsubscribe",
    method: "POST",
    body: {
      id: bundle.subscribeData?.id,
    },
  });
}

function createTrigger(triggerKey: keyof typeof triggerSamples) {
  const display = triggerLabels[triggerKey];

  return {
    key: triggerKey,
    noun: display.noun,
    display: {
      label: display.label,
      description: display.description,
    },
    operation: {
      inputFields: [
        {
          key: "since",
          label: "Created or Updated After",
          type: "datetime",
          required: false,
        },
        {
          key: "limit",
          label: "Limit",
          type: "integer",
          required: false,
        },
      ],
      perform: pollTrigger(triggerKey),
      performList: pollTrigger(triggerKey),
      performSubscribe: subscribeTrigger(triggerKey),
      performUnsubscribe: unsubscribeTrigger,
      sample: triggerSamples[triggerKey],
    },
  };
}

function createAction(
  key: string,
  noun: string,
  label: string,
  description: string,
  inputFields: ZapierInputField[],
) {
  return {
    key,
    noun,
    display: {
      label,
      description,
    },
    operation: {
      inputFields,
      perform: (z: ZapierZ, bundle: ZapierBundle) =>
        requestExponential(z, bundle, {
          path: `/api/zapier/actions/${key}`,
          method: "POST",
          body: bundle.inputData ?? {},
        }),
    },
  };
}

const app: ZapierAppDefinition = {
  version: "1.0.0",
  platformVersion: "15.0.0",
  authentication: {
    type: "oauth2",
    fields: [
      {
        key: "baseUrl",
        label: "Exponential Base URL",
        required: true,
        type: "string",
        helpText: `Use ${ZAPIER_BASE_URL_PLACEHOLDER} for production, or your self-hosted HTTPS origin.`,
      },
    ],
    test: (z, bundle) =>
      requestExponential(z, bundle, { path: "/api/zapier/auth/test" }),
    oauth2Config: {
      authorizeUrl: (bundle) => ({
        url: `${baseUrl(bundle)}/api/oauth/authorize`,
        params: {
          response_type: "code",
          client_id: "{{bundle.inputData.client_id}}",
          redirect_uri: "{{bundle.inputData.redirect_uri}}",
          state: "{{bundle.inputData.state}}",
          scope: DEFAULT_SCOPE,
        },
      }),
      getAccessToken: (z, bundle) =>
        requestExponential(z, bundle, {
          path: "/api/oauth/token",
          method: "POST",
          body: {
            grant_type: "authorization_code",
            code: bundle.inputData?.code,
            client_id: bundle.inputData?.client_id,
            client_secret: bundle.inputData?.client_secret,
            redirect_uri: bundle.inputData?.redirect_uri,
          },
        }),
      autoRefresh: false,
    },
  },
  triggers: {
    new_issue: createTrigger("new_issue"),
    updated_issue: createTrigger("updated_issue"),
    new_comment: createTrigger("new_comment"),
    new_project: createTrigger("new_project"),
    status_change: createTrigger("status_change"),
  },
  creates: {
    create_issue: createAction(
      "create_issue",
      "Issue",
      "Create Issue",
      "Creates an Exponential issue.",
      commonIssueFields,
    ),
    update_issue: createAction(
      "update_issue",
      "Issue",
      "Update Issue",
      "Updates editable Exponential issue fields.",
      [
        {
          key: "issueId",
          label: "Issue ID or Identifier",
          required: true,
          type: "string",
        },
        ...commonIssueFields.filter((field) =>
          typeof field === "string"
            ? field !== "teamKey" && field !== "teamId"
            : field.key !== "teamKey" && field.key !== "teamId",
        ),
      ],
    ),
    create_comment: createAction(
      "create_comment",
      "Comment",
      "Create Comment",
      "Creates a comment on an Exponential issue.",
      [
        {
          key: "issueId",
          label: "Issue ID or Identifier",
          required: true,
          type: "string",
        },
        { key: "body", label: "Body", required: true, type: "text" },
      ],
    ),
    create_attachment: createAction(
      "create_attachment",
      "Attachment",
      "Create Link Attachment",
      "Adds a link attachment to an Exponential issue as a comment.",
      [
        {
          key: "issueId",
          label: "Issue ID or Identifier",
          required: true,
          type: "string",
        },
        { key: "url", label: "URL", required: true, type: "string" },
        { key: "title", label: "Title", required: false, type: "string" },
        { key: "note", label: "Note", required: false, type: "text" },
      ],
    ),
    create_project: createAction(
      "create_project",
      "Project",
      "Create Project",
      "Creates an Exponential project.",
      [
        { key: "name", label: "Name", required: true, type: "string" },
        { key: "slug", label: "Slug", required: false, type: "string" },
        {
          key: "description",
          label: "Description",
          required: false,
          type: "text",
        },
        {
          key: "status",
          label: "Status",
          required: false,
          type: "string",
          choices: {
            planned: "Planned",
            started: "Started",
            paused: "Paused",
            completed: "Completed",
            canceled: "Canceled",
          },
        },
        {
          key: "teamKey",
          label: "Team Key",
          required: false,
          type: "string",
        },
        {
          key: "teamId",
          label: "Team ID",
          required: false,
          type: "string",
        },
      ],
    ),
  },
};

export default app;
