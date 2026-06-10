"use client";

import { ExponentialMark } from "@/components/exponential-mark";
import Link from "next/link";
import { useEffect, useState } from "react";

type AuthMode = "login" | "signup";

const DEFAULT_POST_LOGIN_PATH = "/inbox";
type ProviderCapabilities = {
  providers?: {
    google?: boolean | { configured?: boolean };
    googleAllowed?: boolean;
    emailPasskey?: boolean;
    passkey?: boolean;
  };
};

const HOST_UNKNOWN_LABEL = "host:unknown";

function runtimeHostLabel() {
  if (typeof window === "undefined") return HOST_UNKNOWN_LABEL;
  const host = window.location.host;
  if (!host) return HOST_UNKNOWN_LABEL;
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
    return "local preview";
  }
  return host;
}

function useRuntimeHostLabel() {
  const [hostLabel, setHostLabel] = useState(HOST_UNKNOWN_LABEL);

  useEffect(() => {
    setHostLabel(runtimeHostLabel());
  }, []);

  return hostLabel;
}

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
  if (pathname === "/login" || pathname === "/signup") {
    return DEFAULT_POST_LOGIN_PATH;
  }
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

function TopBar({ mode, hostLabel }: { mode: AuthMode; hostLabel: string }) {
  return (
    <header className="flex flex-col gap-2 border-b border-[var(--auth-secondary-border)] px-4 py-3 text-[12px] text-[var(--auth-muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex items-center gap-3">
        <ExponentialMark size={18} className="text-[var(--auth-text)]/80" />
        <span className="text-[var(--auth-text)]">exponential</span>
        <span className="text-[var(--auth-faint)]">auth</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>{hostLabel}</span>
        <span className="text-[var(--auth-faint)]">·</span>
        <span>{mode === "signup" ? "new workspace" : "session"}</span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-[var(--auth-faint)]"
          />
          api check pending
        </span>
      </div>
    </header>
  );
}

function HotkeyBar({
  mode,
  hostLabel,
}: {
  mode: AuthMode;
  hostLabel: string;
}) {
  const keys =
    mode === "signup"
      ? [
          ["⏎", "submit step"],
          ["⇥", "next field"],
          ["esc", "cancel"],
          ["⌘ K", "command bar"],
        ]
      : [
          ["⏎", "submit"],
          ["⌘ G", "google"],
          ["⌘ M", "magic link"],
          ["⌘ ⇧ S", "ssh challenge"],
          ["?", "help"],
        ];
  return (
    <footer className="border-t border-[var(--auth-secondary-border)] px-6 py-2 text-[11px] text-[var(--auth-muted)]">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {keys.map(([k, label]) => (
          <span key={k} className="inline-flex items-center gap-2">
            <kbd className="rounded border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-1.5 py-0.5 text-[10px] text-[var(--auth-text)]">
              {k}
            </kbd>
            <span>{label}</span>
          </span>
        ))}
        <span className="ml-auto text-[var(--auth-faint)]">
          {hostLabel} · ssh preview marked mock
        </span>
      </div>
    </footer>
  );
}

function PromptInput(props: {
  prompt: string;
  type: "text" | "email" | "password";
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="flex items-center gap-3 border-b border-[var(--auth-input-border)] py-2 focus-within:border-[var(--auth-accent)]">
      <span
        aria-hidden="true"
        className="select-none text-[13px] text-[var(--auth-prompt)]"
      >
        {props.prompt}
      </span>
      <input
        className="flex-1 bg-transparent text-[13px] text-[var(--auth-text)] outline-none placeholder:text-[var(--auth-input-placeholder)]"
        type={props.type}
        value={props.value}
        required={props.required}
        autoComplete={props.autoComplete}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function OAuthButton({
  provider,
  hotkey,
  onClick,
  disabled,
}: {
  provider: string;
  hotkey: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`Continue with ${provider}`}
      className="group flex h-10 w-full items-center justify-between border border-[var(--auth-primary-border)] bg-[var(--auth-primary-bg)] px-3 text-[13px] text-[var(--auth-primary-text)] transition-colors hover:bg-[var(--auth-primary-bg-hover)] disabled:opacity-60"
    >
      <span className="inline-flex items-center gap-3">
        <span aria-hidden="true" className="text-[var(--auth-prompt)]">
          {">"}
        </span>
        <span>Continue with {provider}</span>
      </span>
      <span className="inline-flex items-center gap-2 text-[11px] text-[var(--auth-muted)] group-hover:text-[var(--auth-text)]">
        <kbd className="rounded border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-1.5 py-0.5 text-[10px]">
          {hotkey}
        </kbd>
        <span>↵</span>
      </span>
    </button>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-[var(--auth-faint)]">
      <span className="h-px flex-1 bg-[var(--auth-secondary-border)]" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-[var(--auth-secondary-border)]" />
    </div>
  );
}

function AdvancedAuth() {
  const [tab, setTab] = useState<"ssh" | "oidc" | "cli">("ssh");
  const tabs: { id: typeof tab; label: string; soon?: boolean }[] = [
    { id: "ssh", label: "ssh" },
    { id: "oidc", label: "oidc", soon: true },
    { id: "cli", label: "cli", soon: true },
  ];
  return (
    <section className="border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)]">
      <div className="flex items-center gap-2 border-b border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-muted)]">
        <span>{"// advanced auth"}</span>
        <span className="ml-auto inline-flex items-center gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-sm px-1.5 py-0.5 text-[11px] ${
                tab === t.id
                  ? "bg-[var(--auth-secondary-bg-hover)] text-[var(--auth-text)]"
                  : "text-[var(--auth-muted)] hover:text-[var(--auth-text)]"
              }`}
            >
              {t.label}
              {t.soon ? (
                <span className="ml-1 text-[10px] text-[var(--auth-faint)]">
                  soon
                </span>
              ) : null}
            </button>
          ))}
        </span>
      </div>
      <div className="px-3 py-3 text-[12px] text-[var(--auth-muted)]">
        {tab === "ssh" ? (
          <div className="space-y-2">
            <p className="text-[var(--auth-text)]">
              SSH challenge preview. backend verification is not wired.
            </p>
            <p>
              sample fingerprint{" "}
              <span className="text-[var(--auth-text)]">
                sha256:9e:21:8c:4d:a3:91:7b:ee
              </span>
            </p>
            <Link
              href="/ssh-challenge"
              className="inline-flex items-center gap-2 border border-[var(--auth-primary-border)] px-2 py-1 text-[var(--auth-primary-text)] hover:bg-[var(--auth-primary-bg-hover)]"
            >
              <span>{">"}</span>
              <span>open ssh challenge preview</span>
              <kbd className="ml-1 rounded border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-1 py-0.5 text-[10px]">
                ⌘ ⇧ S
              </kbd>
            </Link>
          </div>
        ) : tab === "oidc" ? (
          <div className="space-y-1">
            <p className="text-[var(--auth-text)]">
              OIDC discovery endpoint pending.
            </p>
            <p>backend wiring pending — coming soon.</p>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-[var(--auth-text)]">
              device-flow pairing for the exponential CLI.
            </p>
            <p>backend wiring pending — coming soon.</p>
          </div>
        )}
      </div>
    </section>
  );
}

const PREFLIGHT_ROWS = [
  { name: "provider capability", status: "warn", detail: "checked on load" },
  { name: "callback allowlist", status: "ok", detail: "local paths only" },
  { name: "cookie session", status: "warn", detail: "opened after sign-in" },
  {
    name: "password auth",
    status: "warn",
    detail: "not configured",
  },
  { name: "passkey", status: "warn", detail: "pending" },
  { name: "ssh challenge", status: "warn", detail: "mock preview" },
];

function PreflightRail() {
  return (
    <section className="border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)]">
      <div className="border-b border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-muted)]">
        # preflight
      </div>
      <ul className="divide-y divide-[var(--auth-secondary-border)] text-[12px]">
        {PREFLIGHT_ROWS.map((row) => (
          <li
            key={row.name}
            className="flex items-center justify-between px-3 py-1.5"
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${
                  row.status === "ok"
                    ? "bg-[var(--auth-ok)]"
                    : row.status === "warn"
                      ? "bg-[var(--auth-warn)]"
                      : "bg-[var(--auth-err)]"
                }`}
              />
              <span className="text-[var(--auth-text)]">{row.name}</span>
            </span>
            <span className="text-[var(--auth-muted)]">{row.detail}</span>
          </li>
        ))}
      </ul>
      <div className="border-t border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-faint)]">
        {"// provider checked client-side · pending where marked"}
      </div>
    </section>
  );
}

const SESSION_METHOD_ROWS = [
  { method: "google oauth", state: "wired", detail: "/api/auth/google/start" },
  { method: "magic link", state: "wired", detail: "/api/auth/magic-link" },
  { method: "saml sso", state: "pending", detail: "policy-only branch" },
  { method: "ssh challenge", state: "mock", detail: "no verifier service" },
];

function SessionMethodsRail() {
  return (
    <section className="border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)]">
      <div className="border-b border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-muted)]">
        # auth methods
      </div>
      <ul className="divide-y divide-[var(--auth-secondary-border)] text-[12px]">
        {SESSION_METHOD_ROWS.map((row) => (
          <li key={row.method} className="px-3 py-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[var(--auth-text)]">{row.method}</span>
              <span
                className={
                  row.state === "wired"
                    ? "text-[var(--auth-ok)]"
                    : row.state === "pending"
                      ? "text-[var(--auth-warn)]"
                      : "text-[var(--auth-muted)]"
                }
              >
                {row.state}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-[var(--auth-muted)]">
              <span className="truncate">{row.detail}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="border-t border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-faint)]">
        {"// no fake recent-session telemetry"}
      </div>
    </section>
  );
}

function NextStepsRail() {
  const steps = [
    "[ ] create workspace",
    "[ ] invite teammates",
    "[ ] configure auth policy",
    "[ ] import issues when integration exists",
  ];
  return (
    <section className="border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)]">
      <div className="border-b border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-muted)]">
        # next steps
      </div>
      <ul className="divide-y divide-[var(--auth-secondary-border)] text-[12px]">
        {steps.map((s) => (
          <li
            key={s}
            className="px-3 py-1.5 text-[var(--auth-text)] hover:bg-[var(--auth-secondary-bg-hover)]"
          >
            {s}
          </li>
        ))}
      </ul>
      <div className="border-t border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-faint)]">
        {"// setup checklist · not an automation claim"}
      </div>
    </section>
  );
}

function WorkspaceTreeRail({ slug }: { slug: string }) {
  const safe = slug.trim() || "acme";
  const tree = [
    `~/.exponential/workspaces/${safe}/`,
    "├── config.toml",
    "├── issues/",
    "│   └── inbox/",
    "├── projects/",
    "└── teams/",
    "    └── core/",
  ];
  return (
    <section className="border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)]">
      <div className="border-b border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-muted)]">
        # workspace layout
      </div>
      <pre className="overflow-x-auto px-3 py-3 text-[12px] leading-5 text-[var(--auth-text)]">
        {tree.join("\n")}
      </pre>
      <div className="border-t border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-faint)]">
        {"// preview · created on first sync"}
      </div>
    </section>
  );
}

function SignupSteps({ current }: { current: number }) {
  const steps = ["identity", "workspace", "team", "preferences"];
  return (
    <ol className="flex items-center gap-2 text-[11px] text-[var(--auth-muted)]">
      {steps.map((label, idx) => {
        const n = idx + 1;
        const active = n === current;
        const done = n < current;
        return (
          <li key={label} className="inline-flex items-center gap-2">
            <span
              className={`inline-flex h-5 w-5 items-center justify-center border text-[10px] ${
                active
                  ? "border-[var(--auth-primary-border)] text-[var(--auth-primary-text)]"
                  : done
                    ? "border-[var(--auth-secondary-border)] text-[var(--auth-ok)]"
                    : "border-[var(--auth-secondary-border)] text-[var(--auth-faint)]"
              }`}
            >
              {done ? "✓" : n}
            </span>
            <span
              className={
                active
                  ? "text-[var(--auth-text)]"
                  : done
                    ? "text-[var(--auth-muted)]"
                    : "text-[var(--auth-faint)]"
              }
            >
              {label}
            </span>
            {n < steps.length ? (
              <span aria-hidden="true" className="text-[var(--auth-faint)]">
                →
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function FooterLinks({ mode }: { mode: AuthMode }) {
  if (mode === "signup") {
    return (
      <p className="mt-6 text-[12px] text-[var(--auth-muted)]">
        Already have an account?{" "}
        <Link
          href="/login"
          className="text-[var(--auth-link)] underline-offset-4 hover:underline"
        >
          log in
        </Link>
      </p>
    );
  }
  return (
    <p className="mt-6 text-[12px] text-[var(--auth-muted)]">
      <span className="sr-only">Don’t have an account? </span>
      <span aria-hidden="true">{"// new here? "}</span>
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

export function AuthPage({ mode }: { mode: AuthMode }) {
  const isSignup = mode === "signup";
  const hostLabel = useRuntimeHostLabel();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState("");
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

  const ariaTitle = isSignup ? "Create your account" : "Log in to exponential";
  const visibleTitle = isSignup
    ? "create a workspace"
    : "log in to exponential";

  return (
    <>
      <TopBar mode={mode} hostLabel={hostLabel} />
      <main className="flex-1 px-6 py-8 text-[var(--auth-text)]">
        <div className="mx-auto grid w-full max-w-[1180px] grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-6">
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--auth-muted)]">
                {isSignup ? "# session · new workspace" : "# session · open"}
              </p>
              <h1
                aria-label={ariaTitle}
                className="text-[22px] font-medium text-[var(--auth-text)]"
              >
                <span aria-hidden="true" className="text-[var(--auth-prompt)]">
                  ${" "}
                </span>
                {visibleTitle}
                <span
                  aria-hidden="true"
                  className="ml-1 inline-block h-4 w-[7px] translate-y-[2px] animate-pulse bg-[var(--auth-prompt)] align-middle"
                />
              </h1>
              <p className="text-[12px] text-[var(--auth-muted)]">
                {isSignup
                  ? "Create-workspace is the next step after signup. Authentication is handled by the headless Go API."
                  : "Authentication is handled by the headless Go API. session is bound to this device."}
              </p>
              {isSignup ? <SignupSteps current={1} /> : null}
            </div>

            {error ? (
              <div
                className="border border-[var(--auth-err)]/40 bg-[var(--auth-err)]/10 px-3 py-2 text-[12px] text-[var(--auth-err)]"
                role="alert"
              >
                {error}
              </div>
            ) : null}
            {magicLinkSent ? (
              <div className="border border-[var(--auth-ok)]/40 bg-[var(--auth-ok)]/5 px-3 py-2 text-[12px] text-[var(--auth-ok)]">
                Check your email for the sign-in link.
              </div>
            ) : null}

            <div className="space-y-3">
              {googleAvailable ? (
                <OAuthButton
                  provider="Google"
                  hotkey="⌘ G"
                  onClick={handleGoogleLogin}
                  disabled={loading}
                />
              ) : null}
              {samlAvailable ? (
                <button
                  type="button"
                  aria-label="Continue with SAML SSO"
                  className="flex h-10 w-full items-center justify-between border border-[var(--auth-secondary-border)] bg-[var(--auth-secondary-bg)] px-3 text-[13px] text-[var(--auth-secondary-text)] hover:bg-[var(--auth-secondary-bg-hover)]"
                >
                  <span className="inline-flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="text-[var(--auth-prompt)]"
                    >
                      {">"}
                    </span>
                    <span>Continue with SAML SSO</span>
                  </span>
                  <span className="text-[11px] text-[var(--auth-faint)]">
                    soon
                  </span>
                </button>
              ) : null}
            </div>

            <Divider label="or paste credentials" />

            <form
              onSubmit={handlePasswordSubmit}
              className="space-y-1"
              aria-label={ariaTitle}
            >
              {isSignup ? (
                <>
                  <PromptInput
                    prompt="name $"
                    type="text"
                    value={name}
                    onChange={setName}
                    placeholder="Your name"
                    autoComplete="name"
                  />
                  <PromptInput
                    prompt="org  $"
                    type="text"
                    value={workspace}
                    onChange={setWorkspace}
                    placeholder="workspace slug (e.g. acme)"
                  />
                </>
              ) : null}
              <PromptInput
                prompt="mail $"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="Email address"
                autoComplete="email"
                required
              />
              <PromptInput
                prompt="pass $"
                type="password"
                value={password}
                onChange={setPassword}
                placeholder="Password"
                autoComplete={isSignup ? "new-password" : "current-password"}
                required
              />
              <button
                type="submit"
                disabled={loading}
                aria-label={isSignup ? "Create account" : "Log in"}
                className="mt-3 flex h-10 w-full items-center justify-between border border-[var(--auth-primary-border)] bg-[var(--auth-primary-bg)] px-3 text-[13px] text-[var(--auth-primary-text)] transition-colors hover:bg-[var(--auth-primary-bg-hover)] disabled:opacity-60"
              >
                <span className="inline-flex items-center gap-3">
                  <span aria-hidden="true">{"[↵]"}</span>
                  <span>
                    {loading
                      ? "please wait…"
                      : isSignup
                        ? "create account"
                        : "log in"}
                  </span>
                </span>
                <span className="text-[11px] text-[var(--auth-muted)]">
                  {isSignup ? "password path pending" : "binds session"}
                </span>
              </button>
            </form>

            {!isSignup ? (
              <form onSubmit={handleMagicLink} aria-label="Send magic link">
                <button
                  type="submit"
                  disabled={loading || !email.trim()}
                  aria-label="Send magic link instead"
                  className="flex h-10 w-full items-center justify-between border border-[var(--auth-secondary-border)] bg-[var(--auth-secondary-bg)] px-3 text-[13px] text-[var(--auth-secondary-text)] hover:bg-[var(--auth-secondary-bg-hover)] disabled:opacity-60"
                >
                  <span className="inline-flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="text-[var(--auth-prompt)]"
                    >
                      {">"}
                    </span>
                    <span>Send magic link instead</span>
                  </span>
                  <kbd className="rounded border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-1.5 py-0.5 text-[10px] text-[var(--auth-muted)]">
                    ⌘ M
                  </kbd>
                </button>
              </form>
            ) : null}

            <AdvancedAuth />
            <FooterLinks mode={mode} />
          </section>

          <aside className="space-y-4">
            {isSignup ? (
              <>
                <WorkspaceTreeRail slug={workspace} />
                <NextStepsRail />
              </>
            ) : (
              <>
                <PreflightRail />
                <SessionMethodsRail />
              </>
            )}
          </aside>
        </div>
      </main>
      <HotkeyBar mode={mode} hostLabel={hostLabel} />
    </>
  );
}
