"use client";

import { ExponentialMark } from "@/components/exponential-mark";
import {
  browserSupportsPasskeys,
  signIn,
  signInWithPasskey,
} from "@/lib/auth-client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type AuthMode = "login" | "signup";
type SignupRouteStep = "identity" | "workspace" | "invite" | "finish";
type HostingMode = "hosted" | "self-hosted";
type LoginStep =
  | "choose"
  | "email-input"
  | "email-verifying"
  | "email-code"
  | "sso-input";
type ProviderCapabilityValue =
  | boolean
  | { configured?: boolean; devLinking?: boolean; supported?: boolean };
type PreflightStatus = "ok" | "warn" | "fail";
type PreflightCheck = {
  name: string;
  status: PreflightStatus;
  detail: string;
};
type PreflightResponse = { checks?: PreflightCheck[] };

type ProviderCapabilities = {
  providers?: {
    google?: ProviderCapabilityValue;
    passkey?: boolean;
    googleAllowed?: boolean;
    emailPasskey?: boolean;
  };
  workspace?: {
    authentication?: {
      google?: boolean;
      emailPasskey?: boolean;
    };
  } | null;
};

function isProviderEnabled(value: ProviderCapabilityValue | undefined) {
  if (typeof value === "boolean") {
    return value;
  }
  return value?.configured === true;
}
type SocialSignInResult = {
  data?: {
    url?: string;
    redirect?: boolean;
  } | null;
  error?: {
    code?: string;
    message?: string;
    status?: number;
  } | null;
};
type SamlDiscoveryResponse = {
  url?: string;
  error?: string;
};
type RecentSessionEntry = {
  id: string;
  workspaceName: string;
  actor: string;
  device: string;
  ipFamily: string;
  loggedInAt: string;
  currentOrigin: boolean;
};
type RecentSessionsResponse = {
  entries: RecentSessionEntry[];
  recognizedOrigin: boolean;
};

const emptyEmailLoginError = "Please enter an email address for login.";
const recentSessionFingerprintCookie = "exp_recent_session_fp";
const signupStorageKey = "exponential.signupWizard";

type SignupWizardState = {
  email: string;
  name: string;
  slug: string;
  hostingMode: HostingMode;
  workspaceId: string;
  verified: boolean;
};

function getSignupStep(): SignupRouteStep {
  if (typeof window === "undefined") return "identity";
  if (window.location.pathname.endsWith("/workspace")) return "workspace";
  if (window.location.pathname.endsWith("/invite")) return "invite";
  if (window.location.pathname.endsWith("/finish")) return "finish";
  return "identity";
}

function loadSignupState(): SignupWizardState {
  const fallback: SignupWizardState = {
    email: "",
    name: "",
    slug: "",
    hostingMode: "hosted",
    workspaceId: "",
    verified: false,
  };
  if (typeof window === "undefined") return fallback;
  try {
    return {
      ...fallback,
      ...JSON.parse(window.localStorage.getItem(signupStorageKey) ?? "{}"),
    };
  } catch {
    return fallback;
  }
}

function saveSignupState(state: SignupWizardState) {
  window.localStorage.setItem(signupStorageKey, JSON.stringify(state));
}

function ensureRecentSessionFingerprint() {
  const existing = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${recentSessionFingerprintCookie}=`));
  if (existing) return;
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  const value = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  document.cookie = `${recentSessionFingerprintCookie}=${value}; path=/; max-age=31536000; samesite=lax`;
}

function formatRecentSessionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function shouldUseNativeEmailValidation(
  form: HTMLFormElement,
  email: string,
): boolean {
  if (!email) {
    return false;
  }

  const emailInput = form.querySelector<HTMLInputElement>(
    'input[type="email"]',
  );
  if (!emailInput || emailInput.validity.valid) {
    return false;
  }

  form.reportValidity();
  return true;
}

const authErrorMessages: Record<string, string> = {
  INVALID_TOKEN:
    "That sign-in code is invalid. Request a new email and try again.",
  EXPIRED_TOKEN: "That sign-in code expired. Request a new email to continue.",
  ATTEMPTS_EXCEEDED:
    "That sign-in code has already been used. Request a new email to continue.",
};

function isSafeLocalCallback(
  callbackUrl: string | null,
): callbackUrl is string {
  return Boolean(callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//"));
}

function getCurrentPathCallback(): string {
  const { pathname } = window.location;

  if (pathname === "/login" || pathname === "/signup") {
    return "/";
  }

  const params = new URLSearchParams(window.location.search);
  params.delete("error");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function getSafeCallbackPath(): string {
  if (typeof window === "undefined") {
    return "/";
  }

  const callbackUrl = new URLSearchParams(window.location.search).get(
    "callbackUrl",
  );

  if (isSafeLocalCallback(callbackUrl)) {
    return callbackUrl;
  }

  return getCurrentPathCallback();
}

function getAbsoluteCallbackUrl(callbackPath: string): string {
  return new URL(callbackPath, window.location.origin).toString();
}

function isWorkspaceLoginSurface(): boolean {
  return (
    typeof window !== "undefined" &&
    window.location.pathname !== "/login" &&
    window.location.pathname !== "/signup"
  );
}

function getErrorCallbackUrl(callbackPath: string): string {
  if (isWorkspaceLoginSurface()) {
    return getAbsoluteCallbackUrl(getCurrentPathCallback());
  }

  const errorCallbackUrl = new URL("/login", window.location.origin);
  if (callbackPath !== "/") {
    errorCallbackUrl.searchParams.set("callbackUrl", callbackPath);
  }
  return errorCallbackUrl.toString();
}

function getSafeRedirectTarget(
  redirectTo: string | undefined,
  fallbackPath: string,
): string {
  if (!redirectTo) {
    return fallbackPath;
  }

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

function AuthLogo() {
  return <ExponentialMark size={20} className="text-[var(--auth-accent)]" />;
}

function TurnstileField() {
  return <input type="hidden" name="cf-turnstile-response" defaultValue="" />;
}

function getTurnstileResponse(form: HTMLFormElement): string | undefined {
  const response = new FormData(form).get("cf-turnstile-response");
  return typeof response === "string" && response.trim()
    ? response.trim()
    : undefined;
}

// Top chrome bar — TTY-style: eˣ exponential · auth · <host> · ● tls ok
function TtyTopBar({ hostLabel }: { hostLabel: string }) {
  return (
    <header className="flex shrink-0 items-center border-b border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-4 py-2 text-[11px] text-[var(--auth-muted)]">
      <span className="flex items-center gap-2">
        <AuthLogo />
        <span className="text-[var(--auth-text)]">exponential</span>
        <span className="text-[var(--auth-faint)]">·</span>
        <span>auth</span>
      </span>
      <span className="flex-1" />
      <span className="text-[var(--auth-faint)]">{hostLabel}</span>
      <span className="mx-2.5 text-[var(--auth-faint)]">·</span>
      <span>
        <span className="text-[var(--auth-accent)]">●</span>
        {" tls ok"}
      </span>
    </header>
  );
}

// Bottom vim-style hotkey bar
function TtyHotkeyBar({ mode }: { mode: AuthMode }) {
  const keys =
    mode === "signup"
      ? [
          ["↵", "submit step"],
          ["tab", "next field"],
          ["esc", "cancel"],
        ]
      : [
          ["↵", "sign in"],
          ["tab", "next field"],
          ["⌃u", "clear"],
          ["g", "google"],
          ["?", "help"],
        ];
  return (
    <footer className="flex shrink-0 items-center gap-4 border-t border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-4 py-1.5 text-[11px] text-[var(--auth-muted)]">
      <span className="text-[var(--auth-accent)]">:</span>
      {keys.map(([k, label]) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <kbd className="border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-1.5 py-0.5 text-[10px] text-[var(--auth-text)]">
            {k}
          </kbd>
          <span>{label}</span>
        </span>
      ))}
      <span className="ml-auto text-[var(--auth-faint)]">INSERT</span>
    </footer>
  );
}

// Right-column: preflight doctor panel using real preflightChecks data
function PreflightRail({
  checks,
  hasFailure,
}: {
  checks: PreflightCheck[];
  hasFailure: boolean;
}) {
  return (
    <section aria-label="Authentication preflight checks">
      <div className="border-b border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-muted)]">
        # preflight
      </div>
      {hasFailure ? (
        <output className="block border-b border-[var(--auth-secondary-border)] px-3 py-2 text-[12px] text-[var(--auth-err)]">
          One or more login dependencies need attention. You can still try to
          log in.
        </output>
      ) : null}
      <ul className="divide-y divide-[var(--auth-secondary-border)] text-[11.5px]">
        {checks.map((check) => (
          <li
            key={check.name}
            className="flex items-center justify-between px-3 py-1.5"
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={
                  check.status === "ok"
                    ? "text-[var(--auth-ok)]"
                    : check.status === "warn"
                      ? "text-[var(--auth-warn)]"
                      : "text-[var(--auth-err)]"
                }
              >
                {check.status === "ok"
                  ? "●"
                  : check.status === "warn"
                    ? "▲"
                    : "✕"}
              </span>
              <span className="text-[var(--auth-text)]">{check.name}</span>
            </span>
            <span className="text-[var(--auth-muted)]">{check.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function preflightStatusClass(status: PreflightStatus): string {
  if (status === "ok") {
    return "text-[var(--auth-ok)]";
  }
  if (status === "warn") {
    return "text-[var(--auth-warn)]";
  }
  return "text-[var(--auth-err)]";
}

// Right-column: recent sessions table using real recentSessions data
function RecentSessionsRail({
  sessions,
  recognizedOrigin,
}: {
  sessions: RecentSessionEntry[];
  recognizedOrigin: boolean;
}) {
  return (
    <section>
      <div className="border-b border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-muted)]">
        # recent sessions on this host
      </div>
      <div className="divide-y divide-[var(--auth-secondary-border)] text-[11.5px]">
        {sessions.length === 0 ? (
          <div className="px-3 py-2 text-[var(--auth-faint)]">
            no recent sessions
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={`flex items-center gap-2 px-3 py-1.5 ${
                session.currentOrigin
                  ? "border-l-2 border-[var(--auth-accent)] bg-[var(--auth-input-bg)]"
                  : "border-l-2 border-transparent"
              }`}
            >
              <span
                className={
                  session.currentOrigin
                    ? "text-[var(--auth-accent)]"
                    : "text-[var(--auth-muted)]"
                }
              >
                {session.currentOrigin ? "●" : "○"}
              </span>
              <span className="text-[var(--auth-accent)]">
                @{session.actor}
              </span>
              <span className="flex-1 truncate text-[var(--auth-muted)]">
                {session.device}
              </span>
              <span className="shrink-0 text-[var(--auth-faint)]">
                {formatRecentSessionTime(session.loggedInAt)}
              </span>
            </div>
          ))
        )}
      </div>
      {!recognizedOrigin && sessions.length > 0 ? (
        <div className="border-t border-[var(--auth-secondary-border)] px-3 py-2 text-[10.5px] text-[var(--auth-warn)]">
          ▲ unrecognized origin · we&apos;ll email you on every new device.
        </div>
      ) : null}
    </section>
  );
}

// Right-column: CLI pairing snippet — always shown
function CliPairingSnippet({ hostLabel }: { hostLabel: string }) {
  return (
    <section>
      <div className="border-b border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-muted)]">
        # pair from terminal
      </div>
      <pre className="px-3 py-3 text-[11px] leading-relaxed text-[var(--auth-muted)]">
        {"$ exponential login --host "}
        <span className="text-[var(--auth-text)]">{hostLabel}</span>
        {"\n→ visit "}
        <span className="text-[var(--auth-text)]">
          https://{hostLabel}/auth/cli
        </span>
        {"\n→ paste code: "}
        <span className="text-[var(--auth-accent)]">H7K-4QM-92T</span>
      </pre>
    </section>
  );
}

function FooterLinks({ mode }: { mode: AuthMode }) {
  if (mode === "signup") {
    return (
      <>
        <p className="mt-6 text-[12px] text-[var(--auth-muted)]">
          By signing up, you agree to our{" "}
          <a
            href="/terms"
            className="text-[var(--auth-link)] underline-offset-4 hover:underline"
          >
            Terms of Service
          </a>{" "}
          and{" "}
          <a
            href="/dpa"
            className="text-[var(--auth-link)] underline-offset-4 hover:underline"
          >
            Data Processing Agreement
          </a>
          .
        </p>
        <p className="mt-4 text-[12px] text-[var(--auth-muted)]">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-[var(--auth-link)] underline-offset-4 hover:underline"
          >
            Log in
          </Link>
        </p>
      </>
    );
  }

  return (
    <p className="mt-6 text-[12px] text-[var(--auth-muted)]">
      <span className="sr-only">Don’t have an account? </span>
      <Link
        href="/signup"
        className="text-[var(--auth-link)] underline-offset-4 hover:underline"
      >
        Sign up
      </Link>
      {" · "}
      <Link
        href="/homepage"
        className="text-[var(--auth-link)] underline-offset-4 hover:underline"
      >
        learn more
      </Link>
    </p>
  );
}

function SignupWizard() {
  const [routeStep] = useState<SignupRouteStep>(getSignupStep);
  const [state, setState] = useState<SignupWizardState>(loadSignupState);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [inviteEmails, setInviteEmails] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  function update(next: Partial<SignupWizardState>) {
    const merged = { ...state, ...next };
    setState(merged);
    saveSignupState(merged);
  }

  useEffect(() => {
    if (routeStep !== "workspace" || state.slug.trim().length < 2) {
      setSlugAvailable(null);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/workspaces/slug-available?slug=${encodeURIComponent(state.slug)}`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as { available?: boolean };
        setSlugAvailable(response.ok && data.available === true);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setSlugAvailable(false);
      }
    }, 350);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [routeStep, state.slug]);

  async function submitIdentity(event: React.FormEvent) {
    event.preventDefault();
    if (!state.email.includes("@")) {
      setStatus("Enter a valid email address.");
      return;
    }
    update({
      slug:
        state.slug ||
        state.email
          .split("@")[0]
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "-"),
    });
    window.location.assign("/signup/workspace");
  }

  async function submitWorkspace(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setStatus("");
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: state.slug,
          name: state.slug,
          hostingMode: state.hostingMode,
          ownerIdentity: { email: state.email, name: state.name },
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Failed to create workspace");
      const next = { ...state, workspaceId: data.workspace.id };
      setState(next);
      saveSignupState(next);
      const verify = await fetch(
        `/api/workspaces/${data.workspace.id}/verify-email`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: state.email }),
        },
      );
      const verifyData = await verify.json();
      if (verifyData.devCode)
        setStatus(`Development code: ${verifyData.devCode}`);
      window.location.assign("/signup/invite");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Failed to create workspace",
      );
    } finally {
      setLoading(false);
    }
  }

  async function verifyAndInvite(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setStatus("");
    try {
      if (!state.verified) {
        const response = await fetch(
          `/api/workspaces/${state.workspaceId}/verify-email`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: state.email, code }),
          },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Verification failed");
        update({ verified: true });
      }
      const emails = inviteEmails
        .split(/[\n,]/)
        .map((email) => email.trim())
        .filter(Boolean);
      if (emails.length > 0) {
        const inviteResponse = await fetch(
          `/api/workspaces/${state.workspaceId}/invites`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              invites: emails.map((email) => ({ email, role: "member" })),
            }),
          },
        );
        const inviteData = await inviteResponse.json();
        if (!inviteResponse.ok)
          throw new Error(inviteData.error ?? "Failed to send invites");
      }
      window.location.assign("/signup/finish");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to continue");
    } finally {
      setLoading(false);
    }
  }

  const steps: SignupRouteStep[] = [
    "identity",
    "workspace",
    "invite",
    "finish",
  ];
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-8">
      <div className="w-full max-w-[360px]">
        <div className="mb-6 flex items-center gap-3">
          <ExponentialMark size={20} className="text-[var(--auth-accent)]" />
          <span className="text-[var(--auth-text)]">exponential</span>
          <span className="text-[var(--auth-faint)]">·</span>
          <span className="text-[var(--auth-muted)] text-[12px]">
            {steps.map((step, i) => (
              <span key={step}>
                <span
                  className={
                    step === routeStep
                      ? "text-[var(--auth-text)]"
                      : "text-[var(--auth-faint)]"
                  }
                >
                  {step}
                </span>
                {i < steps.length - 1 ? (
                  <span className="text-[var(--auth-faint)]"> → </span>
                ) : null}
              </span>
            ))}
          </span>
        </div>

        <h1 className="mb-6 text-[28px] font-semibold tracking-tight text-[var(--auth-text)]">
          Create your account
        </h1>

        {routeStep === "identity" && (
          <form onSubmit={submitIdentity} className="space-y-3">
            <div className="border border-[var(--auth-input-border)] bg-[var(--auth-input-bg)]">
              <label className="flex items-center gap-3 px-3 py-2.5">
                <span
                  aria-hidden="true"
                  className="text-[13px] text-[var(--auth-prompt)]"
                >
                  {">"}
                </span>
                <input
                  type="text"
                  value={state.name}
                  onChange={(e) => update({ name: e.target.value })}
                  placeholder="Your name"
                  className="flex-1 bg-transparent text-[13px] text-[var(--auth-text)] outline-none placeholder:text-[var(--auth-input-placeholder)]"
                />
              </label>
            </div>
            <div className="border border-[var(--auth-input-border)] bg-[var(--auth-input-bg)]">
              <label className="flex items-center gap-3 px-3 py-2.5">
                <span
                  aria-hidden="true"
                  className="text-[13px] text-[var(--auth-prompt)]"
                >
                  {">"}
                </span>
                <input
                  type="email"
                  required
                  value={state.email}
                  onChange={(e) => update({ email: e.target.value })}
                  placeholder="Work email"
                  className="flex-1 bg-transparent text-[13px] text-[var(--auth-text)] outline-none placeholder:text-[var(--auth-input-placeholder)]"
                />
              </label>
            </div>
            <button
              type="submit"
              className="auth-primary-button flex h-10 w-full items-center justify-between border border-[var(--auth-primary-border)] px-3 text-[13px] text-[var(--auth-primary-text)] transition-colors hover:bg-[var(--auth-primary-bg-hover)]"
            >
              <span className="inline-flex items-center gap-3">
                <span aria-hidden="true">{"[↵]"}</span>
                <span>Continue</span>
              </span>
              <span
                aria-hidden="true"
                className="text-[11px] text-[var(--auth-faint)]"
              >
                ↵
              </span>
            </button>
          </form>
        )}

        {routeStep === "workspace" && (
          <form onSubmit={submitWorkspace} className="space-y-3">
            <div className="border border-[var(--auth-input-border)] bg-[var(--auth-input-bg)]">
              <label className="flex items-center gap-3 px-3 py-2.5">
                <span
                  aria-hidden="true"
                  className="text-[13px] text-[var(--auth-prompt)]"
                >
                  {">"}
                </span>
                <input
                  required
                  value={state.slug}
                  onChange={(e) =>
                    update({ slug: e.target.value.toLowerCase() })
                  }
                  placeholder="workspace-slug"
                  className="flex-1 bg-transparent text-[13px] text-[var(--auth-text)] outline-none placeholder:text-[var(--auth-input-placeholder)]"
                />
              </label>
            </div>
            {slugAvailable !== null && (
              <p
                className={`text-[12px] ${slugAvailable ? "text-[var(--auth-ok)]" : "text-[var(--auth-err)]"}`}
              >
                {slugAvailable ? "Slug is available" : "Slug is unavailable"}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => update({ hostingMode: "hosted" })}
                className="auth-secondary-button border border-[var(--auth-secondary-border)] p-3 text-[13px] transition-colors hover:bg-[var(--auth-secondary-bg-hover)]"
              >
                Hosted
              </button>
              <button
                type="button"
                onClick={() => update({ hostingMode: "self-hosted" })}
                className="auth-secondary-button border border-[var(--auth-secondary-border)] p-3 text-[13px] transition-colors hover:bg-[var(--auth-secondary-bg-hover)]"
              >
                Self-host
              </button>
            </div>
            <button
              type="submit"
              disabled={loading || slugAvailable === false}
              className="auth-primary-button flex h-10 w-full items-center justify-between border border-[var(--auth-primary-border)] px-3 text-[13px] text-[var(--auth-primary-text)] transition-colors hover:bg-[var(--auth-primary-bg-hover)] disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-3">
                <span aria-hidden="true">{"[↵]"}</span>
                <span>{loading ? "Creating…" : "Create workspace"}</span>
              </span>
              <span
                aria-hidden="true"
                className="text-[11px] text-[var(--auth-faint)]"
              >
                ↵
              </span>
            </button>
          </form>
        )}

        {routeStep === "invite" && (
          <form onSubmit={verifyAndInvite} className="space-y-3">
            <p className="text-[13px] text-[var(--auth-muted)]">
              Enter the 6-digit code sent to {state.email} before inviting
              teammates.
            </p>
            <div className="border border-[var(--auth-input-border)] bg-[var(--auth-input-bg)]">
              <label className="flex items-center gap-3 px-3 py-2.5">
                <span
                  aria-hidden="true"
                  className="text-[13px] text-[var(--auth-prompt)]"
                >
                  {">"}
                </span>
                <input
                  inputMode="numeric"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="6-digit code"
                  className="flex-1 bg-transparent text-center text-[13px] tracking-[0.35em] text-[var(--auth-text)] outline-none placeholder:text-[var(--auth-input-placeholder)]"
                />
              </label>
            </div>
            <textarea
              value={inviteEmails}
              onChange={(e) => setInviteEmails(e.target.value)}
              placeholder="teammate@company.com, another@company.com"
              className="min-h-24 w-full border border-[var(--auth-input-border)] bg-[var(--auth-input-bg)] px-3 py-2.5 text-[13px] text-[var(--auth-text)] outline-none placeholder:text-[var(--auth-input-placeholder)]"
            />
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="auth-primary-button flex h-10 w-full items-center justify-between border border-[var(--auth-primary-border)] px-3 text-[13px] text-[var(--auth-primary-text)] transition-colors hover:bg-[var(--auth-primary-bg-hover)] disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-3">
                <span aria-hidden="true">{"[↵]"}</span>
                <span>Verify and send invites</span>
              </span>
              <span
                aria-hidden="true"
                className="text-[11px] text-[var(--auth-faint)]"
              >
                ↵
              </span>
            </button>
          </form>
        )}

        {routeStep === "finish" && (
          <div className="space-y-3">
            <p className="text-[13px] text-[var(--auth-muted)]">
              Your workspace is ready.
            </p>
            <button
              type="button"
              onClick={() => {
                window.localStorage.removeItem(signupStorageKey);
                window.location.assign(`/${state.slug || ""}`);
              }}
              className="auth-primary-button flex h-10 w-full items-center justify-between border border-[var(--auth-primary-border)] px-3 text-[13px] text-[var(--auth-primary-text)] transition-colors hover:bg-[var(--auth-primary-bg-hover)]"
            >
              <span className="inline-flex items-center gap-3">
                <span aria-hidden="true">{"[↵]"}</span>
                <span>Go to dashboard</span>
              </span>
              <span
                aria-hidden="true"
                className="text-[11px] text-[var(--auth-faint)]"
              >
                ↵
              </span>
            </button>
          </div>
        )}

        {status && (
          <p className="mt-4 text-[12px] text-[var(--auth-err)]">{status}</p>
        )}
        <FooterLinks mode="signup" />
      </div>
    </div>
  );
}

export function AuthPage({
  mode,
  initialGoogleConfigured = false,
}: {
  mode: AuthMode;
  initialGoogleConfigured?: boolean;
}) {
  if (
    mode === "signup" &&
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/signup/")
  ) {
    return <SignupWizard />;
  }

  const [step, setStep] = useState<LoginStep>("choose");
  const [email, setEmail] = useState("");
  const [ssoIdentifier, setSsoIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [passkeyPending, setPasskeyPending] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState<boolean | null>(
    initialGoogleConfigured,
  );
  const [googleAllowed, setGoogleAllowed] = useState(true);
  const [passkeyConfigured, setPasskeyConfigured] = useState<boolean | null>(
    true,
  );
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [googleDisabledByWorkspace, setGoogleDisabledByWorkspace] =
    useState(false);
  const [error, setError] = useState("");
  const [preflightChecks, setPreflightChecks] = useState<
    PreflightCheck[] | null
  >(null);
  const [recentSessions, setRecentSessions] = useState<RecentSessionEntry[]>(
    [],
  );
  const [recognizedOrigin, setRecognizedOrigin] = useState(true);
  const [hostLabel, setHostLabel] = useState("host:unknown");
  const emailSubmitAttemptRef = useRef(0);

  useEffect(() => {
    setPasskeySupported(browserSupportsPasskeys());
    ensureRecentSessionFingerprint();
    if (typeof window !== "undefined") {
      const host = window.location.host;
      if (!host) {
        setHostLabel("host:unknown");
      } else if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
        setHostLabel("local preview");
      } else {
        setHostLabel(host);
      }
    }
  }, []);

  useEffect(() => {
    if (
      process.env.NODE_ENV === "test" ||
      process.env.PLAYWRIGHT_TEST === "true" ||
      mode !== "login"
    ) {
      return;
    }
    const controller = new AbortController();
    async function loadRecentSessions() {
      try {
        const url = new URL(
          "/api/auth/sessions/recent",
          window.location.origin,
        );
        url.searchParams.set("host", window.location.hostname);
        url.searchParams.set("callbackUrl", getSafeCallbackPath());
        const response = await fetch(`${url.pathname}${url.search}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok || response.status === 401) {
          setRecentSessions([]);
          return;
        }
        const data = (await response.json()) as RecentSessionsResponse;
        setRecentSessions(Array.isArray(data.entries) ? data.entries : []);
        setRecognizedOrigin(data.recognizedOrigin !== false);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setRecentSessions([]);
        }
      }
    }
    loadRecentSessions();
    return () => controller.abort();
  }, [mode]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("error");
    if (authError && authErrorMessages[authError]) {
      setError(authErrorMessages[authError]);
    }
  }, []);

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
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw new Error("Failed to load auth provider capabilities.");
        }
        const data = (await response.json()) as ProviderCapabilities;
        setGoogleConfigured(isProviderEnabled(data.providers?.google));
        setGoogleAllowed(data.providers?.googleAllowed !== false);
        setPasskeyConfigured(
          data.providers?.emailPasskey !== false &&
            data.providers?.passkey === true,
        );
        setEmailConfigured(
          data.workspace?.authentication?.emailPasskey !== false,
        );
        setGoogleDisabledByWorkspace(
          data.workspace?.authentication?.google === false,
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setGoogleConfigured(false);
        setGoogleAllowed(true);
        setPasskeyConfigured(true);
        setEmailConfigured(true);
        setGoogleDisabledByWorkspace(false);
      }
    }

    loadProviderCapabilities();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (process.env.PLAYWRIGHT_TEST === "true") {
      return;
    }

    const controller = new AbortController();

    async function loadPreflightChecks() {
      try {
        const response = await fetch("/api/health/preflight", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as PreflightResponse;
        if (Array.isArray(data.checks)) {
          setPreflightChecks(data.checks);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setPreflightChecks(null);
      }
    }

    loadPreflightChecks();

    return () => controller.abort();
  }, []);

  async function handleGoogleLogin() {
    if (!googleAllowed) {
      setError(
        "Google sign-in is disabled for this workspace. Use SAML SSO instead.",
      );
      return;
    }

    if (googleConfigured !== true) {
      setError(
        "Google sign-in is not configured. Use email or SAML SSO instead.",
      );
      return;
    }

    setLoading(true);
    setError("");
    try {
      const callbackPath = getSafeCallbackPath();
      const result = (await signIn.social({
        provider: "google",
        callbackURL: getAbsoluteCallbackUrl(callbackPath),
      })) as SocialSignInResult | undefined;

      if (result?.error) {
        const isMissingProvider =
          result.error.status === 404 ||
          result.error.code === "PROVIDER_NOT_FOUND";
        setError(
          isMissingProvider
            ? "Google sign-in is not configured. Use email or SAML SSO instead."
            : (result.error.message ??
                "Google sign-in failed. Try again or use another method."),
        );
        setLoading(false);
        return;
      }

      if (result?.data?.url) {
        window.location.assign(result.data.url);
      }
    } catch {
      setError("Google sign-in failed. Try again or use another method.");
      setLoading(false);
    }
  }

  async function handleEmailSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      setError(emptyEmailLoginError);
      return;
    }

    if (shouldUseNativeEmailValidation(e.currentTarget, normalizedEmail)) {
      setError("");
      return;
    }

    if (emailConfigured === false) {
      setError(
        "Email and passkey authentication is disabled for this workspace. Use SAML SSO instead.",
      );
      return;
    }

    const submitAttempt = emailSubmitAttemptRef.current + 1;
    emailSubmitAttemptRef.current = submitAttempt;
    setEmail(normalizedEmail);
    setCode("");
    setStep("email-verifying");
    setLoading(true);
    setError("");

    try {
      const callbackPath = getSafeCallbackPath();
      const turnstileResponse = getTurnstileResponse(e.currentTarget);
      await signIn.magicLink({
        email: normalizedEmail,
        callbackURL: getAbsoluteCallbackUrl(callbackPath),
        errorCallbackURL: getErrorCallbackUrl(callbackPath),
        ...(turnstileResponse
          ? {
              fetchOptions: {
                headers: { "x-captcha-response": turnstileResponse },
              },
            }
          : {}),
      });
      if (emailSubmitAttemptRef.current === submitAttempt) {
        setStep("email-code");
      }
    } catch {
      if (emailSubmitAttemptRef.current === submitAttempt) {
        setStep("email-input");
        setError("Failed to send magic link. Please try again.");
      }
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

  async function handleSsoSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const normalizedSsoIdentifier = ssoIdentifier.trim();

    if (!normalizedSsoIdentifier) {
      setError(emptyEmailLoginError);
      return;
    }

    if (
      shouldUseNativeEmailValidation(e.currentTarget, normalizedSsoIdentifier)
    ) {
      setError("");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const callbackPath = getSafeCallbackPath();
      const response = await fetch("/api/auth/saml/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedSsoIdentifier,
          isDesktop: false,
          type: "login",
          callbackURL: getAbsoluteCallbackUrl(callbackPath),
        }),
      });
      const data = (await response.json()) as SamlDiscoveryResponse;

      if (!response.ok || !data.url) {
        setError(data.error ?? "No SAML SSO enabled workspace could be found.");
        setLoading(false);
        return;
      }

      window.location.assign(data.url);
    } catch {
      setError("Failed to look up SAML SSO. Please try again.");
      setLoading(false);
    }
  }

  async function handlePasskeyLogin() {
    if (passkeyConfigured === false) {
      setError(
        "Passkey sign-in is disabled for this workspace. Use SAML SSO instead.",
      );
      return;
    }
    if (!passkeySupported) {
      setError(
        "This browser doesn't support passkeys. Use email or Google to log in.",
      );
      return;
    }

    setPasskeyPending(true);
    setError("");

    try {
      const callbackPath = getSafeCallbackPath();
      const result = await signInWithPasskey({
        callbackURL: getAbsoluteCallbackUrl(callbackPath),
      });
      window.location.assign(
        getSafeRedirectTarget(result.redirectTo, callbackPath),
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Passkey sign-in failed. Try again or use another method.",
      );
    } finally {
      setPasskeyPending(false);
    }
  }

  const hasPreflightFailure =
    preflightChecks?.some((check) => check.status === "fail") === true;

  const title =
    step === "email-verifying"
      ? "Verifying it’s you"
      : step === "email-input" || step === "sso-input"
        ? "What’s your email address?"
        : mode === "signup"
          ? "Create your account"
          : "Log in to exponential";
  const backLabel = mode === "signup" ? "Back to signup" : "Back to login";

  return (
    <div className="flex h-full flex-col">
      <TtyTopBar hostLabel={hostLabel} />

      {/* Two-column grid: left = auth form, right = preflight + sessions + CLI */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
        {/* Left — auth actions */}
        <div className="flex flex-col border-r border-[var(--auth-secondary-border)] px-10 py-12 lg:px-16">
          <div className="mb-6">
            <p className="mb-1.5 text-[11px] uppercase tracking-[0.12em] text-[var(--auth-accent)]">
              {mode === "signup"
                ? "// session · new workspace"
                : "// session · open"}
            </p>
            <h1
              aria-label={title}
              className="text-[28px] font-bold leading-tight tracking-tight text-[var(--auth-text)]"
            >
              {title}
            </h1>
          </div>

          {/* Error banner */}
          {error ? (
            <div
              className="mb-4 border border-[var(--auth-err)]/40 bg-[var(--auth-err)]/10 px-3 py-2 text-[12px] text-[var(--auth-err)]"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          {/* step: choose */}
          {step === "choose" && (
            <div className="space-y-2.5">
              {/* OAuth buttons — 2-col grid */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {googleAllowed && (
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={loading}
                    className="flex items-center gap-3 border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-3 py-3 text-[13px] text-[var(--auth-text)] transition-colors hover:bg-[var(--auth-secondary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
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
                    <span className="flex flex-col gap-0.5">
                      <span>
                        {googleConfigured === null
                          ? "Checking Google sign-in"
                          : "Continue with Google"}
                      </span>
                      <span
                        aria-hidden="true"
                        className="text-[10.5px] text-[var(--auth-faint)]"
                      >
                        oauth · workspace email
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="ml-auto text-[10.5px] text-[var(--auth-faint)]"
                    >
                      g
                    </span>
                  </button>
                )}

                {passkeyConfigured !== false && (
                  <button
                    type="button"
                    onClick={() => {
                      setPasskeyPending(false);
                      setStep("email-input");
                    }}
                    disabled={loading}
                    className="flex items-center gap-3 border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-3 py-3 text-[13px] text-[var(--auth-text)] transition-colors hover:bg-[var(--auth-secondary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
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
                    <span className="flex flex-col gap-0.5">
                      <span>Continue with email</span>
                      <span
                        aria-hidden="true"
                        className="text-[10.5px] text-[var(--auth-faint)]"
                      >
                        magic link · sent to inbox
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="ml-auto text-[10.5px] text-[var(--auth-faint)]"
                    >
                      ↵
                    </span>
                  </button>
                )}
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3 py-1 text-[10.5px] text-[var(--auth-faint)]">
                <span className="h-px flex-1 bg-[var(--auth-secondary-border)]" />
                <span>── or with SAML / passkey ──</span>
                <span className="h-px flex-1 bg-[var(--auth-secondary-border)]" />
              </div>

              {/* SAML SSO */}
              <button
                type="button"
                onClick={() => {
                  setStep("sso-input");
                  setPasskeyPending(false);
                  setError("");
                }}
                disabled={loading}
                className="flex w-full items-center gap-3 border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-3 py-2.5 text-[13px] text-[var(--auth-text)] transition-colors hover:bg-[var(--auth-secondary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span aria-hidden="true" className="text-[var(--auth-prompt)]">
                  {">"}
                </span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  role="img"
                  aria-label="SAML"
                >
                  <path d="M4 7h16" />
                  <path d="M7 11h10" />
                  <path d="M9 15h6" />
                  <path d="M12 3 3 7.5v9L12 21l9-4.5v-9L12 3Z" />
                </svg>
                <span>Continue with SAML SSO</span>
                <span
                  aria-hidden="true"
                  className="ml-auto text-[10.5px] text-[var(--auth-faint)]"
                >
                  oidc · enterprise
                </span>
              </button>

              {mode === "login" && passkeyConfigured !== false && (
                <button
                  type="button"
                  onClick={handlePasskeyLogin}
                  disabled={loading || passkeyPending || !passkeySupported}
                  className="flex w-full items-center gap-3 border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-3 py-2.5 text-[13px] text-[var(--auth-text)] transition-colors hover:bg-[var(--auth-secondary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span
                    aria-hidden="true"
                    className="text-[var(--auth-prompt)]"
                  >
                    {">"}
                  </span>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    role="img"
                    aria-label="Passkey"
                  >
                    <path d="M10 13a5 5 0 1 1 3.54 1.46L12 16h-2v2H8v2H5v-3l4.54-4.54A5 5 0 0 1 10 13Z" />
                    <path d="M15 9h.01" />
                  </svg>
                  <span>
                    {passkeyPending
                      ? "Waiting for passkey"
                      : "Log in with passkey"}
                  </span>
                  <span
                    aria-hidden="true"
                    className="ml-auto text-[10.5px] text-[var(--auth-faint)]"
                  >
                    webauthn
                  </span>
                </button>
              )}

              {passkeyConfigured === true && !passkeySupported ? (
                <p className="text-[12px] text-[var(--auth-err)]">
                  This browser doesn&apos;t support passkeys. Use email or
                  Google instead.
                </p>
              ) : null}

              {googleDisabledByWorkspace && emailConfigured === false ? (
                <p className="text-[12px] text-[var(--auth-muted)]">
                  Google, email, and passkey login are disabled for this
                  workspace. Continue with SAML SSO.
                </p>
              ) : null}

              {/* # advanced auth */}
              <details className="mt-2">
                <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-[11px] text-[var(--auth-muted)] hover:text-[var(--auth-text)]">
                  <span className="text-[var(--auth-accent)]">▾</span>
                  <span># advanced auth</span>
                  <span className="text-[var(--auth-faint)]">
                    · ssh · oidc · cli
                  </span>
                </summary>
                <div className="mt-2 space-y-1.5">
                  {[
                    {
                      k: "ssh",
                      name: "ssh key",
                      cmd: "$ exponential auth ssh",
                      hint: "paste public key",
                    },
                    {
                      k: "oidc",
                      name: "oidc / saml",
                      cmd: "$ exponential auth oidc",
                      hint: "enterprise · self-host",
                    },
                    {
                      k: "cli",
                      name: "device code",
                      cmd: "$ exponential login",
                      hint: "cli pairing · 6-digit",
                    },
                  ].map((s) => (
                    <div
                      key={s.k}
                      className="grid grid-cols-[36px_1fr_1fr_70px] items-center gap-2 border border-[var(--auth-secondary-border)] px-3 py-2 text-[12px]"
                    >
                      <span className="text-[10.5px] text-[var(--auth-faint)]">
                        [{s.k}]
                      </span>
                      <span className="text-[var(--auth-text)]">{s.name}</span>
                      <span className="truncate text-[11px] text-[var(--auth-muted)]">
                        {s.cmd}
                      </span>
                      <span className="text-right text-[10.5px] text-[var(--auth-faint)]">
                        {s.hint}
                      </span>
                    </div>
                  ))}
                </div>
              </details>

              {step === "choose" && <FooterLinks mode={mode} />}
            </div>
          )}

          {/* step: email-input */}
          {step === "email-input" && (
            <form onSubmit={handleEmailSubmit} noValidate className="space-y-3">
              <div className="border border-[var(--auth-input-border)] bg-[var(--auth-input-bg)] focus-within:border-[var(--auth-accent)]">
                <label className="flex items-center gap-3 px-3 py-2.5">
                  <span
                    aria-hidden="true"
                    className="select-none text-[13px] text-[var(--auth-prompt)]"
                  >
                    {">"}
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setError("");
                    }}
                    placeholder="Enter your email address…"
                    required
                    className="flex-1 bg-transparent text-[13px] text-[var(--auth-text)] outline-none placeholder:text-[var(--auth-input-placeholder)]"
                  />
                </label>
              </div>
              <TurnstileField />
              <button
                type="submit"
                disabled={loading}
                className="flex h-10 w-full items-center justify-between border border-[var(--auth-primary-border)] bg-[var(--auth-primary-bg)] px-3 text-[13px] text-[var(--auth-primary-text)] transition-colors hover:bg-[var(--auth-primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-3">
                  <span aria-hidden="true">{"[↵]"}</span>
                  <span>{loading ? "Sending…" : "Continue with email"}</span>
                </span>
                <span
                  aria-hidden="true"
                  className="text-[11px] text-[var(--auth-faint)]"
                >
                  ↵
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  emailSubmitAttemptRef.current += 1;
                  setLoading(false);
                  setStep("choose");
                  setError("");
                  setCode("");
                }}
                className="w-full pt-1 text-left text-[12px] text-[var(--auth-muted)] transition-opacity hover:opacity-80"
              >
                {backLabel}
              </button>
            </form>
          )}

          {/* step: email-verifying */}
          {step === "email-verifying" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-3 py-3">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--auth-accent)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  role="img"
                  aria-label="Verification in progress"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
                <p className="text-[13px] text-[var(--auth-muted)]">
                  Confirming this sign-in request before sending your email link
                  and code.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  emailSubmitAttemptRef.current += 1;
                  setLoading(false);
                  setStep("choose");
                  setError("");
                  setCode("");
                }}
                className="w-full pt-1 text-left text-[12px] text-[var(--auth-muted)] transition-opacity hover:opacity-80"
              >
                {backLabel}
              </button>
            </div>
          )}

          {/* step: sso-input */}
          {step === "sso-input" && (
            <form onSubmit={handleSsoSubmit} noValidate className="space-y-3">
              <div className="border border-[var(--auth-input-border)] bg-[var(--auth-input-bg)] focus-within:border-[var(--auth-accent)]">
                <label className="flex items-center gap-3 px-3 py-2.5">
                  <span
                    aria-hidden="true"
                    className="select-none text-[13px] text-[var(--auth-prompt)]"
                  >
                    {">"}
                  </span>
                  <input
                    type="email"
                    value={ssoIdentifier}
                    onChange={(e) => {
                      setSsoIdentifier(e.target.value);
                      setError("");
                    }}
                    placeholder="Enter your email address…"
                    required
                    className="flex-1 bg-transparent text-[13px] text-[var(--auth-text)] outline-none placeholder:text-[var(--auth-input-placeholder)]"
                  />
                </label>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="flex h-10 w-full items-center justify-between border border-[var(--auth-primary-border)] bg-[var(--auth-primary-bg)] px-3 text-[13px] text-[var(--auth-primary-text)] transition-colors hover:bg-[var(--auth-primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-3">
                  <span aria-hidden="true">{"[↵]"}</span>
                  <span>
                    {loading ? "Checking SAML…" : "Continue with SAML"}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="text-[11px] text-[var(--auth-faint)]"
                >
                  ↵
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("choose");
                  setSsoIdentifier("");
                  setError("");
                }}
                disabled={loading}
                className="w-full pt-1 text-left text-[12px] text-[var(--auth-muted)] transition-opacity hover:opacity-80"
              >
                {backLabel}
              </button>
            </form>
          )}

          {/* step: email-code */}
          {step === "email-code" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-3 py-3">
                <svg
                  width="18"
                  height="18"
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
                <div>
                  <h2 className="text-[14px] font-medium text-[var(--auth-text)]">
                    Check your email
                  </h2>
                  <p className="text-[12px] text-[var(--auth-muted)]">
                    Sign-in link and 6-digit code sent to{" "}
                    <span className="text-[var(--auth-text)]">{email}</span>
                  </p>
                </div>
              </div>
              <form onSubmit={handleCodeSubmit} className="space-y-3">
                <div className="border border-[var(--auth-input-border)] bg-[var(--auth-input-bg)] focus-within:border-[var(--auth-accent)]">
                  <label className="flex items-center gap-3 px-3 py-2.5">
                    <span
                      aria-hidden="true"
                      className="select-none text-[13px] text-[var(--auth-prompt)]"
                    >
                      {">"}
                    </span>
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
                      className="flex-1 bg-transparent text-center text-[14px] tracking-[0.35em] text-[var(--auth-text)] outline-none placeholder:text-[var(--auth-input-placeholder)]"
                    />
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={code.length !== 6}
                  className="flex h-10 w-full items-center justify-between border border-[var(--auth-primary-border)] bg-[var(--auth-primary-bg)] px-3 text-[13px] text-[var(--auth-primary-text)] transition-colors hover:bg-[var(--auth-primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="inline-flex items-center gap-3">
                    <span aria-hidden="true">{"[↵]"}</span>
                    <span>Continue with code</span>
                  </span>
                  <span className="text-[11px] text-[var(--auth-faint)]">
                    ↵
                  </span>
                </button>
              </form>
              <button
                type="button"
                onClick={() => {
                  setStep("choose");
                  setEmail("");
                  setCode("");
                  setError("");
                }}
                className="text-[12px] text-[var(--auth-muted)] transition-opacity hover:opacity-80"
              >
                Use a different method
              </button>
            </div>
          )}
        </div>

        {/* Right — preflight doctor + recent sessions + CLI pairing */}
        <div className="hidden flex-col divide-y divide-[var(--auth-secondary-border)] lg:flex">
          {/* Preflight panel — shown when data is loaded, else empty-state */}
          {preflightChecks ? (
            <PreflightRail
              checks={preflightChecks}
              hasFailure={hasPreflightFailure}
            />
          ) : (
            <div className="px-3 py-2 text-[11px] text-[var(--auth-faint)]">
              # preflight · checking…
            </div>
          )}

          {/* Recent sessions — always render (shows "no recent sessions" when empty) */}
          {mode === "login" ? (
            <RecentSessionsRail
              sessions={recentSessions}
              recognizedOrigin={recognizedOrigin}
            />
          ) : null}

          {/* CLI pairing snippet */}
          <CliPairingSnippet hostLabel={hostLabel} />
        </div>
      </div>

      <TtyHotkeyBar mode={mode} />
    </div>
  );
}
