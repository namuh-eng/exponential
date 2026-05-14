import { passkeyClient } from "@better-auth/passkey/client";
import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL;

export const authClient = createAuthClient({
  ...(configuredAppUrl ? { baseURL: configuredAppUrl } : {}),
  plugins: [magicLinkClient(), passkeyClient()],
});

export const { signIn, signOut, useSession } = authClient;

type SocialLinkProvider = "google";

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

type AuthClientWithLinkSocial = typeof authClient & {
  linkSocial: (
    options: LinkSocialAccountOptions,
  ) => Promise<LinkSocialAccountResult>;
};

export async function linkSocialAccount(
  options: LinkSocialAccountOptions,
): Promise<LinkSocialAccountResult> {
  return (authClient as AuthClientWithLinkSocial).linkSocial(options);
}

type PasskeySignInOptions = {
  callbackURL: string;
};

type PasskeySignInResult = {
  redirectTo?: string;
};

type PasskeyOperationResult<T> =
  | { data: T; error: null }
  | { data: null; error: { code?: string; message?: string; status?: number } };

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

export function browserSupportsPasskeys() {
  return (
    typeof window !== "undefined" &&
    typeof PublicKeyCredential !== "undefined" &&
    Boolean(navigator.credentials?.create) &&
    Boolean(navigator.credentials?.get)
  );
}

function mapPasskeyErrorCode(code: string | undefined) {
  if (
    code === "AUTH_CANCELLED" ||
    code === "REGISTRATION_CANCELLED" ||
    code === "ERROR_CEREMONY_ABORTED"
  ) {
    return "CANCELED" as const;
  }
  if (code === "NOT_FOUND" || code === "PASSKEY_NOT_FOUND") {
    return "NOT_CONFIGURED" as const;
  }
  return "FAILED" as const;
}

function isCanceledPasskeyException(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "NotAllowedError")
  );
}

function passkeySignInMessage(code: PasskeySignInError["code"]) {
  if (code === "BROWSER_UNSUPPORTED") {
    return "This browser doesn't support passkeys. Use email or Google to log in.";
  }
  if (code === "CANCELED") {
    return "Passkey sign-in was canceled. Try again.";
  }
  if (code === "NOT_CONFIGURED") {
    return "No matching passkey was found. Use email or Google to log in, then add a passkey in Security & access.";
  }
  return "Passkey sign-in failed. Try again or use another method.";
}

function passkeyRegistrationMessage(code: PasskeyRegistrationError["code"]) {
  if (code === "BROWSER_UNSUPPORTED") {
    return "This browser doesn't support passkey enrollment. Use a browser with WebAuthn support.";
  }
  if (code === "CANCELED") {
    return "Passkey enrollment was canceled. Try again when you're ready.";
  }
  if (code === "NOT_CONFIGURED") {
    return "Passkey enrollment isn't configured for this environment.";
  }
  return "Passkey enrollment failed. Try again or use another browser.";
}

export async function signInWithPasskey({
  callbackURL,
}: PasskeySignInOptions): Promise<PasskeySignInResult> {
  if (!browserSupportsPasskeys()) {
    throw new PasskeySignInError(
      passkeySignInMessage("BROWSER_UNSUPPORTED"),
      "BROWSER_UNSUPPORTED",
    );
  }

  let result: PasskeyOperationResult<{
    session: unknown;
  }>;
  try {
    result = (await authClient.signIn.passkey()) as PasskeyOperationResult<{
      session: unknown;
    }>;
  } catch (error) {
    if (isCanceledPasskeyException(error)) {
      throw new PasskeySignInError(
        passkeySignInMessage("CANCELED"),
        "CANCELED",
      );
    }
    throw new PasskeySignInError(passkeySignInMessage("FAILED"), "FAILED");
  }

  if (result.error) {
    const code = mapPasskeyErrorCode(result.error.code);
    throw new PasskeySignInError(
      result.error.message ?? passkeySignInMessage(code),
      code,
    );
  }

  return { redirectTo: callbackURL };
}

export async function enrollPasskey(name: string): Promise<PasskeyRecord> {
  if (!browserSupportsPasskeys()) {
    throw new PasskeyRegistrationError(
      passkeyRegistrationMessage("BROWSER_UNSUPPORTED"),
      "BROWSER_UNSUPPORTED",
    );
  }

  const result = (await authClient.passkey.addPasskey({
    name,
  })) as PasskeyOperationResult<PasskeyRecord>;

  if (result.error) {
    const code = mapPasskeyErrorCode(result.error.code);
    throw new PasskeyRegistrationError(
      result.error.message ?? passkeyRegistrationMessage(code),
      code,
    );
  }

  return result.data;
}
