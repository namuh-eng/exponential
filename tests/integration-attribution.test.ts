import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  rows: [] as Array<{ userId: string }>,
  where: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mocks.dbSelect,
  },
}));

function setupDbMock() {
  const builder = {
    from: vi.fn(() => builder),
    where: mocks.where.mockReturnValue({
      limit: vi.fn().mockResolvedValue(mocks.rows),
    }),
  };
  mocks.dbSelect.mockReturnValue(builder);
}

describe("integration attribution", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.rows = [];
  });

  it("resolves a synced GitHub actor to the connected Linear user", async () => {
    mocks.rows = [{ userId: "linear-user-1" }];
    setupDbMock();

    const { resolveIntegrationActorUserId } = await import(
      "@/lib/integration-attribution"
    );

    await expect(
      resolveIntegrationActorUserId({
        provider: "github",
        externalAccountId: " octocat ",
      }),
    ).resolves.toBe("linear-user-1");
    expect(mocks.dbSelect).toHaveBeenCalledWith(expect.objectContaining({}));
    expect(mocks.where).toHaveBeenCalledOnce();
  });

  it("returns null for blank or unlinked integration actors", async () => {
    setupDbMock();

    const { resolveIntegrationActorUserId } = await import(
      "@/lib/integration-attribution"
    );

    await expect(
      resolveIntegrationActorUserId({
        provider: "github",
        externalAccountId: " ",
      }),
    ).resolves.toBeNull();
    expect(mocks.dbSelect).not.toHaveBeenCalled();

    await expect(
      resolveIntegrationActorUserId({
        provider: "github",
        externalAccountId: "missing-user",
      }),
    ).resolves.toBeNull();
  });
});
