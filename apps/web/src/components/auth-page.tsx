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

export function AuthPage({ mode }: { mode: AuthMode }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [googleAvailable, setGoogleAvailable] = useState(true);
  const [samlAvailable, setSamlAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [error, setError] = useState("");

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
      throw new Error(
        "Password login is not configured yet. Use Google or magic link.",
      );
    });
  }

  function handleGoogleLogin() {
    void runAuth(async () => {
      const callbackPath = getSafeCallbackPath();
      const params = new URLSearchParams({ callback_url: callbackPath });
      window.location.assign(`/api/auth/google/start?${params.toString()}`);
    });
  }

  function handleMagicLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runAuth(async () => {
      const response = await fetch("/api/auth/magic-link", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          callbackURL: getSafeCallbackPath(),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "Unable to send magic link.");
      }
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
          Authentication is handled by the headless Go API.
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
                ? "Create account"
                : "Log in"}
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
