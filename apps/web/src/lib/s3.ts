import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const region = process.env.AWS_REGION ?? "us-east-1";
const bucket = process.env.S3_BUCKET;

export const s3 = new S3Client({ region });

function ensureBucket(): string {
  if (!bucket) {
    throw new Error("S3_BUCKET environment variable is not set");
  }
  return bucket;
}

/**
 * Generate a presigned URL for uploading a file directly from the client.
 */
export async function getUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: ensureBucket(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

/**
 * Generate a presigned URL for downloading/viewing a file.
 */
export async function getDownloadUrl(
  key: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: ensureBucket(),
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

/**
 * Upload a file directly from the server (for small files like avatars).
 */
export async function uploadFile(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: ensureBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/**
 * Delete a file from S3.
 */
export async function deleteFile(key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: ensureBucket(),
      Key: key,
    }),
  );
}

/**
 * Build a storage key for different asset types.
 */
export function buildKey(
  type: "avatar" | "attachment" | "asset",
  workspaceId: string,
  filename: string,
): string {
  return `${type}s/${workspaceId}/${Date.now()}-${filename}`;
}
