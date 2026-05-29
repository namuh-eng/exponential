import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  memberCountRows: [{ value: 3 }],
  select: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { select: mocks.select },
}));

function queryBuilder(rows: unknown[]) {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn().mockResolvedValue(rows),
  };
  return builder;
}

async function loadModule() {
  return await import("@/lib/workspace-billing");
}

describe("workspace entitlements", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.memberCountRows = [{ value: 3 }];
    mocks.select.mockReturnValue(queryBuilder(mocks.memberCountRows));
  });

  it("counts active seats from workspace members and blocks free overages with upgrade state", async () => {
    const { checkWorkspaceEntitlement, getWorkspaceEntitlements } =
      await loadModule();

    const entitlements = await getWorkspaceEntitlements({
      workspaceId: "ws-free",
      settings: { billing: { plan: "free", seatsUsed: 1 } },
    });

    expect(entitlements.activeSeats).toBe(3);
    expect(entitlements.memberLimit).toBe(3);
    expect(
      checkWorkspaceEntitlement(entitlements, "member-limit"),
    ).toMatchObject({
      allowed: false,
      code: "member_limit_reached",
      status: 402,
      activeSeats: 3,
      limit: 3,
    });
  });

  it("allows and denies paid capabilities by shared plan helpers", async () => {
    mocks.memberCountRows = [{ value: 7 }];
    mocks.select.mockReturnValue(queryBuilder(mocks.memberCountRows));
    const { checkWorkspaceEntitlement, getWorkspaceEntitlements } =
      await loadModule();

    const team = await getWorkspaceEntitlements({
      workspaceId: "ws-team",
      settings: { billing: { plan: "team" } },
    });
    const business = await getWorkspaceEntitlements({
      workspaceId: "ws-business",
      settings: { billing: { plan: "business" } },
    });
    const enterprise = await getWorkspaceEntitlements({
      workspaceId: "ws-enterprise",
      settings: { billing: { plan: "enterprise" } },
    });

    expect(checkWorkspaceEntitlement(team, "admin-analytics")).toMatchObject({
      allowed: false,
      requiredPlan: "business",
    });
    expect(checkWorkspaceEntitlement(business, "admin-analytics")).toEqual({
      allowed: true,
    });
    expect(checkWorkspaceEntitlement(business, "saml-sso")).toMatchObject({
      allowed: false,
      requiredPlan: "enterprise",
    });
    expect(checkWorkspaceEntitlement(enterprise, "scim")).toEqual({
      allowed: true,
    });
  });

  it("does not require hosted Stripe plans for self-hosted workspaces", async () => {
    mocks.memberCountRows = [{ value: 100 }];
    mocks.select.mockReturnValue(queryBuilder(mocks.memberCountRows));
    const { checkWorkspaceEntitlement, getWorkspaceEntitlements } =
      await loadModule();

    const entitlements = await getWorkspaceEntitlements({
      workspaceId: "ws-community",
      settings: { hostingMode: "self-hosted", billing: { plan: "free" } },
    });

    expect(entitlements.memberLimit).toBeNull();
    expect(checkWorkspaceEntitlement(entitlements, "member-limit")).toEqual({
      allowed: true,
    });
    expect(checkWorkspaceEntitlement(entitlements, "saml-sso")).toEqual({
      allowed: true,
    });
  });
});
