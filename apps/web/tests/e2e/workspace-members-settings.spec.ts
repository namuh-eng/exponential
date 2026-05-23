import { expect, test } from "@playwright/test";

const initialMembers = [
  {
    id: "member-1",
    kind: "member",
    userId: "user-1",
    name: "Alice Owner",
    email: "alice@example.com",
    image: null,
    role: "owner",
    status: "active",
    teams: ["Engineering"],
    joinedAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: null,
  },
  {
    id: "member-2",
    kind: "member",
    userId: "user-2",
    name: "Bob Member",
    email: "bob@example.com",
    image: null,
    role: "member",
    status: "active",
    teams: [],
    joinedAt: "2026-02-01T00:00:00.000Z",
    lastSeenAt: null,
  },
  {
    id: "invite-1",
    kind: "invitation",
    userId: null,
    name: "Pending invite",
    email: "pending@example.com",
    image: null,
    role: "guest",
    status: "pending",
    teams: [],
    joinedAt: "2026-03-01T00:00:00.000Z",
    lastSeenAt: null,
  },
];

test.describe("Workspace member settings", () => {
  test("removes members and resends/revokes pending invitations from row actions", async ({
    page,
  }) => {
    let members = [...initialMembers];
    const requests: Array<{ method: string; body: unknown }> = [];

    await page.route("**/api/workspaces/members", async (route) => {
      const request = route.request();
      const method = request.method();
      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            workspaceId: "workspace-1",
            currentUserId: "user-1",
            viewerRole: "owner",
            canInviteMembers: true,
            members,
          }),
        });
        return;
      }

      const body = request.postDataJSON();
      requests.push({ method, body });
      if (method === "DELETE") {
        members = members.filter((member) => member.id !== body.id);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    page.on("dialog", (dialog) => dialog.accept());

    await page.goto("/settings/members");
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
    await expect(page.getByText("bob@example.com")).toBeVisible();
    await expect(page.getByText("pending@example.com")).toBeVisible();

    await page.getByRole("button", { name: "Remove" }).click();
    await expect(
      page.getByText("Removed Bob Member from workspace."),
    ).toBeVisible();
    await expect(page.getByText("bob@example.com")).toHaveCount(0);

    await page.getByRole("button", { name: "Resend" }).click();
    await expect(
      page.getByText("Resent invitation to pending@example.com."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Revoke" }).click();
    await expect(
      page.getByText("Revoked invitation to pending@example.com."),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Role for pending@example.com" }),
    ).toHaveCount(0);

    expect(requests).toEqual([
      {
        method: "DELETE",
        body: { id: "member-2", kind: "member" },
      },
      {
        method: "PATCH",
        body: { id: "invite-1", kind: "invitation", action: "resend" },
      },
      {
        method: "DELETE",
        body: { id: "invite-1", kind: "invitation" },
      },
    ]);
  });
});
