"use client";

import { ExponentialMark } from "@/components/exponential-mark";
import {
  apiErrorMessage,
  createBrowserApiClient,
} from "@/lib/browser-api-client";
import {
  MAX_WORKSPACE_NAME_LENGTH,
  MAX_WORKSPACE_SLUG_LENGTH,
  sanitizeWorkspaceSlug,
} from "@/lib/workspace-creation";
import { workspaceUrlHost } from "@/lib/workspace-url";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const apiClient = createBrowserApiClient();
const URL_HOST = workspaceUrlHost();
const ONBOARDING_STEPS = ["identity", "workspace", "invite", "finish"];

export default function CreateWorkspacePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [urlSlug, setUrlSlug] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function handleNameChange(value: string) {
    setName(value);
    setError("");
    setUrlSlug(sanitizeWorkspaceSlug(value));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !urlSlug.trim()) return;

    setLoading(true);
    setError("");

    try {
      const { data, error } = await apiClient.POST("/workspaces", {
        body: { name: name.trim(), urlSlug: urlSlug.trim() },
      });

      if (error || !data) {
        if (mountedRef.current) {
          setError(apiErrorMessage(error, "Failed to create workspace"));
        }
        return;
      }

      if (!mountedRef.current) {
        return;
      }

      // Redirect to invite team members step
      const inviteParams = new URLSearchParams({
        workspaceId: data.workspace.id,
        teamKey: data.team.key,
      });
      router.push(`/onboarding/invite?${inviteParams.toString()}`);
    } catch {
      if (mountedRef.current) {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }

  const slugPreview = urlSlug.trim() || "workspace-slug";

  return (
    <div className="auth-shell flex min-h-screen flex-col font-mono">
      <header className="flex items-center justify-between border-b border-[var(--auth-secondary-border)] px-6 py-3 text-[12px] text-[var(--auth-muted)]">
        <div className="flex items-center gap-3">
          <ExponentialMark size={18} className="text-[var(--auth-text)]/80" />
          <span className="text-[var(--auth-text)]">exponential</span>
          <span className="text-[var(--auth-faint)]">/</span>
          <span>first run</span>
          <span className="text-[var(--auth-faint)]">/</span>
          <span className="text-[var(--auth-text)]">workspace</span>
        </div>
        <span className="text-[var(--auth-faint)]">step 2/4</span>
      </header>

      <main className="flex-1 px-6 py-8 text-[var(--auth-text)]">
        <div className="mx-auto grid w-full max-w-[1040px] grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-6">
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--auth-muted)]">
                {"// init · workspace setup"}
              </p>
              <h1 className="text-[22px] font-medium text-[var(--auth-text)]">
                <span aria-hidden="true" className="text-[var(--auth-prompt)]">
                  ${" "}
                </span>
                Create your workspace
              </h1>
              <p className="max-w-[640px] text-[12px] text-[var(--auth-muted)]">
                Workspaces are shared environments where teams can work on
                issues, cycles, and projects. The API creates the workspace and
                routes you to invite teammates next.
              </p>
            </div>

            <form
              onSubmit={handleSubmit}
              className="border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)]"
            >
              <div className="border-b border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-muted)]">
                # workspace manifest
              </div>
              <div className="space-y-5 px-3 py-4">
                <div>
                  <label
                    htmlFor="workspace-name"
                    className="mb-2 block text-[12px] text-[var(--auth-muted)]"
                  >
                    Workspace name
                  </label>
                  <div className="flex items-center gap-3 border-b border-[var(--auth-input-border)] py-2 focus-within:border-[var(--auth-accent)]">
                    <span
                      aria-hidden="true"
                      className="text-[13px] text-[var(--auth-prompt)]"
                    >
                      name $
                    </span>
                    <input
                      id="workspace-name"
                      type="text"
                      value={name}
                      onChange={(e) => handleNameChange(e.target.value)}
                      placeholder="My Workspace"
                      required
                      maxLength={MAX_WORKSPACE_NAME_LENGTH}
                      // biome-ignore lint/a11y/noAutofocus: workspace name should be focused on page load
                      autoFocus
                      className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--auth-text)] outline-none placeholder:text-[var(--auth-input-placeholder)]"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="workspace-url"
                    className="mb-2 block text-[12px] text-[var(--auth-muted)]"
                  >
                    Workspace URL
                  </label>
                  <div className="flex items-center border-b border-[var(--auth-input-border)] py-2 focus-within:border-[var(--auth-accent)]">
                    <span className="text-[13px] text-[var(--auth-faint)]">
                      {URL_HOST}/
                    </span>
                    <input
                      id="workspace-url"
                      type="text"
                      value={urlSlug}
                      onChange={(e) => {
                        setError("");
                        setUrlSlug(sanitizeWorkspaceSlug(e.target.value));
                      }}
                      placeholder="my-workspace"
                      required
                      maxLength={MAX_WORKSPACE_SLUG_LENGTH}
                      className="min-w-0 flex-1 bg-transparent px-1 text-[13px] text-[var(--auth-text)] outline-none placeholder:text-[var(--auth-input-placeholder)]"
                    />
                  </div>
                </div>

                {error ? (
                  <p
                    className="border border-[var(--auth-err)]/40 bg-[var(--auth-err)]/10 px-3 py-2 text-[12px] text-[var(--auth-err)]"
                    role="alert"
                  >
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  aria-label="Create workspace"
                  disabled={loading || !name.trim() || !urlSlug.trim()}
                  className="flex h-10 w-full items-center justify-between border border-[var(--auth-primary-border)] bg-[var(--auth-primary-bg)] px-3 text-[13px] text-[var(--auth-primary-text)] transition-colors hover:bg-[var(--auth-primary-bg-hover)] disabled:opacity-60"
                >
                  <span className="inline-flex items-center gap-3">
                    <span aria-hidden="true">{"[↵]"}</span>
                    <span>{loading ? "Creating..." : "Create workspace"}</span>
                  </span>
                  <span className="text-[11px] text-[var(--auth-muted)]">
                    next: invite
                  </span>
                </button>
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
                    step === "workspace"
                      ? "active"
                      : index === 0
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
                # config preview
              </div>
              <pre className="overflow-x-auto px-3 py-3 text-[12px] leading-5 text-[var(--auth-text)]">
                {`[workspace]\nname = "${name.trim() || "My Workspace"}"\nurl  = "${URL_HOST}/${slugPreview}"\n\n[next]\nroute = "/onboarding/invite"`}
              </pre>
              <div className="border-t border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-faint)]">
                {"// preview only · saved after API response"}
              </div>
            </section>
          </aside>
        </div>
      </main>

      <footer className="border-t border-[var(--auth-secondary-border)] px-6 py-2 text-[11px] text-[var(--auth-muted)]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <span>
            <kbd className="rounded border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-1.5 py-0.5 text-[10px] text-[var(--auth-text)]">
              tab
            </kbd>{" "}
            next field
          </span>
          <span>
            <kbd className="rounded border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-1.5 py-0.5 text-[10px] text-[var(--auth-text)]">
              enter
            </kbd>{" "}
            create
          </span>
          <span className="ml-auto text-[var(--auth-faint)]">
            defaults editable later
          </span>
        </div>
      </footer>
    </div>
  );
}
