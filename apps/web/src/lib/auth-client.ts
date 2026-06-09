type SocialLinkProvider = "google" | "github" | "gitlab" | "slack";

type SocialSignInOptions = {
  provider: SocialLinkProvider;
  callbackURL: string;
  errorCallbackURL?: string;
};

type MagicLinkOptions = {
  email: string;
  callbackURL: string;
  errorCallbackURL?: string;
  fetchOptions?: { headers?: Record<string, string> };
};

type LinkSocialAccountOptions = {
  provider: SocialLinkProvider;
  callbackURL: string;
  errorCallbackURL?: string;
};

type LinkSocialAccountResult = {
  url?: string;
  data?: { url?: string; redirect?: boolean };
  error?: { code?: string; status?: number; message?: string };
};

type UnlinkSocialAccountOptions = {
  providerId: SocialLinkProvider;
  accountId?: string;
};

type UnlinkSocialAccountResult = {
  data?: { status?: boolean };
  error?: { code?: string; status?: number; message?: string };
};

type PasskeySignInOptions = {
  callbackURL: string;
};

type PasskeySignInResult = {
  redirectTo?: string;
};

type PasskeyRecord = {
  id: string;
  name?: string | null;
  createdAt?: Date | string | null;
};

export class PasskeySignInError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "BROWSER_UNSUPPORTED"
      | "CANCELED"
      | "NOT_CONFIGURED"
      | "FAILED",
  ) {
    super(message);
    this.name = "PasskeySignInError";
  }
}

export class PasskeyRegistrationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "BROWSER_UNSUPPORTED"
      | "CANCELED"
      | "NOT_CONFIGURED"
      | "FAILED",
  ) {
    super(message);
    this.name = "PasskeyRegistrationError";
  }
}

function localPathFromCallback(callbackURL: string) {
  const parsed = new URL(callbackURL, window.location.origin);
  if (parsed.origin !== window.location.origin) return "/";
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function googleStartURL(callbackURL: string) {
  const params = new URLSearchParams({
    callback_url: localPathFromCallback(callbackURL),
  });
  return `/api/auth/google/start?${params.toString()}`;
}

export const signIn = {
  async social(options: SocialSignInOptions): Promise<LinkSocialAccountResult> {
    if (options.provider !== "google") {
      return {
        error: {
          code: "unsupported_provider",
          message: `${options.provider} sign-in is not configured.`,
        },
      };
    }
    const url = googleStartURL(options.callbackURL);
    return { data: { url, redirect: true }, url };
  },
  async magicLink(options: MagicLinkOptions): Promise<unknown> {
    const response = await fetch("/api/auth/magic-link", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(options.fetchOptions?.headers ?? {}),
      },
      body: JSON.stringify({
        email: options.email,
        callbackURL: localPathFromCallback(options.callbackURL),
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(payload?.error ?? "Unable to send magic link.");
    }
    return response.json().catch(() => ({ ok: true }));
  },
};

export async function signOut() {
  await fetch("/api/auth/sign-out", {
    method: "POST",
    credentials: "include",
  });
  window.location.assign("/login");
}

export function useSession() {
  return { data: null, isPending: false };
}

export const authClient = { signIn, signOut, useSession };

export async function linkSocialAccount(
  options: LinkSocialAccountOptions,
): Promise<LinkSocialAccountResult> {
  return signIn.social(options);
}

export async function unlinkSocialAccount(
  options: UnlinkSocialAccountOptions,
): Promise<UnlinkSocialAccountResult> {
  const response = await fetch("/api/account/connections", {
    method: "DELETE",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!response.ok) {
    return {
      error: {
        status: response.status,
        message: "Unable to disconnect this account.",
      },
    };
  }
  return { data: { status: true } };
}

export function browserSupportsPasskeys() {
  return (
    typeof window !== "undefined" &&
    typeof PublicKeyCredential !== "undefined" &&
    Boolean(navigator.credentials?.create) &&
    Boolean(navigator.credentials?.get)
  );
}

function passkeyUnavailableMessage() {
  return "Passkey authentication is not configured in this environment.";
}

export async function signInWithPasskey({
  callbackURL,
}: PasskeySignInOptions): Promise<PasskeySignInResult> {
  void callbackURL;
  if (!browserSupportsPasskeys()) {
    throw new PasskeySignInError(
      "This browser doesn't support passkeys. Use email or Google to log in.",
      "BROWSER_UNSUPPORTED",
    );
  }
  throw new PasskeySignInError(passkeyUnavailableMessage(), "NOT_CONFIGURED");
}

export async function enrollPasskey(_name: string): Promise<PasskeyRecord> {
  if (!browserSupportsPasskeys()) {
    throw new PasskeyRegistrationError(
      "This browser doesn't support passkey enrollment. Use a browser with WebAuthn support.",
      "BROWSER_UNSUPPORTED",
    );
  }
  throw new PasskeyRegistrationError(
    passkeyUnavailableMessage(),
    "NOT_CONFIGURED",
  );
}
