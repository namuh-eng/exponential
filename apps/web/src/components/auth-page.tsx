"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type AuthMode = "login" | "signup";
type ProviderCapabilities = {
  providers?: {
    google?: boolean | { configured?: boolean };
    googleAllowed?: boolean;
    emailPasskey?: boolean;
    passkey?: boolean;
  };
};

type KratosNode = {
  attributes?: {
    name?: string;
    value?: string;
  };
  messages?: Array<{ text?: string }>;
};

type KratosFlow = {
  id: string;
  ui: {
    action: string;
    nodes?: KratosNode[];
    messages?: Array<{ text?: string }>;
  };
};

function isProviderEnabled(
  value: boolean | { configured?: boolean } | undefined,
) {
  if (typeof value === "boolean") return value;
  return value?.configured === true;
}

function isSafeLocalCallback(
  callbackUrl: string | null,
): callbackUrl is string {
  return Boolean(callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//"));
}

function getCurrentPathCallback(): string {
  const { pathname } = window.location;
  if (pathname === "/login" || pathname === "/signup") return "/";
  const params = new URLSearchParams(window.location.search);
  params.delete("error");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function getSafeCallbackPath(): string {
  if (typeof window === "undefined") return "/";
  const callbackUrl = new URLSearchParams(window.location.search).get(
    "callbackUrl",
  );
  if (isSafeLocalCallback(callbackUrl)) return callbackUrl;
  return getCurrentPathCallback();
}

function getAbsoluteCallbackUrl(callbackPath: string): string {
  return new URL(callbackPath, window.location.origin).toString();
}

function getSafeRedirectTarget(
  redirectTo: string | undefined,
  fallbackPath: string,
): string {
  if (!redirectTo) return fallbackPath;
  try {
    const redirectUrl = new URL(redirectTo, window.location.origin);
    if (redirectUrl.origin === window.location.origin) {
      return `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`;
    }
  } catch {
    // Fall back to the already sanitized callback path below.
  }
  return fallbackPath;
}

function LinearLogo() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="Linear logo"
      className="mb-7 text-[var(--auth-logo)]"
    >
      <path
        d="M.392 19.687c-.071-.303.29-.494.511-.274l11.684 11.684c.22.22.03.582-.274.51a16.04 16.04 0 0 1-11.92-11.92ZM0 15.005c-.005.09.029.179.093.243l16.66 16.659a.317.317 0 0 0 .242.092 16.02 16.02 0 0 0 2.229-.296c.244-.05.33-.35.152-.527L.825 12.624a.311.311 0 0 0-.527.152c-.15.726-.25 1.47-.296 2.229ZM1.347 9.506a.316.316 0 0 0 .067.352l20.728 20.728c.093.093.233.12.352.067a15.961 15.961 0 0 0 1.66-.86.314.314 0 0 0 .058-.492L2.7 7.788a.314.314 0 0 0-.493.058 15.965 15.965 0 0 0-.859 1.66ZM4.05 5.784a.315.315 0 0 1-.013-.434A15.976 15.976 0 0 1 15.985 0C24.83 0 32 7.17 32 16.015c0 4.75-2.067 9.015-5.35 11.948a.315.315 0 0 1-.434-.014L4.051 5.784Z"
        fill="currentColor"
      />
    </svg>
  );
}

function FooterLinks({ mode }: { mode: AuthMode }) {
  if (mode === "signup") {
    return (
      <p className="mt-8 text-center text-[14px] text-[var(--auth-muted)]">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-[var(--auth-link)] transition-opacity hover:opacity-80"
        >
          Log in
        </Link>
      </p>
    );
  }
  return (
    <p className="mt-8 text-center text-[14px] text-[var(--auth-muted)]">
      Don’t have an account?{" "}
      <Link
        href="/signup"
        className="font-medium text-[var(--auth-link)] transition-opacity hover:opacity-80"
      >
        Sign up
      </Link>{" "}
      or{" "}
      <Link
        href="/homepage"
        className="font-medium text-[var(--auth-link)] transition-opacity hover:opacity-80"
      >
        learn more
      </Link>
    </p>
  );
}

function kratosProxyAction(action: string) {
  const url = new URL(action, window.location.origin);
  return `/api/auth/kratos${url.pathname}${url.search}`;
}

function kratosCsrfToken(flow: KratosFlow | null) {
  return flow?.ui.nodes?.find((node) => node.attributes?.name === "csrf_token")
    ?.attributes?.value;
}

function kratosFlowMessage(flow: KratosFlow | null) {
  return (
    flow?.ui.messages?.find((message) => message.text)?.text ??
    flow?.ui.nodes
      ?.flatMap((node) => node.messages ?? [])
      .find((message) => message.text)?.text ??
    null
  );
}

export function AuthPage({ mode }: { mode: AuthMode }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [flow, setFlow] = useState<KratosFlow | null>(null);
  const [googleAvailable, setGoogleAvailable] = useState(true);
  const [samlAvailable, setSamlAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [error, setError] = useState("");

  async function getFlow() {
    if (flow) return flow;
    const callbackPath = getSafeCallbackPath();
    const kind = mode === "signup" ? "registration" : "login";
    const response = await fetch(
      `/api/auth/kratos/self-service/${kind}/browser?return_to=${encodeURIComponent(
        getAbsoluteCallbackUrl(callbackPath),
      )}`,
      {
        credentials: "include",
        headers: { accept: "application/json" },
      },
    );
    if (!response.ok) throw new Error("Unable to start the auth flow.");
    const nextFlow = (await response.json()) as KratosFlow;
    setFlow(nextFlow);
    return nextFlow;
  }

  async function submitKratos(body: Record<string, unknown>) {
    const currentFlow = await getFlow();
    const csrfToken = kratosCsrfToken(currentFlow);
    const response = await fetch(kratosProxyAction(currentFlow.ui.action), {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(
        csrfToken ? { ...body, csrf_token: csrfToken } : body,
      ),
    });
    const payload = (await response.json().catch(() => null)) as
      | (Partial<KratosFlow> & { redirect_browser_to?: string })
      | null;
    if (response.ok) {
      window.location.assign(
        getSafeRedirectTarget(
          payload?.redirect_browser_to,
          getSafeCallbackPath(),
        ),
      );
      return;
    }
    if (payload?.ui) setFlow(payload as KratosFlow);
    throw new Error(
      kratosFlowMessage((payload as KratosFlow | null) ?? currentFlow) ??
        "Authentication failed. Check your details and try again.",
    );
  }

  useEffect(() => {
    const controller = new AbortController();
    async function loadProviderCapabilities() {
      try {
        const callbackPath = getSafeCallbackPath();
        const capabilitiesUrl = new URL(
          "/api/auth/provider-capabilities",
          window.location.origin,
        );
        if (callbackPath !== "/") {
          capabilitiesUrl.searchParams.set("callbackUrl", callbackPath);
        }
        const response = await fetch(
          `${capabilitiesUrl.pathname}${capabilitiesUrl.search}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) return;
        const data = (await response.json()) as ProviderCapabilities;
        setGoogleAvailable(
          data.providers?.googleAllowed !== false &&
            isProviderEnabled(data.providers?.google) !== false,
        );
        setSamlAvailable(
          data.providers?.googleAllowed === false &&
            data.providers?.emailPasskey === false &&
            data.providers?.passkey === false,
        );
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setGoogleAvailable(true);
          setSamlAvailable(false);
        }
      }
    }
    void loadProviderCapabilities();
    return () => controller.abort();
  }, []);

  async function runAuth(action: () => Promise<void>) {
    setLoading(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Authentication failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handlePasswordSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runAuth(async () => {
      if (mode === "signup") {
        await submitKratos({
          method: "password",
          password,
          traits: { email: email.trim(), name: name.trim() || email.trim() },
        });
      } else {
        await submitKratos({
          method: "password",
          identifier: email.trim(),
          password,
        });
      }
    });
  }

  function handleGoogleLogin() {
    void runAuth(() => submitKratos({ method: "oidc", provider: "google" }));
  }

  function handleMagicLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runAuth(async () => {
      await submitKratos({ method: "link", identifier: email.trim() });
      setMagicLinkSent(true);
    });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--auth-bg)] px-6 py-12 text-[var(--auth-text)]">
      <div className="w-full max-w-[400px]">
        <LinearLogo />
        <h1 className="text-[32px] font-medium tracking-[-0.03em]">
          {mode === "signup" ? "Create your account" : "Log in to Linear"}
        </h1>
        <p className="mt-3 text-[14px] leading-6 text-[var(--auth-muted)]">
          Authentication is handled by Ory Kratos for the headless API.
        </p>

        {error ? (
          <div
            className="mt-5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-200"
            role="alert"
          >
            {error}
          </div>
        ) : null}
        {magicLinkSent ? (
          <div className="mt-5 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-[var(--auth-muted)]">
            Check your email for the sign-in link.
          </div>
        ) : null}

        {googleAvailable ? (
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="mt-8 h-11 w-full rounded-md border border-[var(--auth-border)] bg-transparent text-[14px] font-medium text-[var(--auth-text)] transition-colors hover:bg-white/5 disabled:opacity-60"
          >
            Continue with Google
          </button>
        ) : null}

        <form onSubmit={handlePasswordSubmit} className="mt-3 space-y-3">
          {mode === "signup" ? (
            <input
              className="h-11 w-full rounded-md border border-[var(--auth-border)] bg-[var(--auth-input-bg)] px-3 text-[14px] outline-none"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              autoComplete="name"
            />
          ) : null}
          <input
            className="h-11 w-full rounded-md border border-[var(--auth-border)] bg-[var(--auth-input-bg)] px-3 text-[14px] outline-none"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email address"
            autoComplete="email"
          />
          <input
            className="h-11 w-full rounded-md border border-[var(--auth-border)] bg-[var(--auth-input-bg)] px-3 text-[14px] outline-none"
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
          />
          <button
            type="submit"
            disabled={loading}
            className="h-11 w-full rounded-md bg-[var(--auth-button-bg)] text-[14px] font-medium text-[var(--auth-button-text)] transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {loading
              ? "Please wait…"
              : mode === "signup"
                ? "Sign up with Kratos"
                : "Log in with Kratos"}
          </button>
        </form>

        {mode === "login" ? (
          <>
            <form onSubmit={handleMagicLink} className="mt-3">
              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="h-11 w-full rounded-md border border-[var(--auth-border)] bg-transparent text-[14px] font-medium text-[var(--auth-text)] transition-colors hover:bg-white/5 disabled:opacity-60"
              >
                Send magic link instead
              </button>
            </form>
            {samlAvailable ? (
              <button
                type="button"
                className="mt-3 h-11 w-full rounded-md border border-[var(--auth-border)] bg-transparent text-[14px] font-medium text-[var(--auth-text)] transition-colors hover:bg-white/5"
              >
                Continue with SAML SSO
              </button>
            ) : null}
          </>
        ) : null}
        <FooterLinks mode={mode} />
      </div>
    </main>
  );
}
