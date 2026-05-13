import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL;

export const authClient = createAuthClient({
  ...(configuredAppUrl ? { baseURL: configuredAppUrl } : {}),
  plugins: [magicLinkClient()],
});

export const { signIn, signOut, useSession } = authClient;
