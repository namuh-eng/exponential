import {
  buildDiscussionSummarySourceMetadata,
  buildDiscussionSummaryState,
  generateDiscussionSummary,
} from "@/lib/discussion-summary";
import { describe, expect, it } from "vitest";

const comments = [
  {
    body: "We need to choose a rollout path for the API.",
    userName: "Ashley",
    createdAt: new Date("2026-05-15T10:00:00Z"),
    updatedAt: new Date("2026-05-15T10:00:00Z"),
  },
  {
    body: "Morgan will verify the migration before launch.",
    userName: "Morgan",
    createdAt: new Date("2026-05-15T10:05:00Z"),
    updatedAt: new Date("2026-05-15T10:05:00Z"),
  },
];

describe("discussion summary service", () => {
  it("returns disabled and ineligible states without fabricating summaries", () => {
    expect(
      buildDiscussionSummaryState({
        enabled: false,
        comments,
        persisted: null,
      }),
    ).toMatchObject({
      enabled: false,
      status: "disabled",
      text: null,
      generatedAt: null,
    });

    expect(
      buildDiscussionSummaryState({
        enabled: true,
        comments: [comments[0]],
        persisted: null,
      }),
    ).toMatchObject({
      enabled: true,
      status: "ineligible",
      text: null,
      sourceCommentCount: 1,
    });
  });

  it("uses a provider abstraction and records source metadata", async () => {
    const summary = await generateDiscussionSummary({
      issueTitle: "Persist AI discussion summaries",
      issueIdentifier: "ENG-334",
      comments,
      provider: {
        async generate(input) {
          return `AI summary for ${input.issueIdentifier} with ${input.comments.length} comments`;
        },
      },
    });

    expect(summary.text).toBe("AI summary for ENG-334 with 2 comments");
    expect(summary.source).toEqual({
      sourceCommentCount: 2,
      sourceCommentVersion: "2026-05-15T10:05:00.000Z",
    });
  });

  it("keeps persisted summaries stable until comment source changes", () => {
    const source = buildDiscussionSummarySourceMetadata(comments);
    const state = buildDiscussionSummaryState({
      enabled: true,
      comments,
      persisted: {
        status: "generated",
        summary: "Stored AI summary",
        generatedAt: new Date("2026-05-15T11:00:00Z"),
        generatedBy: "user-1",
        error: null,
        staleAt: null,
        ...source,
      },
    });

    expect(state).toMatchObject({
      status: "generated",
      text: "Stored AI summary",
      generatedAt: "2026-05-15T11:00:00.000Z",
    });
  });

  it("marks persisted summaries stale when comments change", () => {
    const state = buildDiscussionSummaryState({
      enabled: true,
      comments: [
        ...comments,
        {
          body: "Riley added a follow-up after generation.",
          userName: "Riley",
          createdAt: new Date("2026-05-15T10:10:00Z"),
          updatedAt: new Date("2026-05-15T10:10:00Z"),
        },
      ],
      persisted: {
        status: "generated",
        summary: "Stored AI summary",
        generatedAt: new Date("2026-05-15T11:00:00Z"),
        generatedBy: "user-1",
        sourceCommentCount: 2,
        sourceCommentVersion: "2026-05-15T10:05:00.000Z",
        error: null,
        staleAt: null,
      },
    });

    expect(state.status).toBe("stale");
    expect(state.text).toBe("Stored AI summary");
    expect(state.sourceCommentCount).toBe(3);
    expect(state.staleAt).toEqual(expect.any(String));
  });
});
