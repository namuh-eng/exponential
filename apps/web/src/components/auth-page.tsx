"use client";

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

function TurnstileField() {
  return <input type="hidden" name="cf-turnstile-response" defaultValue="" />;
}

function getTurnstileResponse(form: HTMLFormElement): string | undefined {
  const response = new FormData(form).get("cf-turnstile-response");
  return typeof response === "string" && response.trim()
    ? response.trim()
    : undefined;
}

function RecentSessionsRail({
  sessions,
  recognizedOrigin,
}: {
  sessions: RecentSessionEntry[];
  recognizedOrigin: boolean;
}) {
  if (sessions.length === 0) return null;

  return (
    <aside className="hidden w-[360px] rounded-3xl border border-[var(--auth-secondary-border)] bg-[var(--auth-secondary-bg)] p-5 text-[var(--auth-text)] shadow-2xl lg:block">
      <div className="mb-4">
        <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-[var(--auth-muted)]">
          Recent sessions on this host
        </p>
        <h2 className="mt-2 text-[18px] font-medium tracking-[-0.02em]">
          Recognized workspace activity
        </h2>
      </div>
      {!recognizedOrigin ? (
        <output className="mb-4 block rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-[13px] leading-5 text-amber-100">
          Unrecognized origin. We have not seen this network in the recent
          session list.
        </output>
      ) : null}
      <div className="space-y-3">
        {sessions.map((session) => (
          <div
            key={session.id}
            className="rounded-2xl border border-[var(--auth-secondary-border)] bg-black/10 p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-[14px] font-medium">
                {session.workspaceName}
              </p>
              {session.currentOrigin ? (
                <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-200">
                  This origin
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-[12px] text-[var(--auth-muted)]">
              {session.actor} · {session.device}
            </p>
            <p className="mt-2 text-[12px] text-[var(--auth-muted)]">
              {formatRecentSessionTime(session.loggedInAt)}
            </p>
          </div>
        ))}
      </div>
    </aside>
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
    <div className="w-full max-w-[360px] px-6 py-8 sm:px-0">
      <div className="flex flex-col items-center">
        <LinearLogo />
        <div className="mb-5 flex gap-2 text-[12px] text-[var(--auth-muted)]">
          {steps.map((step) => (
            <span
              key={step}
              className={step === routeStep ? "text-[var(--auth-text)]" : ""}
            >
              {step}
            </span>
          ))}
        </div>
        <h1 className="text-center text-[32px] font-[510] tracking-[-0.035em] text-[var(--auth-text)]">
          Create your workspace
        </h1>
      </div>
      {routeStep === "identity" && (
        <form onSubmit={submitIdentity} className="mt-8 space-y-3">
          <input
            type="text"
            value={state.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Your name"
            className="auth-input h-11 w-full rounded-full border px-4 text-[14px] outline-none"
          />
          <input
            type="email"
            required
            value={state.email}
            onChange={(e) => update({ email: e.target.value })}
            placeholder="Work email"
            className="auth-input h-11 w-full rounded-full border px-4 text-[14px] outline-none"
          />
          <button
            type="submit"
            className="auth-primary-button h-11 w-full rounded-full"
          >
            Continue
          </button>
        </form>
      )}
      {routeStep === "workspace" && (
        <form onSubmit={submitWorkspace} className="mt-8 space-y-3">
          <input
            required
            value={state.slug}
            onChange={(e) => update({ slug: e.target.value.toLowerCase() })}
            placeholder="workspace-slug"
            className="auth-input h-11 w-full rounded-full border px-4 text-[14px] outline-none"
          />
          {slugAvailable !== null && (
            <p
              className={`text-center text-sm ${slugAvailable ? "text-emerald-400" : "text-[var(--auth-error)]"}`}
            >
              {slugAvailable ? "Slug is available" : "Slug is unavailable"}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => update({ hostingMode: "hosted" })}
              className="auth-secondary-button rounded-full border p-3"
            >
              Hosted
            </button>
            <button
              type="button"
              onClick={() => update({ hostingMode: "self-hosted" })}
              className="auth-secondary-button rounded-full border p-3"
            >
              Self-host
            </button>
          </div>
          <button
            type="submit"
            disabled={loading || slugAvailable === false}
            className="auth-primary-button h-11 w-full rounded-full"
          >
            {loading ? "Creating…" : "Create workspace"}
          </button>
        </form>
      )}
      {routeStep === "invite" && (
        <form onSubmit={verifyAndInvite} className="mt-8 space-y-3">
          <p className="text-center text-[14px] text-[var(--auth-muted)]">
            Enter the 6-digit code sent to {state.email} before inviting
            teammates.
          </p>
          <input
            inputMode="numeric"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="6-digit code"
            className="auth-input h-11 w-full rounded-full border px-4 text-center tracking-[0.35em] outline-none"
          />
          <textarea
            value={inviteEmails}
            onChange={(e) => setInviteEmails(e.target.value)}
            placeholder="teammate@company.com, another@company.com"
            className="auth-input min-h-24 w-full rounded-2xl border px-4 py-3 text-[14px] outline-none"
          />
          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="auth-primary-button h-11 w-full rounded-full"
          >
            Verify and send invites
          </button>
        </form>
      )}
      {routeStep === "finish" && (
        <div className="mt-8 space-y-3 text-center">
          <p className="text-[14px] text-[var(--auth-muted)]">
            Your workspace is ready.
          </p>
          <button
            type="button"
            onClick={() => {
              window.localStorage.removeItem(signupStorageKey);
              window.location.assign(`/${state.slug || ""}`);
            }}
            className="auth-primary-button h-11 w-full rounded-full"
          >
            Go to dashboard
          </button>
        </div>
      )}
      {status && (
        <p className="mt-4 text-center text-sm text-[var(--auth-error)]">
          {status}
        </p>
      )}
      <FooterLinks mode="signup" />
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
  const emailSubmitAttemptRef = useRef(0);

  useEffect(() => {
    setPasskeySupported(browserSupportsPasskeys());
    ensureRecentSessionFingerprint();
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === "test" || mode !== "login") return;
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
          ? "Create your workspace"
          : "Log in to Linear";
  const backLabel = mode === "signup" ? "Back to signup" : "Back to login";

  return (
    <div className="flex w-full max-w-5xl flex-col items-center justify-center gap-8 px-6 py-8 lg:flex-row lg:items-start">
      <div className="w-full max-w-[320px] sm:px-0">
        <div className="flex flex-col items-center">
          <LinearLogo />
          <h1 className="text-center text-[32px] font-[510] tracking-[-0.035em] text-[var(--auth-text)]">
            {title}
          </h1>
        </div>

        <div className="mt-8 space-y-4">
          {step === "choose" && (
            <div className="space-y-3">
              {googleAllowed && (
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
                  {googleConfigured === null
                    ? "Checking Google sign-in"
                    : "Continue with Google"}
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
              )}

              <button
                type="button"
                onClick={() => {
                  setStep("sso-input");
                  setPasskeyPending(false);
                  setError("");
                }}
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
                  aria-label="SAML"
                >
                  <path d="M4 7h16" />
                  <path d="M7 11h10" />
                  <path d="M9 15h6" />
                  <path d="M12 3 3 7.5v9L12 21l9-4.5v-9L12 3Z" />
                </svg>
                Continue with SAML SSO
              </button>

              {mode === "login" && passkeyConfigured !== false && (
                <>
                  <button
                    type="button"
                    onClick={handlePasskeyLogin}
                    disabled={loading || passkeyPending || !passkeySupported}
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
                      aria-label="Passkey"
                    >
                      <path d="M10 13a5 5 0 1 1 3.54 1.46L12 16h-2v2H8v2H5v-3l4.54-4.54A5 5 0 0 1 10 13Z" />
                      <path d="M15 9h.01" />
                    </svg>
                    {passkeyPending
                      ? "Waiting for passkey"
                      : "Log in with passkey"}
                  </button>
                  {passkeyConfigured === true && !passkeySupported ? (
                    <p className="pt-1 text-center text-sm text-[var(--auth-error)]">
                      This browser doesn&apos;t support passkeys. Use email or
                      Google instead.
                    </p>
                  ) : null}
                </>
              )}

              {googleDisabledByWorkspace && emailConfigured === false ? (
                <p className="pt-1 text-center text-sm text-[var(--auth-muted)]">
                  Google, email, and passkey login are disabled for this
                  workspace. Continue with SAML SSO.
                </p>
              ) : null}

              {error && (
                <p className="pt-1 text-center text-sm text-[var(--auth-error)]">
                  {error}
                </p>
              )}
            </div>
          )}

          {step === "email-input" && (
            <form onSubmit={handleEmailSubmit} noValidate className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError("");
                }}
                placeholder="Enter your email address…"
                required
                className="auth-input h-11 w-full rounded-full border px-4 text-[14px] outline-none transition-colors"
              />
              <TurnstileField />
              <button
                type="submit"
                disabled={loading}
                className="auth-primary-button flex h-11 w-full items-center justify-center rounded-full border border-transparent px-4 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Sending…" : "Continue with email"}
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

          {step === "email-verifying" && (
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
                  aria-label="Verification in progress"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </div>
              <div>
                <p className="mt-2 text-[14px] leading-6 text-[var(--auth-muted)]">
                  This helps us confirm this sign-in request before sending your
                  email link and code.
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
                className="w-full pt-1 text-center text-[13px] text-[var(--auth-muted)] transition-opacity hover:opacity-80"
              >
                {backLabel}
              </button>
            </div>
          )}

          {step === "sso-input" && (
            <form onSubmit={handleSsoSubmit} noValidate className="space-y-3">
              <input
                type="email"
                value={ssoIdentifier}
                onChange={(e) => {
                  setSsoIdentifier(e.target.value);
                  setError("");
                }}
                placeholder="Enter your email address…"
                required
                className="auth-input h-11 w-full rounded-full border px-4 text-[14px] outline-none transition-colors"
              />
              <button
                type="submit"
                disabled={loading}
                className="auth-primary-button flex h-11 w-full items-center justify-center rounded-full border border-transparent px-4 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Checking SAML…" : "Continue with SAML"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("choose");
                  setSsoIdentifier("");
                  setError("");
                }}
                disabled={loading}
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
      <div className="flex w-full max-w-[360px] flex-col gap-4">
        {mode === "login" ? (
          <RecentSessionsRail
            sessions={recentSessions}
            recognizedOrigin={recognizedOrigin}
          />
        ) : null}
        {preflightChecks ? (
          <PreflightRail
            checks={preflightChecks}
            hasFailure={hasPreflightFailure}
          />
        ) : null}
      </div>
    </div>
  );
}

function PreflightRail({
  checks,
  hasFailure,
}: {
  checks: PreflightCheck[];
  hasFailure: boolean;
}) {
  return (
    <aside
      className="w-full max-w-[320px] rounded-2xl border border-[var(--auth-secondary-border)] bg-[var(--auth-secondary-bg)] p-4 text-[var(--auth-text)] shadow-sm"
      aria-label="Authentication preflight checks"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Preflight checks</h2>
          <p className="mt-1 text-xs text-[var(--auth-muted)]">
            Live dependency status for sign-in.
          </p>
        </div>
        <span className="rounded-full border border-[var(--auth-secondary-border)] px-2 py-1 text-[11px] text-[var(--auth-muted)]">
          Live
        </span>
      </div>

      {hasFailure ? (
        <output className="mt-4 block rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-[var(--auth-error)]">
          One or more login dependencies need attention. You can still try to
          log in.
        </output>
      ) : null}

      <ul className="mt-4 space-y-2">
        {checks.map((check) => (
          <li
            key={check.name}
            className="flex items-start justify-between gap-3 rounded-xl border border-[var(--auth-secondary-border)] px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium">{check.name}</p>
              <p className="mt-0.5 text-xs text-[var(--auth-muted)]">
                {check.detail}
              </p>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${preflightStatusClass(check.status)}`}
            >
              {check.status}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function preflightStatusClass(status: PreflightStatus): string {
  if (status === "ok") {
    return "bg-emerald-500/15 text-emerald-300";
  }
  if (status === "warn") {
    return "bg-amber-500/15 text-amber-300";
  }
  return "bg-red-500/15 text-red-300";
}
