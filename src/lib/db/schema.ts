import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ─── Enums ───────────────────────────────────────────────────────────

export const workflowStateCategory = pgEnum("workflow_state_category", [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
]);

export const issuePriority = pgEnum("issue_priority", [
  "none",
  "urgent",
  "high",
  "medium",
  "low",
]);

export const issueRelationType = pgEnum("issue_relation_type", [
  "blocks",
  "blocked_by",
  "duplicate",
  "related",
]);

export const projectStatus = pgEnum("project_status", [
  "planned",
  "started",
  "paused",
  "completed",
  "canceled",
]);

export const projectPriority = pgEnum("project_priority", [
  "none",
  "urgent",
  "high",
  "medium",
  "low",
]);

export const initiativeStatus = pgEnum("initiative_status", [
  "active",
  "planned",
  "completed",
]);

export const memberRole = pgEnum("member_role", [
  "owner",
  "admin",
  "member",
  "guest",
]);

export const workspaceInvitationStatus = pgEnum("workspace_invitation_status", [
  "pending",
  "accepted",
  "revoked",
]);

export const notificationType = pgEnum("notification_type", [
  "assigned",
  "mentioned",
  "status_change",
  "comment",
  "duplicate",
]);

export const viewLayout = pgEnum("view_layout", ["list", "board", "timeline"]);

export const issueHistoryEventType = pgEnum("issue_history_event_type", [
  "created",
  "updated",
  "comment_created",
]);

export const estimateType = pgEnum("estimate_type", [
  "not_in_use",
  "linear",
  "exponential",
  "tshirt",
]);

// ─── Better Auth Tables ──────────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const authorizedApplicationGrant = pgTable(
  "authorized_application_grant",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    appId: text("app_id").notNull(),
    clientId: text("client_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    imageUrl: text("image_url"),
    scopes: jsonb("scopes").notNull().default([]),
    webhooksEnabled: boolean("webhooks_enabled").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("authorized_application_grant_user_idx").on(t.userId),
    uniqueIndex("authorized_application_grant_user_app_idx").on(
      t.userId,
      t.appId,
    ),
  ],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const passkey = pgTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    aaguid: text("aaguid"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("passkey_user_id_idx").on(t.userId),
    uniqueIndex("passkey_credential_id_idx").on(t.credentialID),
  ],
);

// ─── Workspace ───────────────────────────────────────────────────────

export const workspace = pgTable(
  "workspace",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    urlSlug: varchar("url_slug", { length: 63 }).notNull().unique(),
    logoUrl: text("logo_url"),
    inviteLinkEnabled: boolean("invite_link_enabled").default(true),
    inviteLinkToken: text("invite_link_token"),
    approvedEmailDomains: jsonb("approved_email_domains").default([]),
    settings: jsonb("settings").default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("workspace_url_slug_idx").on(t.urlSlug)],
);

// ─── Member (workspace membership) ──────────────────────────────────

export const member = pgTable(
  "member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("member"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("member_user_workspace_idx").on(t.userId, t.workspaceId)],
);

export const workspaceInvitation = pgTable(
  "workspace_invitation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: memberRole("role").notNull().default("member"),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    status: workspaceInvitationStatus("status").notNull().default("pending"),
    acceptedAt: timestamp("accepted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("workspace_invitation_workspace_email_idx").on(
      t.workspaceId,
      t.email,
    ),
  ],
);

// ─── Team ────────────────────────────────────────────────────────────

export const team = pgTable(
  "team",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    key: varchar("key", { length: 10 }).notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    icon: text("icon"),
    isPrivate: boolean("is_private").default(false),
    timezone: varchar("timezone", { length: 100 }),
    estimateType: estimateType("estimate_type").default("not_in_use"),
    triageEnabled: boolean("triage_enabled").default(true),
    cyclesEnabled: boolean("cycles_enabled").default(false),
    cycleStartDay: integer("cycle_start_day"),
    cycleDurationWeeks: integer("cycle_duration_weeks"),
    parentTeamId: uuid("parent_team_id"),
    issueCount: integer("issue_count").default(0),
    settings: jsonb("settings").default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("team_workspace_key_idx").on(t.workspaceId, t.key),
    index("team_workspace_idx").on(t.workspaceId),
  ],
);

// ─── Team Member ─────────────────────────────────────────────────────

export const teamMember = pgTable(
  "team_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("team_member_team_user_idx").on(t.teamId, t.userId)],
);

// ─── Workflow State ──────────────────────────────────────────────────

export const workflowState = pgTable(
  "workflow_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    category: workflowStateCategory("category").notNull(),
    color: varchar("color", { length: 7 }).notNull().default("#6b6f76"),
    description: text("description"),
    position: real("position").notNull().default(0),
    isDefault: boolean("is_default").default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("workflow_state_team_idx").on(t.teamId)],
);

// ─── Label ───────────────────────────────────────────────────────────

export const label = pgTable(
  "label",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    color: varchar("color", { length: 7 }).notNull().default("#6b6f76"),
    description: text("description"),
    workspaceId: uuid("workspace_id").references(() => workspace.id, {
      onDelete: "cascade",
    }),
    teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
    parentLabelId: uuid("parent_label_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("label_workspace_idx").on(t.workspaceId),
    index("label_team_idx").on(t.teamId),
  ],
);

// ─── Project ─────────────────────────────────────────────────────────

export const project = pgTable(
  "project",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    icon: varchar("icon", { length: 10 }),
    slug: varchar("slug", { length: 255 }).notNull(),
    status: projectStatus("status").notNull().default("planned"),
    priority: projectPriority("priority").notNull().default("none"),
    leadId: text("lead_id").references(() => user.id, {
      onDelete: "set null",
    }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    startDate: timestamp("start_date"),
    targetDate: timestamp("target_date"),
    completedAt: timestamp("completed_at"),
    canceledAt: timestamp("canceled_at"),
    settings: jsonb("settings").default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("project_workspace_idx").on(t.workspaceId),
    uniqueIndex("project_workspace_slug_idx").on(t.workspaceId, t.slug),
  ],
);

// ─── Project Template ────────────────────────────────────────────────

export const projectTemplate = pgTable(
  "project_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    createdById: text("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    settings: jsonb("settings").default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("project_template_workspace_idx").on(t.workspaceId)],
);

// ─── Issue Template ─────────────────────────────────────────────────

export const issueTemplate = pgTable(
  "issue_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description").notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    createdById: text("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    settings: jsonb("settings").default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("issue_template_workspace_idx").on(t.workspaceId)],
);

// ─── Project Team (many-to-many) ─────────────────────────────────────

export const projectTeam = pgTable(
  "project_team",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("project_team_project_team_idx").on(t.projectId, t.teamId),
  ],
);

// ─── Project Member (many-to-many) ───────────────────────────────────

export const projectMember = pgTable(
  "project_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("project_member_project_user_idx").on(t.projectId, t.userId),
  ],
);

// ─── Project Milestone ───────────────────────────────────────────────

export const projectMilestone = pgTable(
  "project_milestone",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    sortOrder: real("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("project_milestone_project_idx").on(t.projectId)],
);

// ─── Cycle ───────────────────────────────────────────────────────────

export const cycle = pgTable(
  "cycle",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }),
    number: integer("number").notNull(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date").notNull(),
    autoRollover: boolean("auto_rollover").default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("cycle_team_idx").on(t.teamId)],
);

// ─── Issue ───────────────────────────────────────────────────────────

export const issue = pgTable(
  "issue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: integer("number").notNull(),
    identifier: varchar("identifier", { length: 20 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    teamId: uuid("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    stateId: uuid("state_id")
      .notNull()
      .references(() => workflowState.id),
    assigneeId: text("assignee_id").references(() => user.id, {
      onDelete: "set null",
    }),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id),
    priority: issuePriority("priority").notNull().default("none"),
    estimate: real("estimate"),
    parentIssueId: uuid("parent_issue_id"),
    projectId: uuid("project_id").references(() => project.id, {
      onDelete: "set null",
    }),
    projectMilestoneId: uuid("project_milestone_id").references(
      () => projectMilestone.id,
      { onDelete: "set null" },
    ),
    cycleId: uuid("cycle_id").references(() => cycle.id, {
      onDelete: "set null",
    }),
    dueDate: timestamp("due_date"),
    sortOrder: real("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    archivedAt: timestamp("archived_at"),
    canceledAt: timestamp("canceled_at"),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    index("issue_team_idx").on(t.teamId),
    index("issue_state_idx").on(t.stateId),
    index("issue_assignee_idx").on(t.assigneeId),
    index("issue_project_idx").on(t.projectId),
    index("issue_cycle_idx").on(t.cycleId),
    index("issue_creator_idx").on(t.creatorId),
    uniqueIndex("issue_team_number_idx").on(t.teamId, t.number),
  ],
);

// ─── Issue Label (many-to-many) ──────────────────────────────────────

export const issueLabel = pgTable(
  "issue_label",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => label.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("issue_label_issue_label_idx").on(t.issueId, t.labelId)],
);

// ─── Issue History ──────────────────────────────────────────────────

export const issueHistory = pgTable(
  "issue_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name"),
    actorEmail: text("actor_email"),
    eventType: issueHistoryEventType("event_type").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("issue_history_issue_created_idx").on(t.issueId, t.createdAt),
    index("issue_history_actor_idx").on(t.actorId),
  ],
);

// ─── Issue Relation ──────────────────────────────────────────────────

export const issueRelation = pgTable(
  "issue_relation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    relatedIssueId: uuid("related_issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    type: issueRelationType("type").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("issue_relation_issue_idx").on(t.issueId),
    index("issue_relation_related_idx").on(t.relatedIssueId),
  ],
);

// ─── Comment ─────────────────────────────────────────────────────────

export const comment = pgTable(
  "comment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    body: text("body").notNull(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("comment_issue_idx").on(t.issueId)],
);

// ─── Reaction ────────────────────────────────────────────────────────

export const issueReaction = pgTable(
  "issue_reaction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emoji: varchar("emoji", { length: 50 }).notNull(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("issue_reaction_issue_user_emoji_idx").on(
      t.issueId,
      t.userId,
      t.emoji,
    ),
    index("issue_reaction_issue_idx").on(t.issueId),
  ],
);

export const reaction = pgTable(
  "reaction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emoji: varchar("emoji", { length: 50 }).notNull(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comment.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reaction_comment_user_emoji_idx").on(
      t.commentId,
      t.userId,
      t.emoji,
    ),
  ],
);

// ─── Comment Attachment ─────────────────────────────────────────────

export const commentAttachment = pgTable(
  "comment_attachment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comment.id, { onDelete: "cascade" }),
    fileName: varchar("file_name", { length: 500 }).notNull(),
    storageKey: varchar("storage_key", { length: 1024 }).notNull(),
    contentType: varchar("content_type", { length: 255 }).notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("comment_attachment_comment_idx").on(t.commentId)],
);

// ─── Initiative ──────────────────────────────────────────────────────

export const initiative = pgTable(
  "initiative",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    status: initiativeStatus("status").notNull().default("planned"),
    settings: jsonb("settings").default({}),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    parentInitiativeId: uuid("parent_initiative_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("initiative_workspace_idx").on(t.workspaceId)],
);

// ─── Initiative Project (many-to-many) ───────────────────────────────

export const initiativeProject = pgTable(
  "initiative_project",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    initiativeId: uuid("initiative_id")
      .notNull()
      .references(() => initiative.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("initiative_project_idx").on(t.initiativeId, t.projectId),
  ],
);

// ─── Custom View ─────────────────────────────────────────────────────

export const customView = pgTable(
  "custom_view",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    filterState: jsonb("filter_state").default({}),
    layout: viewLayout("layout").notNull().default("list"),
    isPersonal: boolean("is_personal").default(true),
    teamId: uuid("team_id").references(() => team.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("custom_view_workspace_idx").on(t.workspaceId),
    index("custom_view_owner_idx").on(t.ownerId),
  ],
);

// ─── Notification ────────────────────────────────────────────────────

export const notification = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").references(() => issue.id, {
      onDelete: "cascade",
    }),
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    type: notificationType("type").notNull(),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("notification_user_idx").on(t.userId),
    index("notification_issue_idx").on(t.issueId),
  ],
);

// ─── API Key ─────────────────────────────────────────────────────────

export const apiKey = pgTable(
  "api_key",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    keyHash: text("key_hash").notNull().unique(),
    keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("api_key_workspace_idx").on(t.workspaceId)],
);

// ─── Webhook ─────────────────────────────────────────────────────────

export const webhook = pgTable(
  "webhook",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    url: text("url").notNull(),
    label: varchar("label", { length: 255 }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    secret: text("secret"),
    enabled: boolean("enabled").default(true),
    events: jsonb("events").default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("webhook_workspace_idx").on(t.workspaceId)],
);

// ─── Relations ───────────────────────────────────────────────────────

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  authorizedApplicationGrants: many(authorizedApplicationGrant),
  memberships: many(member),
  workspaceInvitations: many(workspaceInvitation),
  teamMemberships: many(teamMember),
  createdIssues: many(issue, { relationName: "creator" }),
  assignedIssues: many(issue, { relationName: "assignee" }),
  projectTemplates: many(projectTemplate),
  comments: many(comment),
  notifications: many(notification, { relationName: "recipient" }),
}));

export const authorizedApplicationGrantRelations = relations(
  authorizedApplicationGrant,
  ({ one }) => ({
    user: one(user, {
      fields: [authorizedApplicationGrant.userId],
      references: [user.id],
    }),
  }),
);

export const workspaceRelations = relations(workspace, ({ many }) => ({
  members: many(member),
  invitations: many(workspaceInvitation),
  teams: many(team),
  labels: many(label),
  projects: many(project),
  projectTemplates: many(projectTemplate),
  initiatives: many(initiative),
  customViews: many(customView),
  apiKeys: many(apiKey),
  webhooks: many(webhook),
}));

export const memberRelations = relations(member, ({ one }) => ({
  user: one(user, { fields: [member.userId], references: [user.id] }),
  workspace: one(workspace, {
    fields: [member.workspaceId],
    references: [workspace.id],
  }),
}));

export const workspaceInvitationRelations = relations(
  workspaceInvitation,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [workspaceInvitation.workspaceId],
      references: [workspace.id],
    }),
    inviter: one(user, {
      fields: [workspaceInvitation.invitedByUserId],
      references: [user.id],
    }),
  }),
);

export const teamRelations = relations(team, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [team.workspaceId],
    references: [workspace.id],
  }),
  parentTeam: one(team, {
    fields: [team.parentTeamId],
    references: [team.id],
    relationName: "parentTeam",
  }),
  childTeams: many(team, { relationName: "parentTeam" }),
  members: many(teamMember),
  workflowStates: many(workflowState),
  issues: many(issue),
  labels: many(label),
  cycles: many(cycle),
}));

export const teamMemberRelations = relations(teamMember, ({ one }) => ({
  team: one(team, { fields: [teamMember.teamId], references: [team.id] }),
  user: one(user, { fields: [teamMember.userId], references: [user.id] }),
}));

export const workflowStateRelations = relations(
  workflowState,
  ({ one, many }) => ({
    team: one(team, {
      fields: [workflowState.teamId],
      references: [team.id],
    }),
    issues: many(issue),
  }),
);

export const issueRelations = relations(issue, ({ one, many }) => ({
  team: one(team, { fields: [issue.teamId], references: [team.id] }),
  state: one(workflowState, {
    fields: [issue.stateId],
    references: [workflowState.id],
  }),
  assignee: one(user, {
    fields: [issue.assigneeId],
    references: [user.id],
    relationName: "assignee",
  }),
  creator: one(user, {
    fields: [issue.creatorId],
    references: [user.id],
    relationName: "creator",
  }),
  project: one(project, {
    fields: [issue.projectId],
    references: [project.id],
  }),
  milestone: one(projectMilestone, {
    fields: [issue.projectMilestoneId],
    references: [projectMilestone.id],
  }),
  cycle: one(cycle, { fields: [issue.cycleId], references: [cycle.id] }),
  parentIssue: one(issue, {
    fields: [issue.parentIssueId],
    references: [issue.id],
    relationName: "parentIssue",
  }),
  subIssues: many(issue, { relationName: "parentIssue" }),
  labels: many(issueLabel),
  comments: many(comment),
  reactions: many(issueReaction),
  history: many(issueHistory),
  relations: many(issueRelation, { relationName: "source" }),
  relatedFrom: many(issueRelation, { relationName: "target" }),
  notifications: many(notification),
}));

export const issueHistoryRelations = relations(issueHistory, ({ one }) => ({
  issue: one(issue, { fields: [issueHistory.issueId], references: [issue.id] }),
  actor: one(user, { fields: [issueHistory.actorId], references: [user.id] }),
}));

export const issueLabelRelations = relations(issueLabel, ({ one }) => ({
  issue: one(issue, { fields: [issueLabel.issueId], references: [issue.id] }),
  label: one(label, { fields: [issueLabel.labelId], references: [label.id] }),
}));

export const issueRelationRelations = relations(issueRelation, ({ one }) => ({
  issue: one(issue, {
    fields: [issueRelation.issueId],
    references: [issue.id],
    relationName: "source",
  }),
  relatedIssue: one(issue, {
    fields: [issueRelation.relatedIssueId],
    references: [issue.id],
    relationName: "target",
  }),
}));

export const labelRelations = relations(label, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [label.workspaceId],
    references: [workspace.id],
  }),
  team: one(team, { fields: [label.teamId], references: [team.id] }),
  parentLabel: one(label, {
    fields: [label.parentLabelId],
    references: [label.id],
    relationName: "parentLabel",
  }),
  childLabels: many(label, { relationName: "parentLabel" }),
  issueLabels: many(issueLabel),
}));

export const projectRelations = relations(project, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [project.workspaceId],
    references: [workspace.id],
  }),
  lead: one(user, { fields: [project.leadId], references: [user.id] }),
  milestones: many(projectMilestone),
  teams: many(projectTeam),
  members: many(projectMember),
  issues: many(issue),
  initiativeProjects: many(initiativeProject),
}));

export const projectTemplateRelations = relations(
  projectTemplate,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [projectTemplate.workspaceId],
      references: [workspace.id],
    }),
    createdBy: one(user, {
      fields: [projectTemplate.createdById],
      references: [user.id],
    }),
  }),
);

export const projectTeamRelations = relations(projectTeam, ({ one }) => ({
  project: one(project, {
    fields: [projectTeam.projectId],
    references: [project.id],
  }),
  team: one(team, { fields: [projectTeam.teamId], references: [team.id] }),
}));

export const projectMemberRelations = relations(projectMember, ({ one }) => ({
  project: one(project, {
    fields: [projectMember.projectId],
    references: [project.id],
  }),
  user: one(user, { fields: [projectMember.userId], references: [user.id] }),
}));

export const projectMilestoneRelations = relations(
  projectMilestone,
  ({ one, many }) => ({
    project: one(project, {
      fields: [projectMilestone.projectId],
      references: [project.id],
    }),
    issues: many(issue),
  }),
);

export const cycleRelations = relations(cycle, ({ one, many }) => ({
  team: one(team, { fields: [cycle.teamId], references: [team.id] }),
  issues: many(issue),
}));

export const initiativeRelations = relations(initiative, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [initiative.workspaceId],
    references: [workspace.id],
  }),
  parentInitiative: one(initiative, {
    fields: [initiative.parentInitiativeId],
    references: [initiative.id],
    relationName: "parentInitiative",
  }),
  childInitiatives: many(initiative, { relationName: "parentInitiative" }),
  projects: many(initiativeProject),
}));

export const initiativeProjectRelations = relations(
  initiativeProject,
  ({ one }) => ({
    initiative: one(initiative, {
      fields: [initiativeProject.initiativeId],
      references: [initiative.id],
    }),
    project: one(project, {
      fields: [initiativeProject.projectId],
      references: [project.id],
    }),
  }),
);

export const customViewRelations = relations(customView, ({ one }) => ({
  owner: one(user, { fields: [customView.ownerId], references: [user.id] }),
  workspace: one(workspace, {
    fields: [customView.workspaceId],
    references: [workspace.id],
  }),
  team: one(team, { fields: [customView.teamId], references: [team.id] }),
}));

export const commentRelations = relations(comment, ({ one, many }) => ({
  issue: one(issue, { fields: [comment.issueId], references: [issue.id] }),
  user: one(user, { fields: [comment.userId], references: [user.id] }),
  reactions: many(reaction),
  attachments: many(commentAttachment),
}));

export const issueReactionRelations = relations(issueReaction, ({ one }) => ({
  issue: one(issue, {
    fields: [issueReaction.issueId],
    references: [issue.id],
  }),
  user: one(user, { fields: [issueReaction.userId], references: [user.id] }),
}));

export const reactionRelations = relations(reaction, ({ one }) => ({
  comment: one(comment, {
    fields: [reaction.commentId],
    references: [comment.id],
  }),
  user: one(user, { fields: [reaction.userId], references: [user.id] }),
}));

export const commentAttachmentRelations = relations(
  commentAttachment,
  ({ one }) => ({
    comment: one(comment, {
      fields: [commentAttachment.commentId],
      references: [comment.id],
    }),
  }),
);

export const notificationRelations = relations(notification, ({ one }) => ({
  user: one(user, {
    fields: [notification.userId],
    references: [user.id],
    relationName: "recipient",
  }),
  issue: one(issue, {
    fields: [notification.issueId],
    references: [issue.id],
  }),
  actor: one(user, {
    fields: [notification.actorId],
    references: [user.id],
    relationName: "actor",
  }),
}));

export const apiKeyRelations = relations(apiKey, ({ one }) => ({
  user: one(user, { fields: [apiKey.userId], references: [user.id] }),
  workspace: one(workspace, {
    fields: [apiKey.workspaceId],
    references: [workspace.id],
  }),
}));

export const webhookRelations = relations(webhook, ({ one }) => ({
  workspace: one(workspace, {
    fields: [webhook.workspaceId],
    references: [workspace.id],
  }),
}));
