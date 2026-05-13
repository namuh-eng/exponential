import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL;

export const authClient = createAuthClient({
  ...(configuredAppUrl ? { baseURL: configuredAppUrl } : {}),
  plugins: [magicLinkClient()],
});

export const { signIn, signOut, useSession } = authClient;

type PasskeySignInOptions = {
  callbackURL: string;
};

type PasskeySignInResult = {
  redirectTo?: string;
};

type PasskeyVerificationResponse = {
  redirectTo?: string;
  url?: string;
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

function getPasskeyChallenge() {
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  return challenge;
}

function toBase64Url(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function serializeCredential(credential: Credential) {
  if (!(credential instanceof PublicKeyCredential)) {
    return {
      id: credential.id,
      type: credential.type,
    };
  }

  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    response: {
      authenticatorData: toBase64Url(response.authenticatorData),
      clientDataJSON: toBase64Url(response.clientDataJSON),
      signature: toBase64Url(response.signature),
      userHandle: response.userHandle ? toBase64Url(response.userHandle) : null,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

function isAbortLikeError(error: unknown) {
  return (
    error instanceof DOMException &&
    ["AbortError", "NotAllowedError"].includes(error.name)
  );
}

export async function signInWithPasskey({
  callbackURL,
}: PasskeySignInOptions): Promise<PasskeySignInResult> {
  if (
    typeof window === "undefined" ||
    typeof PublicKeyCredential === "undefined" ||
    !navigator.credentials?.get
  ) {
    throw new PasskeySignInError(
      "This browser doesn't support passkeys. Use email or Google to log in.",
      "BROWSER_UNSUPPORTED",
    );
  }

  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        challenge: getPasskeyChallenge(),
        timeout: 60_000,
        userVerification: "preferred",
      },
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new PasskeySignInError(
        "Passkey sign-in was canceled. Try again.",
        "CANCELED",
      );
    }

    throw new PasskeySignInError(
      "Passkey sign-in failed. Try again or use another method.",
      "FAILED",
    );
  }

  if (!credential) {
    throw new PasskeySignInError(
      "Passkey sign-in was canceled. Try again.",
      "CANCELED",
    );
  }

  const response = await fetch("/api/auth/passkey/verify-authentication", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      credential: serializeCredential(credential),
      callbackURL,
    }),
  });

  if (!response.ok) {
    throw new PasskeySignInError(
      "Passkey login isn't configured for this workspace yet. Use email or Google to log in.",
      response.status === 404 ? "NOT_CONFIGURED" : "FAILED",
    );
  }

  const data = (await response.json().catch(() => ({}))) as
    | PasskeyVerificationResponse
    | undefined;
  return { redirectTo: data?.redirectTo ?? data?.url };
}
