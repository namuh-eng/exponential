import { createNoStoreServerApiClientFromHeaders } from "@/lib/server-api-client";

export type WebSession = {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
};

// Browser page loads authenticate solely through the forwarded `cookie`
// header (see server-api-client). Both the current and legacy session cookie
// names are checked. PAT/Authorization auth is headless-only and never reaches
// a page render, so cookie absence is a definitive "no session".
const SESSION_COOKIE_NAMES = ["exponential_session", "session_token"];

function hasSessionCookie(headerList: Headers): boolean {
  const cookieHeader = headerList.get("cookie");
  if (!cookieHeader) {
    return false;
  }
  return cookieHeader
    .split(";")
    .some((pair) => SESSION_COOKIE_NAMES.includes(pair.split("=")[0]?.trim()));
}

export async function getWebSession(headerList: Headers) {
  // Anonymous visitors carry no session cookie; skip the /auth/session round
  // trip entirely instead of paying a network call to learn there is no user.
  if (!hasSessionCookie(headerList)) {
    return null;
  }

  const client = createNoStoreServerApiClientFromHeaders(headerList);
  const result = await client.GET("/auth/session");
  if (result.response.status === 401) {
    return null;
  }
  return result.data
    ? ({
        user: {
          ...result.data.user,
          image: result.data.user.image ?? null,
        },
      } satisfies WebSession)
    : null;
}
