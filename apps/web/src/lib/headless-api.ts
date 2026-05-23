import { createApiKeyHash } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { apiKey } from "@/lib/db/schema";
import { type components, createExponentialClient } from "@exponential/sdk";

export function headlessIssuesEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_ISSUES === "true";
}

export function headlessIssueBulkEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_ISSUE_BULK === "true";
}

export function headlessAccountNotificationsEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_ACCOUNT_NOTIFICATIONS === "true";
}

export function headlessAccountPreferencesEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_ACCOUNT_PREFERENCES === "true";
}

export function headlessAccountProfileEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_ACCOUNT_PROFILE === "true";
}

export function headlessAccountWorkspaceLeaveEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_ACCOUNT_WORKSPACE_LEAVE === "true";
}

export function headlessViewsEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_VIEWS === "true";
}

export function headlessMyIssuesEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_MY_ISSUES === "true";
}

export function headlessProjectUpdateConfigurationsEnabled() {
  return (
    process.env.EXPONENTIAL_HEADLESS_PROJECT_UPDATE_CONFIGURATIONS === "true"
  );
}

export function headlessProjectUpdatesEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_PROJECT_UPDATES === "true";
}

export function headlessAgentRunsEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_AGENT_RUNS === "true";
}

export function headlessProjectLabelsEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_PROJECT_LABELS === "true";
}

export function headlessProjectStatusesEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_PROJECT_STATUSES === "true";
}

export function headlessCustomEmojisEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_CUSTOM_EMOJIS === "true";
}

export function headlessProjectTemplatesEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_PROJECT_TEMPLATES === "true";
}

export function headlessNotificationsEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_NOTIFICATIONS === "true";
}

export function headlessLabelsEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_LABELS === "true";
}

export function headlessIssueTemplatesEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_ISSUE_TEMPLATES === "true";
}

export function headlessDocumentsEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_DOCUMENTS === "true";
}

export function headlessSidebarFavoritesEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_SIDEBAR_FAVORITES === "true";
}

export function headlessIntegrationsEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_INTEGRATIONS === "true";
}

export function headlessAnalyticsEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_ANALYTICS === "true";
}

export function headlessTeamsEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_TEAMS === "true";
}

export function headlessWorkspacesEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_WORKSPACES === "true";
}

export function headlessCommentsEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_COMMENTS === "true";
}

export function headlessAuthProvidersEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_AUTH_PROVIDERS === "true";
}

export function headlessProjectsEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_PROJECTS === "true";
}

export function headlessInboundEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_INBOUND === "true";
}

export function createHeadlessClient(token: string) {
  return createExponentialClient({
    baseUrl: process.env.EXPONENTIAL_API_URL ?? "http://localhost:3016/v1",
    token,
  });
}

export function createHeadlessIssuesClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessIssueBulkClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessAccountNotificationsClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessAccountPreferencesClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessAccountProfileClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessAccountWorkspaceLeaveClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessViewsClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessMyIssuesClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessProjectUpdateConfigurationsClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessProjectUpdatesClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessAgentRunsClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessProjectLabelsClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessProjectStatusesClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessCustomEmojisClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessProjectTemplatesClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessNotificationsClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessLabelsClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessIssueTemplatesClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessDocumentsClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessSidebarFavoritesClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessIntegrationsClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessAnalyticsClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessTeamsClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessWorkspacesClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessCommentsClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessAuthProvidersClient(token = "") {
  return createHeadlessClient(token);
}

export function createHeadlessProjectsClient(token: string) {
  return createHeadlessClient(token);
}

export function createHeadlessInboundClient() {
  return createHeadlessClient("");
}

export async function mintInternalApiToken(input: {
  userId: string;
  workspaceId: string;
}) {
  const secret = `lin_api_internal_${input.userId}_${input.workspaceId}`;
  await db
    .insert(apiKey)
    .values({
      name: "Internal web to headless API bridge",
      keyHash: createApiKeyHash(secret),
      keyPrefix: "lin_api_internal…",
      userId: input.userId,
      workspaceId: input.workspaceId,
    })
    .onConflictDoNothing();
  return secret;
}

export type HeadlessCreateIssueRequest =
  components["schemas"]["CreateIssueRequest"];
export type HeadlessUpdateIssueRequest =
  components["schemas"]["UpdateIssueRequest"];
