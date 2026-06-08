"use client";

import { ExponentialMark } from "@/components/exponential-mark";
import {
  apiErrorMessage,
  createBrowserApiClient,
} from "@/lib/browser-api-client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

interface InviteEntry {
  id: string;
  email: string;
  role: "admin" | "member" | "guest";
}

const apiClient = createBrowserApiClient();
const ONBOARDING_STEPS = ["identity", "workspace", "invite", "finish"];

function createInviteEntry(): InviteEntry {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `invite-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { id, email: "", role: "member" };
}

function InviteTeamContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") ?? "";
  const teamKey = searchParams.get("teamKey") ?? "";
  const redirectPath = teamKey ? `/team/${teamKey}/all` : "/";

  const [invites, setInvites] = useState<InviteEntry[]>([createInviteEntry()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  function addRow() {
    setInvites([...invites, createInviteEntry()]);
  }

  function updateEmail(index: number, email: string) {
    const updated = [...invites];
    updated[index].email = email;
    setInvites(updated);
  }

  function updateRole(index: number, role: InviteEntry["role"]) {
    const updated = [...invites];
    updated[index].role = role;
    setInvites(updated);
  }

  function removeRow(index: number) {
    if (invites.length <= 1) return;
    setInvites(invites.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const validInvites = invites
      .filter((inv) => inv.email.trim())
      .map(({ email, role }) => ({ email, role }));
    if (validInvites.length === 0) return;

    setLoading(true);
    setError("");

    try {
      const { data, error } = await apiClient.POST("/workspaces/invite", {
        body: { workspaceId, invites: validInvites },
      });

      if (error) {
        setError(apiErrorMessage(error, "Failed to send invitations"));
        return;
      }

      const failures =
        data.results?.filter((result) => result.status === "failed") ?? [];

      if (failures.length > 0) {
        setError(
          failures
            .map((result) =>
              result.error
                ? `${result.email}: ${result.error}`
                : `${result.email}: Failed to send`,
            )
            .join(" "),
        );
        return;
      }

      setSent(true);
      setTimeout(() => router.push(redirectPath), 2000);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleSkip() {
    router.push(redirectPath);
  }

  if (sent) {
    return (
      <div className="auth-shell flex min-h-screen items-center justify-center px-6 font-mono">
        <div className="w-full max-w-[560px] border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)]">
          <div className="border-b border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-muted)]">
            # invite result
          </div>
          <div className="px-4 py-8 text-center">
            <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--auth-ok)]">
              [ok] mail queued
            </p>
            <h2 className="mt-2 text-[18px] font-medium text-[var(--auth-text)]">
              Invitations sent!
            </h2>
            <p className="mt-2 text-[12px] text-[var(--auth-muted)]">
              Redirecting to your workspace...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell flex min-h-screen flex-col font-mono">
      <header className="flex items-center justify-between border-b border-[var(--auth-secondary-border)] px-6 py-3 text-[12px] text-[var(--auth-muted)]">
        <div className="flex items-center gap-3">
          <ExponentialMark size={18} className="text-[var(--auth-text)]/80" />
          <span className="text-[var(--auth-text)]">exponential</span>
          <span className="text-[var(--auth-faint)]">/</span>
          <span>first run</span>
          <span className="text-[var(--auth-faint)]">/</span>
          <span className="text-[var(--auth-text)]">invite</span>
        </div>
        <span className="text-[var(--auth-faint)]">step 3/4</span>
      </header>

      <main className="flex-1 px-6 py-8 text-[var(--auth-text)]">
        <div className="mx-auto grid w-full max-w-[1040px] grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-6">
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--auth-muted)]">
                {"// init · invite teammates"}
              </p>
              <h1 className="text-[22px] font-medium text-[var(--auth-text)]">
                <span aria-hidden="true" className="text-[var(--auth-prompt)]">
                  ${" "}
                </span>
                Invite your team
              </h1>
              <p className="max-w-[640px] text-[12px] text-[var(--auth-muted)]">
                Invite teammates to collaborate on issues and projects. You can
                always do this later from workspace settings.
              </p>
            </div>

            <form
              onSubmit={handleSubmit}
              noValidate
              className="border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)]"
            >
              <div className="flex items-center justify-between border-b border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-muted)]">
                <span># invite manifest</span>
                <span>{invites.length} row(s)</span>
              </div>
              <div className="space-y-3 px-3 py-4">
                {invites.map((invite, index) => (
                  <div
                    key={invite.id}
                    className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_120px_auto]"
                  >
                    <label className="flex min-w-0 items-center gap-3 border-b border-[var(--auth-input-border)] py-2 focus-within:border-[var(--auth-accent)]">
                      <span
                        aria-hidden="true"
                        className="text-[13px] text-[var(--auth-prompt)]"
                      >
                        mail $
                      </span>
                      <input
                        type="email"
                        value={invite.email}
                        onChange={(e) => updateEmail(index, e.target.value)}
                        placeholder="teammate@company.com"
                        className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--auth-text)] outline-none placeholder:text-[var(--auth-input-placeholder)]"
                      />
                    </label>
                    <select
                      value={invite.role}
                      onChange={(e) =>
                        updateRole(index, e.target.value as InviteEntry["role"])
                      }
                      className="h-9 border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-2 text-[12px] text-[var(--auth-text)] outline-none focus:border-[var(--auth-accent)]"
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                      <option value="guest">Guest</option>
                    </select>
                    {invites.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        className="h-9 border border-[var(--auth-secondary-border)] px-2 text-[12px] text-[var(--auth-muted)] hover:bg-[var(--auth-secondary-bg-hover)] hover:text-[var(--auth-text)]"
                        aria-label="Remove invite"
                      >
                        x
                      </button>
                    ) : (
                      <span className="h-9 w-8" aria-hidden="true" />
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addRow}
                  className="inline-flex items-center gap-2 border border-[var(--auth-secondary-border)] px-2 py-1 text-[12px] text-[var(--auth-muted)] hover:bg-[var(--auth-secondary-bg-hover)] hover:text-[var(--auth-text)]"
                >
                  <span aria-hidden="true">+</span>
                  Add another
                </button>

                {error ? (
                  <p
                    className="border border-[var(--auth-err)]/40 bg-[var(--auth-err)]/10 px-3 py-2 text-[12px] text-[var(--auth-err)]"
                    role="alert"
                  >
                    {error}
                  </p>
                ) : null}

                <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2">
                  <button
                    type="button"
                    aria-label="Skip for now"
                    onClick={handleSkip}
                    className="flex h-10 items-center justify-between border border-[var(--auth-secondary-border)] bg-[var(--auth-secondary-bg)] px-3 text-[13px] text-[var(--auth-secondary-text)] hover:bg-[var(--auth-secondary-bg-hover)]"
                  >
                    <span>Skip for now</span>
                    <span className="text-[11px] text-[var(--auth-muted)]">
                      esc
                    </span>
                  </button>
                  <button
                    type="submit"
                    aria-label="Send invitations"
                    disabled={
                      loading || invites.every((inv) => !inv.email.trim())
                    }
                    className="flex h-10 items-center justify-between border border-[var(--auth-primary-border)] bg-[var(--auth-primary-bg)] px-3 text-[13px] text-[var(--auth-primary-text)] hover:bg-[var(--auth-primary-bg-hover)] disabled:opacity-60"
                  >
                    <span>{loading ? "Sending..." : "Send invitations"}</span>
                    <span className="text-[11px] text-[var(--auth-muted)]">
                      [enter]
                    </span>
                  </button>
                </div>
              </div>
            </form>
          </section>

          <aside className="space-y-4">
            <section className="border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)]">
              <div className="border-b border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-muted)]">
                # first run
              </div>
              <ol className="divide-y divide-[var(--auth-secondary-border)] text-[12px]">
                {ONBOARDING_STEPS.map((step, index) => {
                  const state =
                    step === "invite"
                      ? "active"
                      : index < 2
                        ? "done"
                        : "pending";
                  return (
                    <li
                      key={step}
                      className="flex items-center justify-between px-3 py-2"
                    >
                      <span className="text-[var(--auth-text)]">
                        {index + 1}. {step}
                      </span>
                      <span
                        className={
                          state === "active"
                            ? "text-[var(--auth-ok)]"
                            : state === "done"
                              ? "text-[var(--auth-muted)]"
                              : "text-[var(--auth-faint)]"
                        }
                      >
                        {state}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>

            <section className="border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)]">
              <div className="border-b border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-muted)]">
                # request
              </div>
              <pre className="overflow-x-auto px-3 py-3 text-[12px] leading-5 text-[var(--auth-text)]">
                {`POST /workspaces/invite\nworkspaceId = "${workspaceId || "missing"}"\nteamKey     = "${teamKey || "workspace"}"\nrows        = ${invites.filter((invite) => invite.email.trim()).length}`}
              </pre>
              <div className="border-t border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-faint)]">
                {"// real invite API · no placeholder recipients sent"}
              </div>
            </section>
          </aside>
        </div>
      </main>

      <footer className="border-t border-[var(--auth-secondary-border)] px-6 py-2 text-[11px] text-[var(--auth-muted)]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <span>
            <kbd className="rounded border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-1.5 py-0.5 text-[10px] text-[var(--auth-text)]">
              +
            </kbd>{" "}
            add row
          </span>
          <span>
            <kbd className="rounded border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-1.5 py-0.5 text-[10px] text-[var(--auth-text)]">
              enter
            </kbd>{" "}
            send
          </span>
          <span className="ml-auto text-[var(--auth-faint)]">
            manual invite step
          </span>
        </div>
      </footer>
    </div>
  );
}

export default function InviteTeamPage() {
  return (
    <Suspense
      fallback={
        <div className="auth-shell flex min-h-screen items-center justify-center font-mono">
          <span className="text-[13px] text-[var(--auth-muted)]">
            Loading...
          </span>
        </div>
      }
    >
      <InviteTeamContent />
    </Suspense>
  );
}
