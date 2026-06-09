import {
  buildUnauthorizedNotionPreview,
  canPreviewNotionView,
  hasActiveNotionPreviewUser,
  hasActiveNotionPreviewUsers,
  isSupportedExponentialPreviewUrl,
  parseExponentialResourceUrl,
  revokeNotionPreviewUser,
  toNotionUnfurlResponse,
  upsertNotionPreviewUser,
} from "@/lib/notion-rich-previews";
import { describe, expect, it } from "vitest";

describe("Notion rich previews", () => {
  it("parses workspace-scoped issue, project, initiative, and view URLs", () => {
    expect(
      parseExponentialResourceUrl(
        "https://app.test/acme/team/ENG/issue/ENG-123",
      ),
    ).toEqual({
      type: "issue",
      workspaceSlug: "acme",
      teamKey: "ENG",
      identifier: "ENG-123",
    });

    expect(
      parseExponentialResourceUrl(
        "https://app.test/acme/project/customer-portal/overview",
      ),
    ).toEqual({
      type: "project",
      workspaceSlug: "acme",
      slug: "customer-portal",
    });

    expect(
      parseExponentialResourceUrl("https://app.test/acme/initiatives/init-1"),
    ).toEqual({
      type: "initiative",
      workspaceSlug: "acme",
      id: "init-1",
    });

    expect(
      parseExponentialResourceUrl(
        "https://app.test/acme/team/ENG/views/issues?viewId=view-1",
      ),
    ).toEqual({
      type: "view",
      workspaceSlug: "acme",
      id: "view-1",
      teamKey: "ENG",
      tab: "issues",
    });
  });

  it("converts preview payloads to Notion unfurl operations", () => {
    const response = toNotionUnfurlResponse("https://app.test/link", {
      type: "rich_preview",
      provider: "Exponential",
      authorized: true,
      title: "ENG-123 Fix sign-in",
      description: "OAuth callback fails for invited users.",
      url: "/team/ENG/issue/ENG-123",
      iconUrl: "https://app.test/favicon.ico",
      updatedAt: "2026-06-09T12:00:00.000Z",
      attributes: [
        { label: "Type", value: "Issue" },
        { label: "Status", value: "In Progress" },
      ],
    });

    expect(response.uri).toBe("https://app.test/link");
    expect(response.operations).toHaveLength(1);
    expect(response.operations[0]).toEqual(
      expect.objectContaining({
        path: ["attributes"],
        set: expect.arrayContaining([
          expect.objectContaining({
            id: "title",
            name: "Title",
            type: "inline",
            inline: {
              title: { value: "ENG-123 Fix sign-in", section: "title" },
            },
          }),
          expect.objectContaining({
            id: "dev",
            name: "Developer Name",
            type: "inline",
            inline: {
              plain_text: { value: "Exponential", section: "secondary" },
            },
          }),
          expect.objectContaining({
            id: "status",
            name: "Status",
            type: "inline",
            inline: { enum: { value: "In Progress", section: "primary" } },
          }),
        ]),
      }),
    );
  });

  it("keeps unauthorized preview attributes private-safe", () => {
    const request = new Request(
      "https://app.test/api/integrations/notion/unfurl",
    );
    const preview = buildUnauthorizedNotionPreview(
      "https://app.test/acme/team/SEC/issue/SEC-7",
      request,
    );
    const response = toNotionUnfurlResponse(preview.url, preview);
    const attributePayload = JSON.stringify(response.operations);

    expect(preview.authorized).toBe(false);
    expect(attributePayload).not.toContain("SEC-7");
    expect(attributePayload).not.toContain("SEC");
    expect(response.operations[0]).toEqual(
      expect.objectContaining({
        path: ["attributes"],
        set: expect.arrayContaining([
          expect.objectContaining({
            id: "title",
            inline: { title: { value: "Exponential link", section: "title" } },
          }),
        ]),
      }),
    );
  });

  it("rejects lookalike URLs from other origins", () => {
    const request = new Request(
      "https://app.test/api/integrations/notion/unfurl",
    );

    expect(
      isSupportedExponentialPreviewUrl(
        "https://app.test/acme/team/ENG/issue/ENG-123",
        request,
      ),
    ).toBe(true);
    expect(
      isSupportedExponentialPreviewUrl(
        "https://evil.test/acme/team/ENG/issue/ENG-123",
        request,
      ),
    ).toBe(false);
  });

  it("keeps personal saved views owner-only and respects private team policy", () => {
    expect(
      canPreviewNotionView(
        { userId: "owner-1", role: "member" },
        {
          isPersonal: true,
          ownerId: "owner-1",
          teamId: null,
          teamIsPrivate: null,
        },
        true,
      ),
    ).toBe(true);

    expect(
      canPreviewNotionView(
        { userId: "user-2", role: "admin" },
        {
          isPersonal: true,
          ownerId: "owner-1",
          teamId: null,
          teamIsPrivate: null,
        },
        true,
      ),
    ).toBe(false);

    expect(
      canPreviewNotionView(
        { userId: "user-2", role: "member" },
        {
          isPersonal: false,
          ownerId: "owner-1",
          teamId: "team-1",
          teamIsPrivate: true,
        },
        false,
      ),
    ).toBe(false);
  });

  it("revokes only the selected Notion preview user token", () => {
    const metadata = upsertNotionPreviewUser(
      upsertNotionPreviewUser({}, "user-1", "hash-1", "2026-01-01T00:00:00Z"),
      "user-2",
      "hash-2",
      "2026-01-02T00:00:00Z",
    );

    const next = revokeNotionPreviewUser(metadata, "user-1");
    const users = next.linkPreviews?.users ?? [];

    expect(users.find((user) => user.userId === "user-1")?.revokedAt).toEqual(
      expect.any(String),
    );
    expect(
      users.find((user) => user.userId === "user-2")?.revokedAt,
    ).toBeNull();
    expect(hasActiveNotionPreviewUser(next, "user-1")).toBe(false);
    expect(hasActiveNotionPreviewUser(next, "user-2")).toBe(true);
    expect(hasActiveNotionPreviewUsers(next)).toBe(true);
  });
});
