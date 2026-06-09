export type IntegrationPriority = "P0" | "P1" | "P2" | "P3";

export type IntegrationRoadmapStatus =
  | "build_issue"
  | "parent_tracking"
  | "out_of_scope";

export type IntegrationPlanningDetails = {
  setup: string;
  dataModel: string;
  runtime: string;
  permissions: string;
  adminUx: string;
};

export type IntegrationRoadmapItem = {
  id: string;
  priority: IntegrationPriority;
  buildOrder: number;
  name: string;
  provider: string | null;
  category: string;
  status: IntegrationRoadmapStatus;
  issue: {
    number: number;
    title: string;
    url: string;
  };
  parentIssue: number;
  scope: string;
  planning: IntegrationPlanningDetails;
  acceptanceCriteria: string[];
  validationPlan: string[];
};

export const INTEGRATION_PRIORITY_LABELS: Record<IntegrationPriority, string> =
  {
    P0: "P0 - build first",
    P1: "P1 - core product parity",
    P2: "P2 - high-value ecosystem parity",
    P3: "P3 - analytics/expansion",
  };

const issueUrl = (issueNumber: number) =>
  `https://github.com/namuh-eng/exponential/issues/${issueNumber}`;

export const LINEAR_INTEGRATION_ROADMAP: IntegrationRoadmapItem[] = [
  {
    id: "integration-platform",
    priority: "P0",
    buildOrder: 10,
    name: "Shared integration platform",
    provider: null,
    category: "Platform",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 568,
      title:
        "P0 Integration platform: provider lifecycle, secrets, sync jobs, and admin health",
      url: issueUrl(568),
    },
    scope:
      "Provider lifecycle, encrypted secrets, sync job scheduling, and admin health primitives shared by every integration.",
    planning: {
      setup:
        "Workspace-scoped install records, setup checkpoints, secret validation, and reconnect flows.",
      dataModel:
        "Provider installations, credentials, sync jobs, health checks, event deliveries, and audit events.",
      runtime:
        "Common OAuth/webhook adapters, background job orchestration, retries, and dead-letter handling.",
      permissions:
        "Workspace admin install/manage rights with member-level attribution for connected accounts.",
      adminUx:
        "Integration catalog, connected provider detail, health state, reconnect, disconnect, and job history views.",
    },
    acceptanceCriteria: [
      "Admins can see each provider lifecycle state and health status.",
      "Secrets and sync jobs use shared platform primitives instead of provider-specific one-offs.",
    ],
    validationPlan: [
      "Exercise install, reconnect, disconnect, job retry, and health-state transitions with a real workspace.",
      "Run route coverage for permission checks and provider lifecycle state serialization.",
    ],
  },
  {
    id: "github-app-install",
    priority: "P0",
    buildOrder: 20,
    name: "GitHub App installation and mapping",
    provider: "github",
    category: "Code hosting",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 569,
      title:
        "P0 GitHub: GitHub App install, organization/repository mapping, and webhook receiver",
      url: issueUrl(569),
    },
    scope:
      "GitHub App install, organization and repository mapping, webhook intake, and personal account attribution foundation.",
    planning: {
      setup:
        "GitHub App manifest/configuration, OAuth callback, installation selection, and repository access selection.",
      dataModel:
        "Installations, organizations, repositories, account links, webhook receipts, and mapping records.",
      runtime:
        "Signed GitHub webhook receiver plus installation token refresh and event persistence.",
      permissions:
        "Workspace admins install; GitHub organization owners or repository admins grant provider access.",
      adminUx:
        "Connected organizations, selected repositories, personal connection prompts, and webhook health.",
    },
    acceptanceCriteria: [
      "Admins can connect a GitHub organization and map repositories to the workspace.",
      "Webhook receipts are verified, stored, and visible in integration health.",
    ],
    validationPlan: [
      "Install the app in a test GitHub organization and verify repository mapping persists.",
      "Send signed GitHub webhook fixtures through the receiver and verify accepted/rejected outcomes.",
    ],
  },
  {
    id: "github-pr-commit-automation",
    priority: "P0",
    buildOrder: 30,
    name: "GitHub PR and commit automation",
    provider: "github",
    category: "Code hosting",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 570,
      title:
        "P0 GitHub: PR/commit linking, magic words, and workflow status automation",
      url: issueUrl(570),
    },
    scope:
      "PR/commit linking, magic words, preview links, review state, and workflow status automation.",
    planning: {
      setup:
        "Team workflow automation settings, branch format preferences, and magic-word policy.",
      dataModel:
        "External PRs, commits, linked issue references, review state, preview links, and automation runs.",
      runtime:
        "GitHub pull request, check, review, push, and commit event processors.",
      permissions:
        "Repository read/write issue and pull request permissions with member attribution through account links.",
      adminUx:
        "Team automation controls, linked PR attachments, sync errors, and unlink actions.",
    },
    acceptanceCriteria: [
      "Issues link from branch names, PR titles/descriptions, and commit magic words.",
      "Workflow status changes follow configured PR and commit automation rules.",
    ],
    validationPlan: [
      "Create real PR and commit fixtures against a test repository and verify issue links and state transitions.",
      "Run parser coverage for closing and non-closing magic words.",
    ],
  },
  {
    id: "slack-install-events",
    priority: "P0",
    buildOrder: 40,
    name: "Slack installation and event runtime",
    provider: "slack",
    category: "Communication",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 572,
      title:
        "P0 Slack: OAuth callback, bot token storage, signed event receiver, and delivery worker",
      url: issueUrl(572),
    },
    scope:
      "Slack OAuth install, bot token storage, signed event receiver, delivery worker, and channel mapping.",
    planning: {
      setup:
        "Slack app credentials, OAuth scopes, callback, workspace install, and channel selection.",
      dataModel:
        "Slack workspaces, bot tokens, channels, user links, event receipts, and delivery attempts.",
      runtime:
        "Slack signed request verification, Events API receiver, delayed response handling, and outbound worker.",
      permissions:
        "Workspace admins install; Slack scopes are constrained to channels, commands, chat, and user identity needed for events.",
      adminUx:
        "Workspace Slack connection, team channel settings, event toggles, delivery status, and disconnect.",
    },
    acceptanceCriteria: [
      "Admins can install Slack and select team notification channels.",
      "Signed Slack events are verified and queued for delivery processing.",
    ],
    validationPlan: [
      "Complete Slack OAuth in a test workspace and save a team channel mapping.",
      "Replay signed Slack event fixtures and verify invalid signatures are rejected.",
    ],
  },
  {
    id: "slack-asks-issue-creation",
    priority: "P0",
    buildOrder: 50,
    name: "Slack issue creation and Asks intake",
    provider: "slack",
    category: "Communication",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 573,
      title: "P0 Slack: create issues and Asks from Slack messages",
      url: issueUrl(573),
    },
    scope:
      "Create issues and Asks from Slack messages, preserve source context, and sync intake decisions back to Slack.",
    planning: {
      setup:
        "Slack shortcuts, message actions, slash commands, Asks routing settings, and default team mappings.",
      dataModel:
        "Ask records, source messages, created issue links, requester identity, channel/thread metadata, and triage decisions.",
      runtime:
        "Slack interaction handlers, issue creation pipeline, thread update delivery, and idempotency guards.",
      permissions:
        "Workspace-level install plus team routing permissions and requester attribution through Slack account links.",
      adminUx:
        "Asks routing controls, default issue metadata, message source links, and delivery error surfacing.",
    },
    acceptanceCriteria: [
      "Slack users can create tracked issues or Asks from messages without duplicate records.",
      "Created issues retain requester, channel, thread, and source-message context.",
    ],
    validationPlan: [
      "Submit real Slack interaction payloads and verify issue/Ask creation in a test workspace.",
      "Exercise duplicate payload replay to prove idempotent handling.",
    ],
  },
  {
    id: "outbound-webhooks",
    priority: "P0",
    buildOrder: 60,
    name: "Outbound webhooks",
    provider: "webhooks",
    category: "Developer platform",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 562,
      title: "Parity: implement outbound webhook delivery and event coverage",
      url: issueUrl(562),
    },
    scope:
      "Reliable outbound webhooks for ecosystem integrations, including subscriptions, signing, delivery, retries, and event coverage.",
    planning: {
      setup:
        "Webhook endpoint registration, event subscription selection, signing secret creation, and test delivery.",
      dataModel:
        "Webhook endpoints, event subscriptions, delivery attempts, signatures, retry state, and failure summaries.",
      runtime:
        "Event fanout, HMAC signing, retry backoff, timeout handling, and dead-letter recovery.",
      permissions:
        "Workspace admins manage endpoints; API keys and service roles can emit eligible events.",
      adminUx:
        "Endpoint list, delivery logs, retry controls, failure badges, and event coverage documentation.",
    },
    acceptanceCriteria: [
      "Subscribed workspace events deliver with signatures and durable retry history.",
      "Admins can inspect delivery successes, failures, and retry outcomes.",
    ],
    validationPlan: [
      "Deliver real webhook payloads to a local receiver and verify signature, retry, and timeout behavior.",
      "Run API route tests for endpoint CRUD and permission enforcement.",
    ],
  },
  {
    id: "github-issues-sync-import",
    priority: "P1",
    buildOrder: 110,
    name: "GitHub Issues sync and guided import",
    provider: "github",
    category: "Code hosting",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 571,
      title: "P1 GitHub: forward-looking GitHub Issues two-way sync",
      url: issueUrl(571),
    },
    scope:
      "Forward-looking GitHub Issues one-way and two-way sync plus guided import handoff for historical issues.",
    planning: {
      setup:
        "Repository-to-team sync mapping, sync direction selection, and importer entry point.",
      dataModel:
        "External issue links, synced threads, field mappings, sync cursors, conflict records, and import jobs.",
      runtime:
        "GitHub issue/comment processors, Linear issue mutation sync, conflict handling, and importer orchestration.",
      permissions:
        "Repository issue read/write permissions and workspace admin control over sync mappings.",
      adminUx:
        "Repository sync mappings, issue sync banners, error details, manual unlink, and import progress.",
    },
    acceptanceCriteria: [
      "New GitHub issues can sync into mapped teams and optionally sync back to GitHub.",
      "Comments and supported issue fields preserve clear sync status and error banners.",
    ],
    validationPlan: [
      "Create issues and comments in a mapped test repository and verify synced Linear records.",
      "Run guided import preview and job execution for historical GitHub issues.",
    ],
  },
  {
    id: "jira-sync-import",
    priority: "P1",
    buildOrder: 120,
    name: "Jira sync and guided import",
    provider: "jira",
    category: "Issue trackers",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 580,
      title: "P1 Jira: Jira Cloud/Server sync plus guided importer",
      url: issueUrl(580),
    },
    scope:
      "Jira Cloud and Server sync, mapping, and guided importer for projects, issues, labels, users, and comments.",
    planning: {
      setup:
        "Jira site connection, project selection, field mapping, import preview, and sync direction settings.",
      dataModel:
        "Jira sites, projects, issue mappings, user mappings, field mappings, import jobs, and sync cursors.",
      runtime:
        "Jira webhook receiver, scheduled sync, importer jobs, conflict detection, and rate-limit handling.",
      permissions:
        "Workspace admins configure; Jira project permissions determine readable and writable issue fields.",
      adminUx:
        "Guided importer, mapping review, sync health, conflict list, and reconnect flow.",
    },
    acceptanceCriteria: [
      "Admins can preview and run a Jira import before enabling sync.",
      "Mapped Jira issue changes sync into Exponential with clear conflict handling.",
    ],
    validationPlan: [
      "Run a guided import against a test Jira project and verify imported issues and mappings.",
      "Replay Jira webhook fixtures and verify sync cursor and conflict behavior.",
    ],
  },
  {
    id: "gitlab-mr-automation",
    priority: "P1",
    buildOrder: 130,
    name: "GitLab merge request automation",
    provider: "gitlab",
    category: "Code hosting",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 581,
      title: "P1 GitLab: merge request linking and workflow automation",
      url: issueUrl(581),
    },
    scope:
      "GitLab group/project install, merge request linking, commit references, and workflow status automation.",
    planning: {
      setup:
        "GitLab OAuth/application setup, group/project selection, webhook secret, and team automation preferences.",
      dataModel:
        "GitLab groups, projects, merge requests, commits, account links, webhook receipts, and automation runs.",
      runtime:
        "Signed GitLab webhook receiver, MR/commit parser, status transition worker, and retry handling.",
      permissions:
        "Workspace admins configure; GitLab project permissions gate project and merge request access.",
      adminUx:
        "Connected groups/projects, linked MR attachments, workflow automation settings, and webhook health.",
    },
    acceptanceCriteria: [
      "Merge requests link to issues through branch, title, or description references.",
      "Linked issue status updates follow configured GitLab workflow automation rules.",
    ],
    validationPlan: [
      "Open and merge a test GitLab merge request and verify issue link/state transitions.",
      "Replay GitLab push and merge request webhook fixtures through the receiver.",
    ],
  },
  {
    id: "customer-requests-base",
    priority: "P1",
    buildOrder: 140,
    name: "Customer Requests base model",
    provider: "customer-requests",
    category: "Support",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 556,
      title:
        "Parity: add Customer Requests data model, customer pages, and issue/project linking",
      url: issueUrl(556),
    },
    scope:
      "Shared customer request records, customer pages, source attribution, and issue/project linking for support providers.",
    planning: {
      setup:
        "Workspace customer request enablement, source provider defaults, and linking configuration.",
      dataModel:
        "Customers, customer contacts, customer requests, source records, linked issues/projects, and status changes.",
      runtime:
        "Provider-neutral request creation, link/unlink handling, status propagation, and deduplication.",
      permissions:
        "Workspace admins configure; members link requests to issues and projects according to team access.",
      adminUx:
        "Customer list, customer detail, request detail, issue/project links, and source-provider filters.",
    },
    acceptanceCriteria: [
      "Customer requests can be created and linked to issues or projects independent of provider.",
      "Customer pages show request status, source context, and linked work.",
    ],
    validationPlan: [
      "Create customer requests through API and UI flows and verify issue/project linking.",
      "Run provider-neutral tests for dedupe, status updates, and permission checks.",
    ],
  },
  {
    id: "zendesk-customer-requests",
    priority: "P1",
    buildOrder: 150,
    name: "Zendesk tickets to customer requests",
    provider: "zendesk",
    category: "Support",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 575,
      title:
        "P1 Zendesk: create/link issues from tickets and sync closure updates",
      url: issueUrl(575),
    },
    scope:
      "Create and link issues from Zendesk tickets, generate customer requests, and sync closure updates.",
    planning: {
      setup:
        "Zendesk subdomain OAuth/API token setup, trigger/webhook installation, and ticket field mapping.",
      dataModel:
        "Zendesk accounts, tickets, request links, customer mappings, issue links, and sync events.",
      runtime:
        "Zendesk webhook receiver, ticket-to-request creation, closure sync worker, and retry handling.",
      permissions:
        "Workspace admins connect Zendesk; support agent identity maps through provider account links when available.",
      adminUx:
        "Zendesk connection status, ticket link previews, default team routing, and sync error list.",
    },
    acceptanceCriteria: [
      "Zendesk tickets can create or link Exponential issues and customer requests.",
      "Issue closure updates sync back to linked Zendesk tickets.",
    ],
    validationPlan: [
      "Exercise ticket create/link flow against a test Zendesk account.",
      "Replay Zendesk ticket webhook fixtures and verify customer request and closure sync behavior.",
    ],
  },
  {
    id: "intercom-customer-requests",
    priority: "P1",
    buildOrder: 160,
    name: "Intercom conversations to customer requests",
    provider: "intercom",
    category: "Support",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 576,
      title:
        "P1 Intercom: create/link issues from conversations and create customer requests",
      url: issueUrl(576),
    },
    scope:
      "Create/link issues from Intercom conversations and create customer requests with customer context.",
    planning: {
      setup:
        "Intercom app OAuth, workspace selection, conversation action setup, and default routing.",
      dataModel:
        "Intercom workspaces, conversations, contacts, request links, issue links, and sync cursors.",
      runtime:
        "Intercom webhook/action handlers, request creation, issue link updates, and conversation note delivery.",
      permissions:
        "Workspace admins install; Intercom teammate identity maps to connected accounts where available.",
      adminUx:
        "Connection health, default issue metadata, conversation source previews, and sync errors.",
    },
    acceptanceCriteria: [
      "Intercom conversations can create or link issues and customer requests.",
      "Linked work status is visible from the Exponential customer request context.",
    ],
    validationPlan: [
      "Trigger Intercom conversation actions against a test workspace and verify request creation.",
      "Replay Intercom webhook fixtures for conversation updates and idempotency.",
    ],
  },
  {
    id: "front-customer-requests",
    priority: "P1",
    buildOrder: 170,
    name: "Front conversations to customer requests",
    provider: "front",
    category: "Support",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 577,
      title:
        "P1 Front: create/link issues from conversations and reopen on resolution",
      url: issueUrl(577),
    },
    scope:
      "Create/link issues from Front conversations, create customer requests, and reopen support conversations on resolution.",
    planning: {
      setup:
        "Front API token/OAuth setup, inbox selection, rule/webhook configuration, and default routing.",
      dataModel:
        "Front accounts, conversations, contacts, inboxes, request links, issue links, and resolution sync state.",
      runtime:
        "Front webhook receiver, conversation action handling, request creation, and resolution sync worker.",
      permissions:
        "Workspace admins configure; inbox access determines visible conversations and updates.",
      adminUx:
        "Connected inboxes, default team routing, linked conversation previews, and reopen/sync status.",
    },
    acceptanceCriteria: [
      "Front conversations can create or link issues and customer requests.",
      "Resolved Exponential work can update or reopen linked Front conversations as configured.",
    ],
    validationPlan: [
      "Run create/link flow against a test Front inbox.",
      "Replay Front webhook fixtures and verify resolution sync and duplicate protection.",
    ],
  },
  {
    id: "sentry-linked-issues",
    priority: "P2",
    buildOrder: 210,
    name: "Sentry issue linking and auto-resolve",
    provider: "sentry",
    category: "Observability",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 582,
      title:
        "P2 Sentry: linked issues, source attachments, and auto-resolve automation",
      url: issueUrl(582),
    },
    scope:
      "Create and link Exponential issues from Sentry, attach source context, and resolve Sentry issues when work completes.",
    planning: {
      setup:
        "Sentry organization/project connection, webhook setup, and default team/project routing.",
      dataModel:
        "Sentry organizations, projects, issue links, event samples, source attachments, and resolve rules.",
      runtime:
        "Sentry webhook receiver, issue creation/linking, source attachment ingestion, and resolve worker.",
      permissions:
        "Workspace admins install; Sentry organization permissions gate readable projects and resolve actions.",
      adminUx:
        "Connected projects, issue source previews, auto-resolve settings, and sync health.",
    },
    acceptanceCriteria: [
      "Sentry issues can create/link Exponential issues with source context.",
      "Completed linked work can auto-resolve Sentry issues when enabled.",
    ],
    validationPlan: [
      "Create linked work from a test Sentry issue and verify source attachment rendering.",
      "Replay Sentry webhook fixtures for issue updates and resolve automation.",
    ],
  },
  {
    id: "figma-design-previews",
    priority: "P2",
    buildOrder: 220,
    name: "Figma design previews",
    provider: "figma",
    category: "Design",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 583,
      title: "P2 Figma: design previews and create/link issues from Figma",
      url: issueUrl(583),
    },
    scope:
      "Figma link previews, file/frame context, and create/link issue actions from Figma.",
    planning: {
      setup:
        "Figma OAuth/app setup, team or file access grant, and preview permission checks.",
      dataModel:
        "Figma files, nodes, previews, account links, issue links, and refresh timestamps.",
      runtime:
        "Figma API preview fetcher, webhook/listener where available, link unfurling, and cache refresh.",
      permissions:
        "Workspace admins configure; Figma file permissions determine preview visibility.",
      adminUx:
        "Figma connection state, preview permission warnings, linked design attachments, and reconnect.",
    },
    acceptanceCriteria: [
      "Figma URLs unfurl into useful file/frame previews on linked issues.",
      "Figma actions can create or link Exponential issues with design context.",
    ],
    validationPlan: [
      "Link a real test Figma file/frame and verify preview metadata and permission fallback.",
      "Exercise create/link action payloads and duplicate handling.",
    ],
  },
  {
    id: "microsoft-teams-actions",
    priority: "P2",
    buildOrder: 230,
    name: "Microsoft Teams conversational actions",
    provider: "microsoft-teams",
    category: "Communication",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 584,
      title:
        "P2 Microsoft Teams: conversational issue/project/document actions",
      url: issueUrl(584),
    },
    scope:
      "Microsoft Teams bot and message actions for issue, project, and document workflows.",
    planning: {
      setup:
        "Teams app registration, bot credentials, tenant consent, and channel/team installation.",
      dataModel:
        "Teams tenants, teams, channels, users, message links, action requests, and delivery attempts.",
      runtime:
        "Bot Framework event handling, command parser, card rendering, and delivery worker.",
      permissions:
        "Workspace admins connect; Microsoft tenant/admin consent governs bot and channel access.",
      adminUx:
        "Teams installation status, channel routing, command availability, and delivery errors.",
    },
    acceptanceCriteria: [
      "Teams users can run conversational actions for issues, projects, and documents.",
      "Messages link back to Exponential work with clear attribution.",
    ],
    validationPlan: [
      "Run bot commands in a test Teams tenant and verify created/linked Exponential records.",
      "Replay Bot Framework activity fixtures for command parsing and permission errors.",
    ],
  },
  {
    id: "discord-slash-commands",
    priority: "P2",
    buildOrder: 240,
    name: "Discord slash commands",
    provider: "discord",
    category: "Communication",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 585,
      title:
        "P2 Discord: slash commands for create/search/wrap and message linking",
      url: issueUrl(585),
    },
    scope:
      "Discord slash commands for issue creation/search/wrap-up and message linking.",
    planning: {
      setup:
        "Discord application credentials, guild install, command registration, and channel mapping.",
      dataModel:
        "Discord guilds, channels, users, commands, message links, created issues, and delivery attempts.",
      runtime:
        "Signed interaction receiver, command handler, message link resolver, and response delivery.",
      permissions:
        "Workspace admins install; Discord guild permissions control command and channel access.",
      adminUx:
        "Guild/channel mapping, command status, message source links, and error delivery state.",
    },
    acceptanceCriteria: [
      "Discord slash commands can create/search/wrap work items from mapped channels.",
      "Linked Discord messages retain source context on the Exponential issue.",
    ],
    validationPlan: [
      "Run slash commands in a test Discord guild and verify issue actions.",
      "Replay signed Discord interaction fixtures and invalid signature cases.",
    ],
  },
  {
    id: "notion-rich-previews",
    priority: "P2",
    buildOrder: 250,
    name: "Notion rich previews",
    provider: "notion",
    category: "Docs",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 586,
      title: "P2 Notion: rich previews for Exponential issues/projects/views",
      url: issueUrl(586),
    },
    scope:
      "Notion previews for Exponential issues, projects, and views, including permissions and refresh behavior.",
    planning: {
      setup:
        "Notion integration OAuth, workspace/page access grant, and preview block configuration.",
      dataModel:
        "Notion workspaces, pages, preview embeds, linked Exponential resources, and refresh metadata.",
      runtime:
        "Preview API endpoint, Notion link expansion, refresh job, and permission-aware fallback.",
      permissions:
        "Workspace admins connect; Notion page permissions determine which previews render.",
      adminUx:
        "Connected Notion workspace, preview status, permission warnings, and disconnect.",
    },
    acceptanceCriteria: [
      "Notion can show rich previews for linked Exponential resources.",
      "Preview rendering respects resource and Notion page permissions.",
    ],
    validationPlan: [
      "Embed test Exponential resources in Notion and verify preview content and permission fallback.",
      "Run API coverage for preview token validation and stale refresh behavior.",
    ],
  },
  {
    id: "zapier-public-app",
    priority: "P2",
    buildOrder: 260,
    name: "Zapier public app",
    provider: "zapier",
    category: "Automation",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 589,
      title: "P2 Zapier: public Zapier app with triggers and actions",
      url: issueUrl(589),
    },
    scope:
      "Public Zapier app with authenticated triggers and actions for common workspace automation.",
    planning: {
      setup:
        "Zapier app auth, API key/OAuth connection, trigger subscriptions, and action field schemas.",
      dataModel:
        "Zapier connections, trigger subscriptions, action invocations, delivery state, and API keys.",
      runtime:
        "Trigger polling/webhook endpoints, action handlers, auth validation, and rate-limit handling.",
      permissions:
        "Workspace admins approve connections; API scopes constrain trigger and action capabilities.",
      adminUx:
        "Zapier connection visibility, API scope controls, event coverage, and delivery diagnostics.",
    },
    acceptanceCriteria: [
      "Zapier users can authenticate and run supported triggers and actions.",
      "Workspace admins can inspect connected Zapier app access and revoke it.",
    ],
    validationPlan: [
      "Run Zapier CLI validation and execute trigger/action flows against a test workspace.",
      "Exercise API auth and scope failures with real API keys.",
    ],
  },
  {
    id: "mcp-server",
    priority: "P2",
    buildOrder: 270,
    name: "Remote MCP server",
    provider: "mcp",
    category: "Developer platform",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 590,
      title: "P2 MCP server: authenticated remote MCP tools for workspace data",
      url: issueUrl(590),
    },
    scope:
      "Authenticated remote MCP tools for workspace data, safe mutations, and agent-readable context.",
    planning: {
      setup:
        "MCP endpoint configuration, OAuth/API token auth, workspace selection, and tool scope selection.",
      dataModel:
        "MCP clients, tokens, tool grants, audit events, and rate-limit state.",
      runtime:
        "MCP protocol server, tool handlers, auth middleware, audit logging, and streaming/error handling.",
      permissions:
        "Workspace admins grant access; tool scopes limit read/write workspace operations.",
      adminUx:
        "MCP client list, tool scope management, token rotation, audit log, and revoke actions.",
    },
    acceptanceCriteria: [
      "Authenticated MCP clients can read allowed workspace data through documented tools.",
      "Mutating tools enforce scopes and leave auditable records.",
    ],
    validationPlan: [
      "Connect a real MCP client and execute read/write tools against a test workspace.",
      "Run protocol tests for auth failures, scope failures, and malformed tool calls.",
    ],
  },
  {
    id: "ai-agent-surfaces",
    priority: "P2",
    buildOrder: 280,
    name: "AI Agent integration surfaces",
    provider: "ai-agents",
    category: "AI",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 591,
      title:
        "P2 AI Agents integration surfaces: Slack/Teams/support-provider actions and review gates",
      url: issueUrl(591),
    },
    scope:
      "AI Agent actions from Slack, Teams, and support providers with review gates before mutating work.",
    planning: {
      setup:
        "Agent action enablement, provider routing, review gate policy, and allowed workspace actions.",
      dataModel:
        "Agent action requests, approvals, provider source context, execution records, and audit events.",
      runtime:
        "Provider action adapters, review gate orchestration, agent execution handoff, and result delivery.",
      permissions:
        "Workspace admins configure; reviewer roles approve sensitive agent actions.",
      adminUx:
        "Agent integration settings, review queue, provider source links, execution logs, and failure states.",
    },
    acceptanceCriteria: [
      "Provider-originated agent actions require the configured review gate before execution.",
      "Agent results are delivered back to the source provider with audit history.",
    ],
    validationPlan: [
      "Trigger agent actions from test provider payloads and verify review/approval behavior.",
      "Run real workspace agent execution scenarios with provider result delivery.",
    ],
  },
  {
    id: "salesforce-status",
    priority: "P2",
    buildOrder: 290,
    name: "Salesforce case status",
    provider: "salesforce",
    category: "CRM",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 578,
      title:
        "P2 Salesforce: link cases to issues/projects and surface realtime status",
      url: issueUrl(578),
    },
    scope:
      "Link Salesforce cases to issues/projects and surface real-time status back to customer-facing teams.",
    planning: {
      setup:
        "Salesforce connected app, org OAuth, object/field mapping, and case layout configuration.",
      dataModel:
        "Salesforce orgs, cases, accounts, issue/project links, status mirrors, and sync cursors.",
      runtime:
        "Salesforce webhook/platform event or polling sync, status projection, and update delivery.",
      permissions:
        "Workspace admins connect; Salesforce object permissions gate case/account visibility.",
      adminUx:
        "Org connection, field mapping, linked case previews, status sync health, and reconnect.",
    },
    acceptanceCriteria: [
      "Salesforce cases can link to Exponential issues and projects.",
      "Customer-facing status mirrors update when linked work changes.",
    ],
    validationPlan: [
      "Link a test Salesforce case to issue/project records and verify status projection.",
      "Exercise Salesforce sync fixtures for update, permission, and reconnect paths.",
    ],
  },
  {
    id: "google-sheets-export",
    priority: "P3",
    buildOrder: 310,
    name: "Google Sheets scheduled exports",
    provider: "google-sheets",
    category: "Analytics",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 587,
      title: "P3 Google Sheets: scheduled issue/project/initiative export sync",
      url: issueUrl(587),
    },
    scope:
      "Scheduled export sync for issues, projects, and initiatives into Google Sheets.",
    planning: {
      setup:
        "Google OAuth, spreadsheet selection/creation, worksheet mapping, and schedule configuration.",
      dataModel:
        "Google accounts, spreadsheets, worksheet mappings, export jobs, cursors, and failure records.",
      runtime:
        "Scheduled export worker, Sheets API writer, schema drift handling, and retry logic.",
      permissions:
        "Workspace admins configure; Google Drive/Sheets scopes are limited to selected spreadsheets.",
      adminUx:
        "Sheet mapping, schedule controls, last run status, manual run, and reconnect.",
    },
    acceptanceCriteria: [
      "Admins can schedule issue/project/initiative exports to a selected Google Sheet.",
      "Export jobs report last run status and recover from retryable Sheets API errors.",
    ],
    validationPlan: [
      "Run an export to a test Google Sheet and verify rows and update behavior.",
      "Exercise scheduled worker and API error retry scenarios.",
    ],
  },
  {
    id: "airbyte-source",
    priority: "P3",
    buildOrder: 320,
    name: "Airbyte read-only source connector",
    provider: "airbyte",
    category: "Analytics",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 588,
      title: "P3 Airbyte: read-only source connector for warehouse sync",
      url: issueUrl(588),
    },
    scope:
      "Read-only Airbyte source connector for warehouse sync of workspace operational data.",
    planning: {
      setup:
        "Airbyte connector manifest, API credentials, stream selection, and incremental sync configuration.",
      dataModel:
        "Connector clients, stream cursors, schema versions, API keys, and sync audit records.",
      runtime:
        "Read-only stream endpoints, cursor pagination, schema discovery, and rate-limit handling.",
      permissions:
        "Workspace admins issue scoped read-only credentials for analytics streams.",
      adminUx:
        "Connector credentials, stream catalog, last sync visibility, and revoke/rotate actions.",
    },
    acceptanceCriteria: [
      "Airbyte can discover and sync supported read-only workspace streams.",
      "Incremental sync uses stable cursors and scoped credentials.",
    ],
    validationPlan: [
      "Run Airbyte connector acceptance tests against a test workspace.",
      "Verify stream discovery, incremental cursor behavior, and credential revocation.",
    ],
  },
  {
    id: "gong-customer-call-context",
    priority: "P3",
    buildOrder: 330,
    name: "Gong customer call context",
    provider: "gong",
    category: "Analytics",
    status: "build_issue",
    parentIssue: 592,
    issue: {
      number: 579,
      title:
        "P3 Gong: connect customer calls to customer requests and issue context",
      url: issueUrl(579),
    },
    scope:
      "Connect Gong customer calls to customer requests and issue context for customer intelligence workflows.",
    planning: {
      setup:
        "Gong API/OAuth setup, workspace/account mapping, call source selection, and customer matching rules.",
      dataModel:
        "Gong accounts, calls, participants, transcript references, customer mappings, and linked requests/issues.",
      runtime:
        "Gong call ingestion, customer matching, request/issue link suggestions, and refresh scheduling.",
      permissions:
        "Workspace admins configure; Gong permissions and transcript access govern visible call context.",
      adminUx:
        "Gong connection, account mapping, call context previews, link suggestions, and sync health.",
    },
    acceptanceCriteria: [
      "Gong calls can attach customer context to requests and related issues.",
      "Call context respects Gong access and Exponential workspace permissions.",
    ],
    validationPlan: [
      "Ingest calls from a test Gong account and verify customer request/issue context.",
      "Exercise transcript access failures and customer matching edge cases.",
    ],
  },
  {
    id: "third-party-directory",
    priority: "P3",
    buildOrder: 340,
    name: "Third-party integration directory",
    provider: null,
    category: "Ecosystem",
    status: "parent_tracking",
    parentIssue: 592,
    issue: {
      number: 592,
      title:
        "P0 Integration parity roadmap: Linear provider backlog and build order",
      url: issueUrl(592),
    },
    scope:
      "Directory-level ecosystem work is tracked at the parent level until outbound webhooks, Zapier, MCP, and public API surfaces are ready.",
    planning: {
      setup:
        "Submission and listing workflow remains deferred until stable extension surfaces exist.",
      dataModel:
        "Directory listings, ownership metadata, categories, permissions summary, and review status.",
      runtime:
        "No provider runtime in this slice; runtime depends on public extension surfaces.",
      permissions:
        "Workspace admins install third-party integrations after marketplace trust and permission review.",
      adminUx:
        "Future directory browse/install experience with provider ownership and permission summaries.",
    },
    acceptanceCriteria: [
      "Parent roadmap keeps third-party directory work visible without implying individual provider commitments.",
      "Extension surfaces have explicit build issues before directory listing work starts.",
    ],
    validationPlan: [
      "Review directory readiness after outbound webhooks, Zapier, MCP, and public API scopes land.",
      "Validate marketplace listing/install flows when directory implementation begins.",
    ],
  },
];

export const INTEGRATION_ROADMAP_PHASES = (
  Object.keys(INTEGRATION_PRIORITY_LABELS) as IntegrationPriority[]
).map((priority) => ({
  priority,
  label: INTEGRATION_PRIORITY_LABELS[priority],
  items: LINEAR_INTEGRATION_ROADMAP.filter(
    (item) => item.priority === priority,
  ).sort((a, b) => a.buildOrder - b.buildOrder),
}));

export function getIntegrationRoadmapSummary() {
  const providerIssues = LINEAR_INTEGRATION_ROADMAP.filter(
    (item) => item.status === "build_issue",
  );

  return {
    parentIssue: 592,
    totalItems: LINEAR_INTEGRATION_ROADMAP.length,
    buildIssues: providerIssues.length,
    trackedParentItems: LINEAR_INTEGRATION_ROADMAP.filter(
      (item) => item.status === "parent_tracking",
    ).length,
    priorities: INTEGRATION_ROADMAP_PHASES.map((phase) => ({
      priority: phase.priority,
      label: phase.label,
      count: phase.items.length,
    })),
  };
}
