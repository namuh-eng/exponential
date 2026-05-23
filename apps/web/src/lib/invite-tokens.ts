import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_INVITE_TTL_SECONDS = 60 * 60 * 24 * 7;
export interface InviteTokenPayload {
  workspaceId: string;
  email: string;
  role: "owner" | "admin" | "member" | "guest";
  teamKey?: string;
  expiresAt: number;
}

function getInviteSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("BETTER_AUTH_SECRET must be set in production");
    }
    return "dev-only-invite-secret-not-for-production";
  }
  return secret;
}

function signPayload(payload: string): string {
  return createHmac("sha256", getInviteSecret())
    .update(payload)
    .digest("base64url");
}

export function createInviteToken(
  invite: Omit<InviteTokenPayload, "expiresAt">,
  ttlSeconds = DEFAULT_INVITE_TTL_SECONDS,
): string {
  const payload = {
    ...invite,
    email: invite.email.trim().toLowerCase(),
    expiresAt: Date.now() + ttlSeconds * 1000,
  } satisfies InviteTokenPayload;

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyInviteToken(token: string): InviteTokenPayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as InviteTokenPayload;

    if (
      !payload.workspaceId ||
      !payload.email ||
      !payload.role ||
      typeof payload.expiresAt !== "number"
    ) {
      return null;
    }

    if (payload.expiresAt <= Date.now()) {
      return null;
    }

    return {
      ...payload,
      email: payload.email.trim().toLowerCase(),
    };
  } catch {
    return null;
  }
}
