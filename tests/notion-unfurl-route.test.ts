import { beforeEach, describe, expect, it, vi } from "vitest";

const readBearerTokenMock = vi.fn();
const resolveNotionUnfurlMock = vi.fn();
const toNotionUnfurlResponseMock = vi.fn();

vi.mock("@/lib/notion-rich-previews", () => ({
  readBearerToken: readBearerTokenMock,
  resolveNotionUnfurl: resolveNotionUnfurlMock,
  toNotionUnfurlResponse: toNotionUnfurlResponseMock,
}));

describe("Notion unfurl route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    readBearerTokenMock.mockReturnValue("notion_unfurl_test");
    resolveNotionUnfurlMock.mockResolvedValue({
      title: "ENG-123 Fix sign-in",
    });
    toNotionUnfurlResponseMock.mockReturnValue({
      uri: "https://app.test/acme/team/ENG/issue/ENG-123",
      operations: [{ path: ["attributes"], set: [] }],
    });
  });

  it("accepts Notion's uri payload and returns unfurl operations", async () => {
    const { POST } = await import("@/app/api/integrations/notion/unfurl/route");
    const request = new Request(
      "https://app.test/api/integrations/notion/unfurl",
      {
        method: "POST",
        headers: {
          authorization: "Bearer notion_unfurl_test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          uri: "https://app.test/acme/team/ENG/issue/ENG-123",
        }),
      },
    );

    const response = await POST(request);
    const body = await response.json();

    expect(resolveNotionUnfurlMock).toHaveBeenCalledWith(
      "https://app.test/acme/team/ENG/issue/ENG-123",
      "notion_unfurl_test",
      request,
    );
    expect(toNotionUnfurlResponseMock).toHaveBeenCalledWith(
      "https://app.test/acme/team/ENG/issue/ENG-123",
      { title: "ENG-123 Fix sign-in" },
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      uri: "https://app.test/acme/team/ENG/issue/ENG-123",
      operations: [{ path: ["attributes"], set: [] }],
    });
  });

  it("rejects callback requests without a target URI", async () => {
    const { POST } = await import("@/app/api/integrations/notion/unfurl/route");
    const response = await POST(
      new Request("https://app.test/api/integrations/notion/unfurl", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      error: "URL is required",
    });
    expect(response.status).toBe(400);
    expect(resolveNotionUnfurlMock).not.toHaveBeenCalled();
  });
});
