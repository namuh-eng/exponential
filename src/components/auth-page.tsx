"use client";

import { signIn } from "@/lib/auth-client";
import Link from "next/link";
import { useEffect, useState } from "react";

type AuthMode = "login" | "signup";
type LoginStep = "choose" | "email-input" | "email-code";

const authErrorMessages: Record<string, string> = {
  INVALID_TOKEN:
    "That sign-in code is invalid. Request a new email and try again.",
  EXPIRED_TOKEN: "That sign-in code expired. Request a new email to continue.",
  ATTEMPTS_EXCEEDED:
    "That sign-in code has already been used. Request a new email to continue.",
};

function getSafeCallbackPath(): string {
  if (typeof window === "undefined") {
    return "/";
  }

  const callbackUrl = new URLSearchParams(window.location.search).get(
    "callbackUrl",
  );

  if (
    !callbackUrl ||
    !callbackUrl.startsWith("/") ||
    callbackUrl.startsWith("//")
  ) {
    return "/";
  }

  return callbackUrl;
}

function getAbsoluteCallbackUrl(callbackPath: string): string {
  return new URL(callbackPath, window.location.origin).toString();
}

function getErrorCallbackUrl(callbackPath: string): string {
  const errorCallbackUrl = new URL("/login", window.location.origin);
  if (callbackPath !== "/") {
    errorCallbackUrl.searchParams.set("callbackUrl", callbackPath);
  }
  return errorCallbackUrl.toString();
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
      <>
        <p className="mt-8 text-center text-[12px] leading-5 text-[var(--auth-muted)]">
          By signing up, you agree to our{" "}
          <a
            href="https://linear.app/terms"
            className="text-[var(--auth-link)] transition-opacity hover:opacity-80"
          >
            Terms of Service
          </a>{" "}
          and{" "}
          <a
            href="https://linear.app/dpa"
            className="text-[var(--auth-link)] transition-opacity hover:opacity-80"
          >
            Data Processing Agreement
          </a>
          .
        </p>
        <p className="mt-8 text-center text-[14px] text-[var(--auth-muted)]">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-[var(--auth-link)] transition-opacity hover:opacity-80"
          >
            Log in
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <p className="mt-8 text-center text-[12px] leading-5 text-[var(--auth-muted)]">
        By continuing, you agree to our{" "}
        <a
          href="https://linear.app/terms"
          className="text-[var(--auth-link)] transition-opacity hover:opacity-80"
        >
          Terms of Service
        </a>{" "}
        and{" "}
        <a
          href="https://linear.app/privacy"
          className="text-[var(--auth-link)] transition-opacity hover:opacity-80"
        >
          Privacy Policy
        </a>
        .
      </p>
      <p className="mt-8 text-center text-[14px] text-[var(--auth-muted)]">
        Don&apos;t have an account?{" "}
        <Link
          href="/signup"
          className="font-medium text-[var(--auth-link)] transition-opacity hover:opacity-80"
        >
          Sign up
        </Link>{" "}
        or{" "}
        <a
          href="https://linear.app"
          className="font-medium text-[var(--auth-link)] transition-opacity hover:opacity-80"
        >
          learn more
        </a>
      </p>
    </>
  );
}

export function AuthPage({ mode }: { mode: AuthMode }) {
  const [step, setStep] = useState<LoginStep>("choose");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("error");
    if (authError && authErrorMessages[authError]) {
      setError(authErrorMessages[authError]);
    }
  }, []);

  async function handleGoogleLogin() {
    setLoading(true);
    setError("");
    const callbackPath = getSafeCallbackPath();
    await signIn.social({
      provider: "google",
      callbackURL: getAbsoluteCallbackUrl(callbackPath),
    });
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    setError("");

    try {
      const callbackPath = getSafeCallbackPath();
      await signIn.magicLink({
        email,
        callbackURL: getAbsoluteCallbackUrl(callbackPath),
        errorCallbackURL: getErrorCallbackUrl(callbackPath),
      });
      setCode("");
      setStep("email-code");
    } catch {
      setError("Failed to send magic link. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();

    const normalizedCode = code.replace(/\D/g, "").slice(0, 6);
    if (normalizedCode.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }

    const verifyUrl = new URL(
      "/api/auth/magic-link/verify",
      window.location.origin,
    );
    const callbackPath = getSafeCallbackPath();
    verifyUrl.searchParams.set("token", normalizedCode);
    verifyUrl.searchParams.set(
      "callbackURL",
      getAbsoluteCallbackUrl(callbackPath),
    );
    verifyUrl.searchParams.set(
      "errorCallbackURL",
      getErrorCallbackUrl(callbackPath),
    );
    window.location.assign(verifyUrl.toString());
  }

  const title =
    mode === "signup" && step === "email-input"
      ? "What’s your email address?"
      : mode === "signup"
        ? "Create your workspace"
        : "Log in to Linear";
  const backLabel =
    mode === "signup" ? "Back to signup" : "Back to login options";

  return (
    <div className="w-full max-w-[320px] px-6 py-8 sm:px-0">
      <div className="flex flex-col items-center">
        <LinearLogo />
        <h1 className="text-center text-[32px] font-[510] tracking-[-0.035em] text-[var(--auth-text)]">
          {title}
        </h1>
      </div>

      <div className="mt-8 space-y-4">
        {step === "choose" && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={loading}
              className="auth-primary-button flex h-11 w-full items-center justify-center gap-3 rounded-full border border-transparent px-4 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 18 18"
                role="img"
                aria-label="Google"
              >
                <path
                  d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
                  fill="#4285F4"
                />
                <path
                  d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
                  fill="#34A853"
                />
                <path
                  d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
                  fill="#FBBC05"
                />
                <path
                  d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </button>

            <button
              type="button"
              onClick={() => setStep("email-input")}
              disabled={loading}
              className="auth-secondary-button flex h-11 w-full items-center justify-center gap-3 rounded-full border px-4 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                role="img"
                aria-label="Email"
              >
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
              Continue with email
            </button>

            {error && (
              <p className="pt-1 text-center text-sm text-[var(--auth-error)]">
                {error}
              </p>
            )}
          </div>
        )}

        {step === "email-input" && (
          <form onSubmit={handleEmailSubmit} className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email address…"
              required
              className="auth-input h-11 w-full rounded-full border px-4 text-[14px] outline-none transition-colors"
            />
            {mode === "signup" && (
              <input type="hidden" name="cf-turnstile-response" value="" />
            )}
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="auth-primary-button flex h-11 w-full items-center justify-center rounded-full border border-transparent px-4 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Sending…" : "Continue with email"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("choose");
                setError("");
                setCode("");
              }}
              className="w-full pt-1 text-center text-[13px] text-[var(--auth-muted)] transition-opacity hover:opacity-80"
            >
              {backLabel}
            </button>
            {error && (
              <p className="text-center text-sm text-[var(--auth-error)]">
                {error}
              </p>
            )}
          </form>
        )}

        {step === "email-code" && (
          <div className="space-y-5 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[var(--auth-secondary-border)] bg-[var(--auth-secondary-bg)]">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--auth-accent)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                role="img"
                aria-label="Email sent"
              >
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </div>
            <div>
              <h2 className="text-[20px] font-medium tracking-[-0.02em] text-[var(--auth-text)]">
                Check your email
              </h2>
              <p className="mt-2 text-[14px] leading-6 text-[var(--auth-muted)]">
                We sent a sign-in link and 6-digit code to{" "}
                <span className="text-[var(--auth-text)]">{email}</span>
              </p>
            </div>
            <form onSubmit={handleCodeSubmit} className="space-y-3 text-left">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setError("");
                }}
                placeholder="Enter 6-digit code"
                maxLength={6}
                className="auth-input h-11 w-full rounded-full border px-4 text-center text-[15px] tracking-[0.35em] outline-none transition-colors"
              />
              <button
                type="submit"
                disabled={code.length !== 6}
                className="auth-primary-button flex h-11 w-full items-center justify-center rounded-full border border-transparent px-4 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continue with code
              </button>
              {error && (
                <p className="text-center text-sm text-[var(--auth-error)]">
                  {error}
                </p>
              )}
            </form>
            <button
              type="button"
              onClick={() => {
                setStep("choose");
                setEmail("");
                setCode("");
                setError("");
              }}
              className="text-[13px] text-[var(--auth-muted)] transition-opacity hover:opacity-80"
            >
              Use a different method
            </button>
          </div>
        )}
      </div>

      {step === "choose" && <FooterLinks mode={mode} />}
    </div>
  );
}
