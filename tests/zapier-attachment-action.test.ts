import { beforeEach, describe, expect, it, vi } from "vitest";

const limitMock = vi.fn();
const insertValuesMock = vi.fn();
const transactionMock = vi.fn();
const buildKeyMock = vi.fn();
const getUploadUrlMock = vi.fn();
const randomUuidMock = vi.spyOn(crypto, "randomUUID");

vi.mock("@/lib/s3", () => ({
  buildKey: buildKeyMock,
  getUploadUrl: getUploadUrlMock,
}));

vi.mock("@/lib/db/schema", () => ({
  comment: { __name: "comment" },
  commentAttachment: { __name: "commentAttachment" },
  issue: { __name: "issue" },
  issueHistory: { __name: "issueHistory" },
  member: { __name: "member" },
  project: { __name: "project" },
  projectTeam: { __name: "projectTeam" },
  team: { __name: "team" },
  user: { __name: "user" },
  webhook: { __name: "webhook" },
  workflowState: { __name: "workflowState" },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: limitMock,
          })),
        })),
      })),
    })),
    transaction: transactionMock,
  },
}));

const context = {
  user: {
    id: "user-1",
    name: "Avery",
    email: "avery@test.com",
    image: null,
  },
  workspaceId: "workspace-1",
  session: {
    user: {
      id: "user-1",
      name: "Avery",
      email: "avery@test.com",
      image: null,
    },
    apiKey: {
      id: "api-key-1",
      workspaceId: "workspace-1",
      memberRole: "admin",
    },
  },
};

const issueRecord = {
  id: "issue-1",
  identifier: "ENG-1",
  title: "Upload fixture",
  description: "",
  priority: "medium",
  teamId: "team-1",
  teamKey: "ENG",
  teamSettings: {},
  stateId: "state-1",
  assigneeId: null,
  projectId: null,
  dueDate: null,
  createdAt: new Date("2026-06-09T12:00:00.000Z"),
  updatedAt: new Date("2026-06-09T12:00:00.000Z"),
};

describe("Zapier attachment action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitMock.mockResolvedValue([issueRecord]);
    buildKeyMock.mockReturnValue("attachments/workspace-1/Q2-plan--.pdf");
    getUploadUrlMock.mockResolvedValue("https://s3.example.test/signed-upload");
    randomUuidMock.mockReset();
    randomUuidMock
      .mockReturnValueOnce("comment-1")
      .mockReturnValueOnce("attachment-1");
    transactionMock.mockImplementation(async (callback) => {
      const tx = {
        insert: (table: { __name?: string }) => ({
          values: (value: unknown) => {
            insertValuesMock(table.__name, value);
            return Promise.resolve();
          },
        }),
      };

      return callback(tx);
    });
  });

  it("creates attachment metadata and returns a presigned upload contract", async () => {
    const { runZapierAction } = await import("@/lib/zapier");

    const result = await runZapierAction("create_attachment", context, {
      issueId: "ENG-1",
      fileName: "Q2 plan ?.pdf",
      contentType: "application/pdf",
      size: 1024,
      body: "Quarterly planning deck",
    });

    expect(buildKeyMock).toHaveBeenCalledWith(
      "attachment",
      "workspace-1",
      "Q2-plan--.pdf",
    );
    expect(getUploadUrlMock).toHaveBeenCalledWith(
      "attachments/workspace-1/Q2-plan--.pdf",
      "application/pdf",
      3600,
    );
    expect(insertValuesMock).toHaveBeenCalledWith("comment", {
      id: "comment-1",
      issueId: "issue-1",
      userId: "user-1",
      body: "Quarterly planning deck",
    });
    expect(insertValuesMock).toHaveBeenCalledWith("commentAttachment", {
      id: "attachment-1",
      commentId: "comment-1",
      fileName: "Q2 plan ?.pdf",
      storageKey: "attachments/workspace-1/Q2-plan--.pdf",
      contentType: "application/pdf",
      size: 1024,
    });
    expect(result).toMatchObject({
      id: "attachment-1",
      commentId: "comment-1",
      issueId: "issue-1",
      issueIdentifier: "ENG-1",
      fileName: "Q2 plan ?.pdf",
      contentType: "application/pdf",
      size: 1024,
      uploadUrl: "https://s3.example.test/signed-upload",
      uploadMethod: "PUT",
      uploadHeaders: { "Content-Type": "application/pdf" },
      uploadExpiresInSeconds: 3600,
    });
  });

  it("rejects attachment metadata without a file size before signing uploads", async () => {
    const { runZapierAction } = await import("@/lib/zapier");

    await expect(
      runZapierAction("create_attachment", context, {
        issueId: "ENG-1",
        fileName: "Q2 plan.pdf",
        contentType: "application/pdf",
      }),
    ).rejects.toThrow("Attachment size is required.");
    expect(getUploadUrlMock).not.toHaveBeenCalled();
  });
});
