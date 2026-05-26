import { GET } from "@/app/api/health/preflight/route";
import { db } from "@/lib/db";
import { ses } from "@/lib/email";
import { redis } from "@/lib/redis";
import { s3 } from "@/lib/s3";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: { execute: vi.fn() },
}));

vi.mock("@/lib/redis", () => ({
  redis: { ping: vi.fn() },
}));

vi.mock("@/lib/s3", () => ({
  s3: { send: vi.fn() },
}));

vi.mock("@/lib/email", () => ({
  ses: { send: vi.fn() },
}));

describe("GET /api/health/preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDIS_URL = "redis://example.test:6379";
    process.env.S3_BUCKET = "private-test-bucket";
    vi.mocked(db.execute).mockResolvedValue({
      rows: [],
      command: "SELECT",
      rowCount: 1,
      oid: 0,
      fields: [],
    });
    vi.mocked(redis.ping).mockResolvedValue("PONG");
    vi.mocked(s3.send).mockResolvedValue(undefined);
    vi.mocked(ses.send).mockResolvedValue(undefined);
  });

  it("returns sanitized live dependency checks", async () => {
    const response = await GET(
      new Request("http://localhost/api/health/preflight", {
        headers: {
          "x-forwarded-for": "203.0.113.10",
          "x-forwarded-proto": "https",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.checks).toEqual([
      { name: "Postgres", status: "ok", detail: "Database accepts queries." },
      { name: "Redis", status: "ok", detail: "Cache accepts commands." },
      {
        name: "S3",
        status: "ok",
        detail: "Object storage bucket is reachable.",
      },
      { name: "SES", status: "ok", detail: "Email provider is reachable." },
      { name: "Clock", status: "ok", detail: "Server clock is available." },
      {
        name: "Load balancer",
        status: "ok",
        detail: "Login traffic path is accepting requests.",
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("example.test");
    expect(JSON.stringify(body)).not.toContain("private-test-bucket");
  });

  it("reports failed checks without leaking thrown error details", async () => {
    vi.mocked(db.execute).mockRejectedValue(
      new Error("password=secret host=internal-db.local"),
    );

    const response = await GET(
      new Request("http://localhost/api/health/preflight", {
        headers: { "x-forwarded-for": "203.0.113.11" },
      }),
    );
    const body = await response.json();

    expect(body.checks[0]).toEqual({
      name: "Postgres",
      status: "fail",
      detail: "Database is not reachable.",
    });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(JSON.stringify(body)).not.toContain("internal-db.local");
  });

  it("rate limits repeated login-page preflight requests", async () => {
    let lastResponse = await GET(
      new Request("http://localhost/api/health/preflight", {
        headers: { "x-forwarded-for": "198.51.100.99" },
      }),
    );

    for (let index = 0; index < 60; index += 1) {
      lastResponse = await GET(
        new Request("http://localhost/api/health/preflight", {
          headers: { "x-forwarded-for": "198.51.100.99" },
        }),
      );
    }

    expect(lastResponse.status).toBe(429);
  });
});
