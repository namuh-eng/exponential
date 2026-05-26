import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getBrowserFingerprint,
  getClientIpFromHeaders,
  toIpFamily,
} from "@/lib/auth-recent-sessions";
import { sendNewDeviceLoginEmail } from "@/lib/email";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@aws-sdk/client-sesv2", () => ({
  SESv2Client: vi.fn().mockImplementation(function SESv2Client() {
    return {
      send: vi.fn().mockRejectedValue(new Error("SES disabled in tests")),
    };
  }),
  SendEmailCommand: vi
    .fn()
    .mockImplementation(function SendEmailCommand(input) {
      return { input };
    }),
}));

describe("recent auth sessions helpers", () => {
  it("normalizes IPv4 addresses to /24 families", () => {
    expect(toIpFamily("203.0.113.42")).toBe("203.0.113.0/24");
  });

  it("prefers trusted proxy headers for client IP", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.7, 10.0.0.1",
    });
    expect(getClientIpFromHeaders(headers)).toBe("198.51.100.7");
  });

  it("reads the same-browser correlation cookie without exposing it", () => {
    const headers = new Headers({
      cookie: "theme=dark; exp_recent_session_fp=abc123",
    });
    expect(getBrowserFingerprint(headers)).toBe("abc123");
  });
});

describe("new device login email", () => {
  const previousPreviewPath = process.env.EMAIL_PREVIEW_PATH;
  let tempDir: string | null = null;

  afterEach(async () => {
    process.env.EMAIL_PREVIEW_PATH = previousPreviewPath;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  it("uses the new-device security copy and records a preview in non-production", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "new-device-email-"));
    const previewPath = path.join(tempDir, "latest.json");
    process.env.EMAIL_PREVIEW_PATH = previewPath;

    await sendNewDeviceLoginEmail("person@example.com", {
      device: "Chrome on macOS",
      ipFamily: "203.0.113.0/24",
    });

    const preview = JSON.parse(await readFile(previewPath, "utf8")) as {
      to: string;
      subject: string;
      text: string;
    };
    expect(preview.to).toBe("person@example.com");
    expect(preview.subject).toBe("New device signed in to exponential");
    expect(preview.text).toContain("A new device just signed in");
    expect(preview.text).toContain("Chrome on macOS");
  });
});
