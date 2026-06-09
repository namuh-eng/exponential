import { describe, expect, it, vi } from "vitest";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => {
  const S3Client = vi.fn();
  S3Client.prototype.send = vi.fn();
  return {
    S3Client,
    PutObjectCommand: vi.fn(),
    GetObjectCommand: vi.fn(),
    DeleteObjectCommand: vi.fn(),
  };
});

// Mock the whole module to control ensureBucket or the exports
vi.mock("@/lib/s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/s3")>();
  return {
    ...actual,
    getUploadUrl: vi
      .fn()
      .mockImplementation(async () => "https://signed-upload-url"),
    getDownloadUrl: vi
      .fn()
      .mockImplementation(async () => "https://signed-download-url"),
  };
});

import { buildKey, getDownloadUrl, getUploadUrl } from "@/lib/s3";

describe("S3 Utility logic", () => {
  it("builds correct storage keys", () => {
    const key = buildKey("attachment", "ws-1", "test.png");
    expect(key).toMatch(/^attachments\/ws-1\/\d+-test\.png$/);
  });

  it("generates signed upload URLs with correct parameters", async () => {
    const url = await getUploadUrl("key-1", "image/png");
    expect(url).toBe("https://signed-upload-url");
  });

  it("generates signed download URLs", async () => {
    const url = await getDownloadUrl("key-1");
    expect(url).toBe("https://signed-download-url");
  });
});
