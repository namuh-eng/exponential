"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

interface InviteEntry {
  email: string;
  role: "admin" | "member" | "guest";
}

function InviteTeamContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") ?? "";
  const teamKey = searchParams.get("teamKey") ?? "";
  const redirectPath = teamKey ? `/team/${teamKey}/all` : "/";

  const [invites, setInvites] = useState<InviteEntry[]>([
    { email: "", role: "member" },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  function addRow() {
    setInvites([...invites, { email: "", role: "member" }]);
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

    const validInvites = invites.filter((inv) => inv.email.trim());
    if (validInvites.length === 0) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/workspaces/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, invites: validInvites }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to send invitations");
        return;
      }

      const data = (await res.json()) as {
        results?: {
          email: string;
          status: "sent" | "failed";
          error?: string;
        }[];
      };
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
      <div className="flex min-h-screen items-center justify-center bg-[#090909]">
        <div className="w-full max-w-[480px] px-4 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-[#26262a] bg-[#18181b]">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#22c55e"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              role="img"
              aria-label="Success"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h2 className="text-[15px] font-medium text-white">
            Invitations sent!
          </h2>
          <p className="mt-1.5 text-[13px] text-[#6b6f76]">
            Redirecting to your workspace...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#090909]">
      <div className="w-full max-w-[480px] px-4">
        {/* Header */}
        <div className="mb-8 flex flex-col items-center">
          <svg
            width="48"
            height="48"
            viewBox="0 0 100 100"
            fill="none"
            role="img"
            aria-label="Linear logo"
            className="mb-5"
          >
            <path
              d="M5.22 51.09a49.4 49.4 0 0 0 43.69 43.69L5.22 51.09Z"
              fill="#5E6AD2"
            />
            <path
              d="M1.01 40.94a49.54 49.54 0 0 0 58.05 58.05L1.01 40.94Z"
              fill="#5E6AD2"
            />
            <path
              d="M3.42 27.2A49.58 49.58 0 0 0 72.8 96.58L3.42 27.2Z"
              fill="#5E6AD2"
            />
            <path
              d="M10.57 16.1A49.53 49.53 0 0 0 83.9 89.43L10.57 16.1Z"
              fill="#5E6AD2"
            />
            <path
              d="M21.07 8.53a49.46 49.46 0 0 0 70.4 70.4A49.53 49.53 0 0 0 21.07 8.53Z"
              fill="#5E6AD2"
            />
            <path
              d="M34.7 3.68a49.46 49.46 0 0 0 61.6 61.63A49.54 49.54 0 0 0 34.7 3.68Z"
              fill="#5E6AD2"
            />
            <path
              d="M50.58.16a49.4 49.4 0 0 0 49.26 49.26A49.41 49.41 0 0 0 50.58.16Z"
              fill="#5E6AD2"
            />
          </svg>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-white">
            Invite your team
          </h1>
          <p className="mt-2 text-center text-sm text-[#6b6f76]">
            Invite teammates to collaborate on issues and projects. You can
            always do this later.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-3">
          {invites.map((invite, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: invite rows have no stable ID
            <div key={`invite-${index}`} className="flex items-center gap-2">
              <input
                type="email"
                value={invite.email}
                onChange={(e) => updateEmail(index, e.target.value)}
                placeholder="teammate@company.com"
                className="flex-1 rounded-md border border-[#26262a] bg-[#18181b] px-3.5 py-[10px] text-[13px] text-white placeholder-[#555] outline-none transition-colors focus:border-[#5E6AD2]"
              />
              <select
                value={invite.role}
                onChange={(e) =>
                  updateRole(index, e.target.value as InviteEntry["role"])
                }
                className="rounded-md border border-[#26262a] bg-[#18181b] px-3 py-[10px] text-[13px] text-white outline-none transition-colors focus:border-[#5E6AD2]"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="guest">Guest</option>
              </select>
              {invites.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="rounded-md p-2 text-[#6b6f76] transition-colors hover:bg-[#18181b] hover:text-white"
                  aria-label="Remove invite"
                >
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
                    aria-label="Remove"
                  >
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}

          {/* Add another */}
          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-1.5 text-[13px] text-[#6b6f76] transition-colors hover:text-white"
          >
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
              aria-label="Add"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            Add another
          </button>

          {error && <p className="text-center text-sm text-red-400">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleSkip}
              className="flex-1 rounded-md border border-[#26262a] bg-[#18181b] px-4 py-[10px] text-[13px] font-medium text-white/90 transition-colors hover:bg-[#222226] hover:border-[#303036]"
            >
              Skip for now
            </button>
            <button
              type="submit"
              disabled={loading || invites.every((inv) => !inv.email.trim())}
              className="flex-1 rounded-md bg-[#5E6AD2] px-4 py-[10px] text-[13px] font-medium text-white transition-colors hover:bg-[#4F5ABF] disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send invitations"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function InviteTeamPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#090909]">
          <span className="text-[13px] text-[#6b6f76]">Loading...</span>
        </div>
      }
    >
      <InviteTeamContent />
    </Suspense>
  );
}
