import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

type KratosWhoami = {
  identity?: { traits?: { email?: unknown } };
};

export type WebSession = {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
};

function headlessAuthEnabled() {
  return process.env.EXPONENTIAL_HEADLESS_AUTH_PROVIDERS === "true";
}

function kratosPublicUrl() {
  return (
    process.env.EXPONENTIAL_KRATOS_PUBLIC_URL ??
    process.env.EXPONENTIAL_API_KRATOS_URL ??
    "http://localhost:4433"
  ).replace(/\/$/, "");
}

export async function getKratosSession(
  headerList: Headers,
): Promise<WebSession | null> {
  const cookie = headerList.get("cookie") ?? "";
  const sessionToken = headerList.get("x-session-token")?.trim() ?? "";
  if (!cookie && !sessionToken) return null;

  const kratosHeaders = new Headers({ accept: "application/json" });
  if (cookie) kratosHeaders.set("cookie", cookie);
  if (sessionToken) kratosHeaders.set("x-session-token", sessionToken);

  const response = await fetch(`${kratosPublicUrl()}/sessions/whoami`, {
    headers: kratosHeaders,
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) return null;

  const whoami = (await response
    .json()
    .catch(() => null)) as KratosWhoami | null;
  const email =
    typeof whoami?.identity?.traits?.email === "string"
      ? whoami.identity.traits.email.trim().toLowerCase()
      : "";
  if (!email) return null;

  const [record] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return record ? { user: record } : null;
}

export async function getWebSession(headerList: Headers) {
  if (headlessAuthEnabled()) {
    return getKratosSession(headerList);
  }

  const { auth } = await import("@/lib/auth");
  return auth.api.getSession({ headers: headerList });
}
