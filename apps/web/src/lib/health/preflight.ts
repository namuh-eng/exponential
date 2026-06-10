import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { GetAccountCommand } from "@aws-sdk/client-sesv2";
import { sql } from "drizzle-orm";

export type PreflightStatus = "ok" | "warn" | "fail";

export type PreflightCheck = {
  name: string;
  status: PreflightStatus;
  detail: string;
};

const CHECK_TIMEOUT_MS = 1500;

async function withTimeout<T>(
  work: Promise<T>,
  ms = CHECK_TIMEOUT_MS,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function ok(name: string, detail: string): PreflightCheck {
  return { name, status: "ok", detail };
}

function warn(name: string, detail: string): PreflightCheck {
  return { name, status: "warn", detail };
}

function fail(name: string, detail: string): PreflightCheck {
  return { name, status: "fail", detail };
}

async function checkPostgres(): Promise<PreflightCheck> {
  try {
    const { db } = await import("@/lib/db");
    await withTimeout(db.execute(sql`select 1`));
    return ok("Postgres", "Database accepts queries.");
  } catch {
    return fail("Postgres", "Database is not reachable.");
  }
}

async function checkRedis(): Promise<PreflightCheck> {
  if (!process.env.REDIS_URL) {
    return warn("Redis", "Cache URL is not configured.");
  }

  try {
    const { redis } = await import("@/lib/redis");
    await withTimeout(redis.ping());
    return ok("Redis", "Cache accepts commands.");
  } catch {
    return fail("Redis", "Cache is not reachable.");
  }
}

async function checkS3(): Promise<PreflightCheck> {
  if (!process.env.S3_BUCKET) {
    return warn("S3", "Object storage bucket is not configured.");
  }

  try {
    const { s3 } = await import("@/lib/s3");
    await withTimeout(
      s3.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET })),
    );
    return ok("S3", "Object storage bucket is reachable.");
  } catch {
    return fail("S3", "Object storage is not reachable.");
  }
}

async function checkSes(): Promise<PreflightCheck> {
  try {
    const { ses } = await import("@/lib/email");
    await withTimeout(ses.send(new GetAccountCommand({})));
    return ok("SES", "Email provider is reachable.");
  } catch {
    if (process.env.NODE_ENV !== "production") {
      return warn("SES", "Email provider is using local preview fallback.");
    }
    return fail("SES", "Email provider is not reachable.");
  }
}

function checkClock(): PreflightCheck {
  const now = Date.now();
  if (!Number.isFinite(now) || now <= 0) {
    return fail("Clock", "Server clock is invalid.");
  }
  return ok("Clock", "Server clock is available.");
}

function checkAlb(request: Request): PreflightCheck {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedFor = request.headers.get("x-forwarded-for");
  const hasForwardedAlbHeaders = Boolean(forwardedProto || forwardedFor);

  if (process.env.NODE_ENV === "production" && !hasForwardedAlbHeaders) {
    return warn("Load balancer", "Edge forwarding headers were not detected.");
  }

  return ok("Load balancer", "Login traffic path is accepting requests.");
}

export async function getPreflightChecks(
  request: Request,
): Promise<PreflightCheck[]> {
  const [postgres, redis, s3, sesCheck] = await Promise.all([
    checkPostgres(),
    checkRedis(),
    checkS3(),
    checkSes(),
  ]);

  return [postgres, redis, s3, sesCheck, checkClock(), checkAlb(request)];
}
