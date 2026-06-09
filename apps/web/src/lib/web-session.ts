import { createNoStoreServerApiClientFromHeaders } from "@/lib/server-api-client";

export type WebSession = {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
};

export async function getWebSession(headerList: Headers) {
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
