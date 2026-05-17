import { richTextHtmlToPlainText } from "@/lib/issue-description";

export const MIN_SUMMARY_COMMENTS = 2;

export type DiscussionSummaryStatus =
  | "disabled"
  | "ineligible"
  | "ready"
  | "generating"
  | "generated"
  | "stale"
  | "failed";

export interface DiscussionSummaryComment {
  body: string;
  userName: string | null;
  createdAt: Date;
  updatedAt?: Date | null;
}

export interface DiscussionSummarySourceMetadata {
  sourceCommentCount: number;
  sourceCommentVersion: string | null;
}

export interface PersistedDiscussionSummaryState
  extends DiscussionSummarySourceMetadata {
  enabled: boolean;
  status: DiscussionSummaryStatus;
  text: string | null;
  generatedAt: string | null;
  generatedBy: string | null;
  staleAt: string | null;
  error: string | null;
}

export interface DiscussionSummaryProvider {
  generate(input: {
    issueTitle: string;
    issueIdentifier: string;
    comments: DiscussionSummaryComment[];
  }): Promise<string>;
}

function cleanCommentBody(body: string): string {
  return richTextHtmlToPlainText(body).replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function usableComments(comments: DiscussionSummaryComment[]) {
  return comments
    .map((currentComment) => ({
      author: currentComment.userName ?? "Unknown user",
      text: cleanCommentBody(currentComment.body),
      createdAt: currentComment.createdAt,
      updatedAt: currentComment.updatedAt ?? currentComment.createdAt,
    }))
    .filter((entry) => entry.text.length > 0);
}

function deterministicProviderSummary(input: {
  issueTitle: string;
  issueIdentifier: string;
  comments: DiscussionSummaryComment[];
}): string {
  const entries = usableComments(input.comments);
  const participants = Array.from(
    new Set(entries.map((entry) => entry.author)),
  );
  const earliest = entries[0];
  const latest = entries.at(-1);
  const body = entries
    .map(
      (entry, index) =>
        `${index + 1}. ${entry.author}: ${truncate(entry.text, 220)}`,
    )
    .join("\n");

  return [
    `AI discussion summary for ${input.issueIdentifier}: ${input.issueTitle}`,
    `Participants: ${participants.join(", ") || "Unknown user"}.`,
    earliest
      ? `Thread opened with: ${earliest.author} — ${truncate(earliest.text, 180)}.`
      : null,
    latest && latest !== earliest
      ? `Latest update: ${latest.author} — ${truncate(latest.text, 180)}.`
      : null,
    "Discussion context considered:",
    body,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

class DeterministicDiscussionSummaryProvider
  implements DiscussionSummaryProvider
{
  async generate(input: {
    issueTitle: string;
    issueIdentifier: string;
    comments: DiscussionSummaryComment[];
  }): Promise<string> {
    return deterministicProviderSummary(input);
  }
}

class OpenAiDiscussionSummaryProvider implements DiscussionSummaryProvider {
  constructor(private readonly apiKey: string) {}

  async generate(input: {
    issueTitle: string;
    issueIdentifier: string;
    comments: DiscussionSummaryComment[];
  }): Promise<string> {
    const comments = usableComments(input.comments)
      .map((entry, index) => `${index + 1}. ${entry.author}: ${entry.text}`)
      .join("\n");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.DISCUSSION_SUMMARY_OPENAI_MODEL ?? "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content:
              "Summarize an issue discussion for a Linear-style issue detail view. Be concise, factual, and preserve decisions, blockers, owners, and open questions. Do not invent facts.",
          },
          {
            role: "user",
            content: `Issue ${input.issueIdentifier}: ${input.issueTitle}\n\nComments:\n${comments}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`AI provider returned ${response.status}`);
    }

    const data = (await response.json()) as { output_text?: unknown };
    if (typeof data.output_text !== "string" || !data.output_text.trim()) {
      throw new Error("AI provider returned an empty summary");
    }

    return data.output_text.trim();
  }
}

export function getDiscussionSummaryProvider(): DiscussionSummaryProvider {
  if (process.env.DISCUSSION_SUMMARY_PROVIDER === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for discussion summaries");
    }

    return new OpenAiDiscussionSummaryProvider(apiKey);
  }

  return new DeterministicDiscussionSummaryProvider();
}

export function buildDiscussionSummarySourceMetadata(
  comments: DiscussionSummaryComment[],
): DiscussionSummarySourceMetadata {
  const entries = usableComments(comments);
  const latestVersion = entries.reduce<string | null>((latest, entry) => {
    const version = entry.updatedAt.toISOString();
    return latest && latest > version ? latest : version;
  }, null);

  return {
    sourceCommentCount: entries.length,
    sourceCommentVersion: latestVersion,
  };
}

export async function generateDiscussionSummary(input: {
  issueTitle: string;
  issueIdentifier: string;
  comments: DiscussionSummaryComment[];
  provider?: DiscussionSummaryProvider;
}): Promise<{ text: string; source: DiscussionSummarySourceMetadata }> {
  const source = buildDiscussionSummarySourceMetadata(input.comments);
  if (source.sourceCommentCount < MIN_SUMMARY_COMMENTS) {
    throw new Error(
      "At least two comments are required to summarize discussion",
    );
  }

  const provider = input.provider ?? getDiscussionSummaryProvider();
  const text = await provider.generate(input);
  if (!text.trim()) {
    throw new Error("Discussion summary provider returned an empty summary");
  }

  return { text: text.trim(), source };
}

export function buildDiscussionSummaryState(input: {
  enabled: boolean;
  comments: DiscussionSummaryComment[];
  persisted?: {
    status: DiscussionSummaryStatus;
    summary: string | null;
    generatedAt: Date | null;
    generatedBy: string | null;
    sourceCommentCount: number;
    sourceCommentVersion: string | null;
    error: string | null;
    staleAt: Date | null;
  } | null;
}): PersistedDiscussionSummaryState {
  if (!input.enabled) {
    return {
      enabled: false,
      status: "disabled",
      text: null,
      generatedAt: null,
      generatedBy: null,
      sourceCommentCount: 0,
      sourceCommentVersion: null,
      staleAt: null,
      error: null,
    };
  }

  const source = buildDiscussionSummarySourceMetadata(input.comments);
  if (source.sourceCommentCount < MIN_SUMMARY_COMMENTS) {
    return {
      enabled: true,
      status: "ineligible",
      text: null,
      generatedAt: null,
      generatedBy: null,
      ...source,
      staleAt: null,
      error: null,
    };
  }

  const persisted = input.persisted;
  if (!persisted) {
    return {
      enabled: true,
      status: "ready",
      text: null,
      generatedAt: null,
      generatedBy: null,
      ...source,
      staleAt: null,
      error: null,
    };
  }

  const sourceChanged =
    persisted.sourceCommentCount !== source.sourceCommentCount ||
    persisted.sourceCommentVersion !== source.sourceCommentVersion;
  const status = sourceChanged
    ? persisted.summary
      ? "stale"
      : "ready"
    : persisted.status;

  return {
    enabled: true,
    status,
    text: persisted.summary,
    generatedAt: persisted.generatedAt?.toISOString() ?? null,
    generatedBy: persisted.generatedBy,
    ...source,
    staleAt:
      persisted.staleAt?.toISOString() ??
      (sourceChanged ? new Date().toISOString() : null),
    error: status === "failed" ? persisted.error : null,
  };
}
