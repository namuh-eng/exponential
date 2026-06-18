"use client";

import { ExponentialMark } from "@/components/exponential-mark";
import {
  apiErrorMessage,
  createBrowserApiClient,
} from "@/lib/browser-api-client";
import { useEffect, useMemo, useState } from "react";

type GrantStatus =
  | "idle"
  | "loading"
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "error";

type DeviceGrant = {
  user_code: string;
  status: "pending" | "approved" | "denied" | "expired";
  expires_at: string;
};

const apiClient = createBrowserApiClient();

export function DeviceAuthPage({
  initialUserCode,
  userName,
}: {
  initialUserCode: string;
  userName: string;
}) {
  const [userCode, setUserCode] = useState(initialUserCode);
  const [grant, setGrant] = useState<DeviceGrant | null>(null);
  const [status, setStatus] = useState<GrantStatus>("idle");
  const [message, setMessage] = useState("");
  const normalizedCode = useMemo(() => normalizeUserCode(userCode), [userCode]);

  useEffect(() => {
    if (!normalizedCode) return;
    let cancelled = false;
    setStatus("loading");
    setMessage("");
    apiClient
      .GET("/auth/device/grant", {
        params: { query: { user_code: normalizedCode } },
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setGrant(null);
          setStatus("error");
          setMessage(apiErrorMessage(error, "Device code not found."));
          return;
        }
        setGrant(data);
        setStatus(data.status);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setGrant(null);
        setStatus("error");
        setMessage(
          error instanceof Error ? error.message : "Device code lookup failed.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [normalizedCode]);

  async function decide(action: "approve" | "deny") {
    if (!normalizedCode) {
      setStatus("error");
      setMessage("Enter the 6-digit code shown by the CLI.");
      return;
    }
    setStatus("loading");
    setMessage("");
    try {
      const { data, error } = await apiClient.POST("/auth/device/grant", {
        body: { user_code: normalizedCode, action },
      });
      if (error || !data) {
        setStatus("error");
        setMessage(apiErrorMessage(error, "Unable to update device login."));
        return;
      }
      setGrant(data);
      setStatus(data.status);
      setMessage(
        data.status === "approved"
          ? "CLI access approved. You can return to your terminal."
          : "CLI access denied.",
      );
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update device login.",
      );
    }
  }

  const canDecide = grant?.status === "pending" && status !== "loading";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--auth-bg)] px-6 py-10 text-[var(--auth-text-primary)]">
      <section className="w-full max-w-[520px] rounded-2xl border border-[var(--auth-border)] bg-[var(--auth-panel)] p-6 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <ExponentialMark size={28} className="text-[var(--auth-accent)]" />
          <div>
            <h1 className="text-[20px] font-semibold">
              Authorize Exponential CLI
            </h1>
            <p className="text-[13px] text-[var(--auth-text-secondary)]">
              Signed in as {userName}. Review the code before approving terminal
              access.
            </p>
          </div>
        </div>

        <label className="mb-4 block">
          <span className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-[var(--auth-text-tertiary)]">
            Device code
          </span>
          <input
            value={userCode}
            onChange={(event) => setUserCode(event.target.value)}
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="123456"
            className="w-full rounded-xl border border-[var(--auth-border)] bg-transparent px-4 py-3 font-mono text-[28px] tracking-[0.3em] outline-none transition-colors focus:border-[var(--auth-accent)]"
          />
        </label>

        <div className="mb-5 rounded-xl border border-[var(--auth-border)] bg-black/10 p-4 text-[13px] text-[var(--auth-text-secondary)]">
          {status === "idle"
            ? "Enter the 6-digit code shown by `expn login`."
            : null}
          {status === "loading" ? "Checking device login request..." : null}
          {status === "pending" && grant ? (
            <span>
              Pending request for code{" "}
              <strong className="font-mono text-[var(--auth-text-primary)]">
                {grant.user_code}
              </strong>
              . Expires {formatTime(grant.expires_at)}.
            </span>
          ) : null}
          {status === "approved" ? "This CLI login has been approved." : null}
          {status === "denied" ? "This CLI login has been denied." : null}
          {status === "expired"
            ? "This CLI login code expired. Run `expn login` again."
            : null}
          {status === "error" ? message : null}
          {message && status !== "error" ? (
            <div className="mt-2 text-[var(--auth-text-primary)]">
              {message}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => void decide("deny")}
            disabled={!canDecide}
            className="rounded-lg border border-[var(--auth-border)] px-4 py-2 text-[13px] text-[var(--auth-text-primary)] transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => void decide("approve")}
            disabled={!canDecide}
            className="rounded-lg bg-[var(--auth-accent)] px-4 py-2 text-[13px] font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Approve CLI access
          </button>
        </div>
      </section>
    </main>
  );
}

function normalizeUserCode(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 6);
  return digits.length === 6 ? digits : "";
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "soon";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
