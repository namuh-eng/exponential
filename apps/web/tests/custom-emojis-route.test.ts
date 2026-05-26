import { db } from "@/lib/db";
import { member, user, workspace } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { DELETE } from "legacy-api/custom-emojis/[id]/route";
import { GET, POST } from "legacy-api/custom-emojis/route";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { describeDb } from "./_helpers/db-integration";

const TEST_USER_ID = "21700000-0000-0000-0000-000000000001";
const TEST_WORKSPACE_ID = "21700000-0000-0000-0000-000000000002";
const imageUrl = "data:image/png;base64,iVBORw0KGgo=";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));
vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: vi.fn(async () => TEST_WORKSPACE_ID),
}));

import { auth } from "@/lib/auth";

describeDb("custom emojis API", () => {
  beforeAll(async () => {
    await db.delete(member).where(eq(member.userId, TEST_USER_ID));
    await db.delete(workspace).where(eq(workspace.id, TEST_WORKSPACE_ID));
    await db.delete(user).where(eq(user.id, TEST_USER_ID));
    await db.insert(user).values({
      id: TEST_USER_ID,
      name: "Emoji User",
      email: "emoji-route@example.com",
      settings: {},
    });
    await db.insert(workspace).values({
      id: TEST_WORKSPACE_ID,
      name: "Emoji Workspace",
      urlSlug: "emoji-route",
      settings: {},
    });
    await db.insert(member).values({
      userId: TEST_USER_ID,
      workspaceId: TEST_WORKSPACE_ID,
      role: "admin",
    });
  });

  afterAll(async () => {
    await db.delete(member).where(eq(member.userId, TEST_USER_ID));
    await db.delete(workspace).where(eq(workspace.id, TEST_WORKSPACE_ID));
    await db.delete(user).where(eq(user.id, TEST_USER_ID));
  });

  it("creates, lists, rejects duplicate, and deletes custom emojis", async () => {
    (
      auth.api.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ user: { id: TEST_USER_ID } });

    const createResponse = await POST(
      new Request("http://localhost/api/custom-emojis", {
        method: "POST",
        body: JSON.stringify({ name: ":party_parrot:", imageUrl }),
      }),
    );
    expect(createResponse.status).toBe(201);
    const createData = await createResponse.json();
    expect(createData.emoji.name).toBe("party_parrot");

    const listResponse = await GET();
    expect(listResponse.status).toBe(200);
    const listData = await listResponse.json();
    expect(listData.emojis).toHaveLength(1);
    expect(listData.emojis[0].name).toBe("party_parrot");

    const duplicateResponse = await POST(
      new Request("http://localhost/api/custom-emojis", {
        method: "POST",
        body: JSON.stringify({ name: "party_parrot", imageUrl }),
      }),
    );
    expect(duplicateResponse.status).toBe(409);

    const deleteResponse = await DELETE(
      new Request(`http://localhost/api/custom-emojis/${createData.emoji.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: createData.emoji.id }) },
    );
    expect(deleteResponse.status).toBe(200);

    const emptyResponse = await GET();
    const emptyData = await emptyResponse.json();
    expect(emptyData.emojis).toEqual([]);
  });
});
