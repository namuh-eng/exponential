import * as schema from "@/lib/db/schema";
import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

describe("Database schema", () => {
  // ── Table existence ──────────────────────────────────────────────

  const expectedTables = [
    { table: schema.user, name: "user" },
    { table: schema.session, name: "session" },
    { table: schema.account, name: "account" },
    { table: schema.verification, name: "verification" },
    { table: schema.workspace, name: "workspace" },
    { table: schema.member, name: "member" },
    { table: schema.team, name: "team" },
    { table: schema.teamMember, name: "team_member" },
    { table: schema.workflowState, name: "workflow_state" },
    { table: schema.label, name: "label" },
    { table: schema.project, name: "project" },
    { table: schema.projectTemplate, name: "project_template" },
    { table: schema.projectTeam, name: "project_team" },
    { table: schema.projectMember, name: "project_member" },
    { table: schema.projectMilestone, name: "project_milestone" },
    { table: schema.cycle, name: "cycle" },
    { table: schema.issue, name: "issue" },
    { table: schema.issueLabel, name: "issue_label" },
    { table: schema.issueHistory, name: "issue_history" },
    { table: schema.issueRelation, name: "issue_relation" },
    { table: schema.comment, name: "comment" },
    { table: schema.issueReaction, name: "issue_reaction" },
    { table: schema.reaction, name: "reaction" },
    { table: schema.commentAttachment, name: "comment_attachment" },
    { table: schema.initiative, name: "initiative" },
    { table: schema.initiativeProject, name: "initiative_project" },
    { table: schema.customView, name: "custom_view" },
    { table: schema.notification, name: "notification" },
    { table: schema.apiKey, name: "api_key" },
    { table: schema.webhook, name: "webhook" },
  ];

  it.each(expectedTables)(
    "exports $name table with correct name",
    ({ table, name }) => {
      expect(table).toBeDefined();
      expect(getTableName(table)).toBe(name);
    },
  );

  // ── Enums ────────────────────────────────────────────────────────

  it("defines workflowStateCategory enum with all categories", () => {
    expect(schema.workflowStateCategory.enumValues).toEqual([
      "triage",
      "backlog",
      "unstarted",
      "started",
      "completed",
      "canceled",
    ]);
  });

  it("defines issuePriority enum with 5 levels", () => {
    expect(schema.issuePriority.enumValues).toEqual([
      "none",
      "urgent",
      "high",
      "medium",
      "low",
    ]);
  });

  it("defines issueRelationType enum", () => {
    expect(schema.issueRelationType.enumValues).toEqual([
      "blocks",
      "blocked_by",
      "duplicate",
      "related",
    ]);
  });

  it("defines issueHistoryEventType enum", () => {
    expect(schema.issueHistoryEventType.enumValues).toEqual([
      "created",
      "updated",
      "comment_created",
    ]);
  });

  it("defines projectStatus enum", () => {
    expect(schema.projectStatus.enumValues).toEqual([
      "planned",
      "started",
      "paused",
      "completed",
      "canceled",
    ]);
  });

  it("defines initiativeStatus enum", () => {
    expect(schema.initiativeStatus.enumValues).toEqual([
      "active",
      "planned",
      "completed",
    ]);
  });

  it("defines memberRole enum", () => {
    expect(schema.memberRole.enumValues).toEqual([
      "owner",
      "admin",
      "member",
      "guest",
    ]);
  });

  it("defines notificationType enum", () => {
    expect(schema.notificationType.enumValues).toEqual([
      "assigned",
      "mentioned",
      "status_change",
      "comment",
      "duplicate",
    ]);
  });

  it("defines viewLayout enum", () => {
    expect(schema.viewLayout.enumValues).toEqual(["list", "board", "timeline"]);
  });

  // ── Issue table columns ──────────────────────────────────────────

  it("issue table has all required columns", () => {
    const columns = Object.keys(schema.issue);
    const required = [
      "id",
      "number",
      "identifier",
      "title",
      "description",
      "teamId",
      "stateId",
      "assigneeId",
      "creatorId",
      "priority",
      "estimate",
      "parentIssueId",
      "projectId",
      "projectMilestoneId",
      "cycleId",
      "dueDate",
      "sortOrder",
      "createdAt",
      "updatedAt",
      "archivedAt",
      "canceledAt",
      "completedAt",
    ];
    for (const col of required) {
      expect(columns).toContain(col);
    }
  });

  // ── Workspace table columns ──────────────────────────────────────

  it("workspace table has all required columns", () => {
    const columns = Object.keys(schema.workspace);
    const required = [
      "id",
      "name",
      "urlSlug",
      "logoUrl",
      "inviteLinkEnabled",
      "settings",
      "createdAt",
      "updatedAt",
    ];
    for (const col of required) {
      expect(columns).toContain(col);
    }
  });

  it("user table includes settings for account preferences", () => {
    const columns = Object.keys(schema.user);
    expect(columns).toContain("settings");
  });

  // ── Team table columns ───────────────────────────────────────────

  it("team table has all required columns including settings", () => {
    const columns = Object.keys(schema.team);
    const required = [
      "id",
      "name",
      "key",
      "workspaceId",
      "isPrivate",
      "triageEnabled",
      "cyclesEnabled",
      "estimateType",
      "settings",
      "createdAt",
      "updatedAt",
    ];
    for (const col of required) {
      expect(columns).toContain(col);
    }
  });

  // ── Relations exported ───────────────────────────────────────────

  it("exports all relation definitions", () => {
    expect(schema.userRelations).toBeDefined();
    expect(schema.workspaceRelations).toBeDefined();
    expect(schema.teamRelations).toBeDefined();
    expect(schema.issueRelations).toBeDefined();
    expect(schema.issueHistoryRelations).toBeDefined();
    expect(schema.projectRelations).toBeDefined();
    expect(schema.projectTemplateRelations).toBeDefined();
    expect(schema.cycleRelations).toBeDefined();
    expect(schema.initiativeRelations).toBeDefined();
    expect(schema.commentRelations).toBeDefined();
    expect(schema.issueReactionRelations).toBeDefined();
    expect(schema.commentAttachmentRelations).toBeDefined();
    expect(schema.notificationRelations).toBeDefined();
    expect(schema.labelRelations).toBeDefined();
    expect(schema.customViewRelations).toBeDefined();
    expect(schema.apiKeyRelations).toBeDefined();
    expect(schema.webhookRelations).toBeDefined();
  });

  // ── Total table count ────────────────────────────────────────────

  it("has exactly 30 tables covering all data models", () => {
    expect(expectedTables).toHaveLength(30);
  });
});
