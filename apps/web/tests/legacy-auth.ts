type LegacyAuthSession = {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
};

type LegacyAuthContext = {
  internalAdapter: {
    createSession: (
      userId: string,
      rememberMe: boolean,
      metadata: { userAgent?: string; ipAddress?: string },
    ) => Promise<{ token: string; expiresAt: Date }>;
  };
  secret: string;
  authCookies: {
    sessionToken: {
      name: string;
      attributes: {
        httpOnly?: boolean;
        path?: string;
        sameSite?: string;
        secure?: boolean;
      };
    };
  };
};

/**
 * Deprecated Better Auth compatibility shim.
 *
 * Runtime authentication is handled by first-party Go auth in the headless split. This
 * module remains only so legacy route tests can keep importing `@/lib/auth`
 * while those test fixtures are migrated to Go/API coverage.
 */
export const auth: {
  api: { getSession: (_args?: unknown) => Promise<LegacyAuthSession | null> };
  handler: (_request?: Request) => Promise<Response>;
  $context: Promise<LegacyAuthContext>;
} = {
  api: {
    async getSession() {
      return null;
    },
  },
  async handler() {
    return new Response(
      JSON.stringify({ error: "Better Auth has been removed" }),
      {
        status: 410,
        headers: { "content-type": "application/json" },
      },
    );
  },
  $context: Promise.resolve({
    internalAdapter: {
      async createSession() {
        throw new Error("Better Auth session creation has been removed");
      },
    },
    secret: "go-auth-shim",
    authCookies: {
      sessionToken: {
        name: "exponential_session",
        attributes: { httpOnly: true, path: "/", sameSite: "lax" },
      },
    },
  } satisfies LegacyAuthContext),
};
