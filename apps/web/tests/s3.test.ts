import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  sendMock,
  S3ClientMock,
  PutObjectCommandMock,
  GetObjectCommandMock,
  DeleteObjectCommandMock,
  getSignedUrlMock,
} = vi.hoisted(() => {
  const sendMock = vi.fn(() => Promise.resolve({}));
  class S3ClientMock {
    send = sendMock;
  }
  class PutObjectCommandMock {
    _type = "PutObject";
    constructor(input: Record<string, unknown>) {
      Object.assign(this, input);
    }
  }
  class GetObjectCommandMock {
    _type = "GetObject";
    constructor(input: Record<string, unknown>) {
      Object.assign(this, input);
    }
  }
  class DeleteObjectCommandMock {
    _type = "DeleteObject";
    constructor(input: Record<string, unknown>) {
      Object.assign(this, input);
    }
  }
  const getSignedUrlMock = vi.fn(() =>
    Promise.resolve("https://s3.example.com/signed-url"),
  );
  return {
    sendMock,
    S3ClientMock,
    PutObjectCommandMock,
    GetObjectCommandMock,
    DeleteObjectCommandMock,
    getSignedUrlMock,
  };
});

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: S3ClientMock,
  PutObjectCommand: PutObjectCommandMock,
  GetObjectCommand: GetObjectCommandMock,
  DeleteObjectCommand: DeleteObjectCommandMock,
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: getSignedUrlMock,
}));

vi.stubEnv("S3_BUCKET", "test-bucket");
vi.stubEnv("AWS_REGION", "us-east-1");

describe("S3 storage utilities", () => {
  let s3Module: typeof import("@/lib/s3");

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("S3_BUCKET", "test-bucket");
    vi.stubEnv("AWS_REGION", "us-east-1");
    s3Module = await import("@/lib/s3");
  });

  it("exports s3 client", () => {
    expect(s3Module.s3).toBeDefined();
  });

  it("getUploadUrl returns a presigned URL", async () => {
    const url = await s3Module.getUploadUrl("avatars/test.png", "image/png");
    expect(url).toBe("https://s3.example.com/signed-url");
  });

  it("getDownloadUrl returns a presigned URL", async () => {
    const url = await s3Module.getDownloadUrl("avatars/test.png");
    expect(url).toBe("https://s3.example.com/signed-url");
  });

  it("uploadFile sends a PutObjectCommand", async () => {
    await s3Module.uploadFile("test.txt", Buffer.from("hello"), "text/plain");
    expect(s3Module.s3.send).toHaveBeenCalled();
  });

  it("deleteFile sends a DeleteObjectCommand", async () => {
    await s3Module.deleteFile("test.txt");
    expect(s3Module.s3.send).toHaveBeenCalled();
  });

  it("buildKey creates correct paths for avatars", () => {
    const key = s3Module.buildKey("avatar", "ws-123", "photo.png");
    expect(key).toMatch(/^avatars\/ws-123\/\d+-photo\.png$/);
  });

  it("buildKey creates correct paths for attachments", () => {
    const key = s3Module.buildKey("attachment", "ws-456", "doc.pdf");
    expect(key).toMatch(/^attachments\/ws-456\/\d+-doc\.pdf$/);
  });

  it("buildKey creates correct paths for assets", () => {
    const key = s3Module.buildKey("asset", "ws-789", "logo.svg");
    expect(key).toMatch(/^assets\/ws-789\/\d+-logo\.svg$/);
  });

  it("throws when S3_BUCKET is not set", async () => {
    vi.resetModules();
    vi.stubEnv("S3_BUCKET", "");
    const mod = await import("@/lib/s3");
    await expect(mod.getUploadUrl("key", "text/plain")).rejects.toThrow(
      "S3_BUCKET environment variable is not set",
    );
  });
});
