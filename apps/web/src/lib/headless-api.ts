import { createApiKeyHash } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { apiKey } from "@/lib/db/schema";
import { type components, createExponentialClient } from "@exponential/sdk";

export function headlessIssuesEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_ISSUES === "true";
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

export function createHeadlessClient(token: string) {
  return createExponentialClient({
    baseUrl: process.env.EXPONENTIAL_API_URL ?? "http://localhost:3016/v1",
    token,
  });
}

export function createHeadlessIssuesClient(token: string) {
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
