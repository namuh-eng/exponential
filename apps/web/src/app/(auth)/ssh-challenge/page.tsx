"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export const dynamic = "force-dynamic";

const NONCE = "4f7c2a90-b1de-4d8e-9c11-7e3a0b94d617";
const FINGERPRINT = "sha256:9e:21:8c:4d:a3:91:7b:ee";
const KEYS = [
  {
    id: "id_ed25519",
    type: "ssh-ed25519",
    fingerprint: "SHA256:Q1pXq2vP…b5dM",
    active: true,
  },
  {
    id: "macbook-2024",
    type: "ssh-ed25519",
    fingerprint: "SHA256:Mn7AYz…0kPo",
    active: false,
  },
  {
    id: "yubikey-fido",
    type: "sk-ssh-ed25519",
    fingerprint: "SHA256:Yb44tQ…sk9c",
    active: false,
  },
];

function formatCountdown(seconds: number) {
  const m = Math.floor(Math.max(seconds, 0) / 60);
  const s = Math.max(seconds, 0) % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function SshChallengePage() {
  const [secondsLeft, setSecondsLeft] = useState(134);
  const [signature, setSignature] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSecondsLeft((n) => (n > 0 ? n - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  function handleCopyNonce() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(NONCE).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  const valid =
    signature.includes("BEGIN SSH SIGNATURE") &&
    signature.includes("END SSH SIGNATURE");

  return (
    <>
      <header className="flex items-center justify-between border-b border-[var(--auth-secondary-border)] px-6 py-3 text-[12px] text-[var(--auth-muted)]">
        <div className="flex items-center gap-3">
          <span className="text-[var(--auth-text)]">exponential</span>
          <span className="text-[var(--auth-faint)]">/</span>
          <span>auth</span>
          <span className="text-[var(--auth-faint)]">/</span>
          <span className="text-[var(--auth-text)]">ssh challenge</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-sm border border-[var(--auth-warn)]/40 bg-[var(--auth-warn)]/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-[var(--auth-warn)]">
            mock · backend not wired
          </span>
          <Link
            href="/login"
            className="text-[var(--auth-muted)] hover:text-[var(--auth-text)]"
          >
            ← back to login
          </Link>
        </div>
      </header>

      <main className="flex-1 px-6 py-8">
        <div className="mx-auto grid w-full max-w-[1120px] grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="space-y-6">
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--auth-muted)]">
                {"// session · sign with key"}
              </p>
              <h1 className="text-[22px] font-medium tracking-[-0.01em] text-[var(--auth-text)]">
                <span aria-hidden="true" className="text-[var(--auth-prompt)]">
                  ${" "}
                </span>
                ssh challenge
              </h1>
              <p className="text-[12px] text-[var(--auth-muted)]">
                sign the workspace nonce with your local SSH key. paste the
                resulting signature here to bind a session. host fingerprint{" "}
                <span className="text-[var(--auth-text)]">{FINGERPRINT}</span>.
              </p>
            </div>

            <section className="border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)]">
              <div className="flex items-center justify-between border-b border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-muted)]">
                <span># challenge</span>
                <span>
                  expires in{" "}
                  <span
                    className={
                      secondsLeft < 30
                        ? "text-[var(--auth-warn)]"
                        : "text-[var(--auth-text)]"
                    }
                  >
                    {formatCountdown(secondsLeft)}
                  </span>
                </span>
              </div>
              <div className="space-y-3 px-3 py-3">
                <pre className="overflow-x-auto rounded-sm border border-[var(--auth-secondary-border)] bg-black/30 px-3 py-2 text-[12px] text-[var(--auth-text)]">
                  {NONCE}
                </pre>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={handleCopyNonce}
                    className="inline-flex items-center gap-2 border border-[var(--auth-secondary-border)] px-2 py-1 text-[var(--auth-text)] hover:bg-[var(--auth-secondary-bg-hover)]"
                  >
                    <span aria-hidden="true">⌘</span>
                    <span>{copied ? "copied" : "copy nonce"}</span>
                  </button>
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-2 border border-[var(--auth-secondary-border)] px-2 py-1 text-[var(--auth-muted)] opacity-60"
                  >
                    <span aria-hidden="true">⟲</span>
                    <span>regenerate</span>
                    <span className="text-[10px] text-[var(--auth-faint)]">
                      soon
                    </span>
                  </button>
                </div>
              </div>
            </section>

            <section className="border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)]">
              <div className="border-b border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-muted)]">
                # sign it locally
              </div>
              <pre className="overflow-x-auto px-3 py-3 text-[12px] leading-5 text-[var(--auth-text)]">
                {`$ echo "${NONCE}" \\
    | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n exponential`}
              </pre>
              <div className="border-t border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-muted)]">
                pipe the output below — it's a single
                {" -----BEGIN SSH SIGNATURE----- "}block.
              </div>
            </section>

            <section className="border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)]">
              <div className="border-b border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-muted)]">
                # paste signature
              </div>
              <textarea
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                spellCheck={false}
                rows={10}
                placeholder={
                  "-----BEGIN SSH SIGNATURE-----\nU1NIU0lH...\n-----END SSH SIGNATURE-----"
                }
                className="w-full resize-y bg-transparent px-3 py-3 text-[12px] leading-5 text-[var(--auth-text)] outline-none placeholder:text-[var(--auth-input-placeholder)]"
              />
              <div className="flex items-center justify-between border-t border-[var(--auth-secondary-border)] px-3 py-2 text-[11px]">
                <span
                  className={
                    signature.length === 0
                      ? "text-[var(--auth-muted)]"
                      : valid
                        ? "text-[var(--auth-ok)]"
                        : "text-[var(--auth-warn)]"
                  }
                >
                  {signature.length === 0
                    ? "awaiting signature…"
                    : valid
                      ? "signature block detected"
                      : "missing BEGIN/END markers"}
                </span>
                <span className="text-[var(--auth-faint)]">
                  {signature.length} chars
                </span>
              </div>
            </section>

            <button
              type="button"
              disabled={!valid || secondsLeft === 0}
              className="flex h-10 w-full items-center justify-between border border-[var(--auth-primary-border)] bg-[var(--auth-primary-bg)] px-3 text-[13px] text-[var(--auth-primary-text)] transition-colors hover:bg-[var(--auth-primary-bg-hover)] disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-3">
                <span aria-hidden="true">{"[↵]"}</span>
                <span>verify &amp; open session</span>
              </span>
              <span className="text-[11px] text-[var(--auth-muted)]">
                mock · prints to console
              </span>
            </button>
          </section>

          <aside className="space-y-4">
            <section className="border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)]">
              <div className="border-b border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-muted)]">
                # known keys
              </div>
              <ul className="divide-y divide-[var(--auth-secondary-border)] text-[12px]">
                {KEYS.map((k) => (
                  <li
                    key={k.id}
                    className="px-3 py-2 hover:bg-[var(--auth-secondary-bg-hover)]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--auth-text)]">{k.id}</span>
                      {k.active ? (
                        <span className="text-[10px] uppercase tracking-[0.15em] text-[var(--auth-ok)]">
                          active
                        </span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-[0.15em] text-[var(--auth-faint)]">
                          idle
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-[var(--auth-muted)]">
                      {k.type}
                    </div>
                    <div className="truncate text-[11px] text-[var(--auth-faint)]">
                      {k.fingerprint}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="border-t border-[var(--auth-secondary-border)] px-3 py-2 text-[11px] text-[var(--auth-faint)]">
                {"// mock · key registry pending"}
              </div>
            </section>

            <section className="border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-3 py-3 text-[12px] text-[var(--auth-muted)]">
              <p className="text-[var(--auth-text)]">need help?</p>
              <p className="mt-1">
                {"// docs · "}
                <span className="text-[var(--auth-muted)]">
                  exponential.local/docs/auth/ssh
                </span>
              </p>
              <p>
                {"// rotate · "}
                <span className="text-[var(--auth-muted)]">
                  ssh-keygen -t ed25519
                </span>
              </p>
            </section>
          </aside>
        </div>
      </main>

      <footer className="border-t border-[var(--auth-secondary-border)] px-6 py-2 text-[11px] text-[var(--auth-muted)]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <span className="inline-flex items-center gap-2">
            <kbd className="rounded border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-1.5 py-0.5 text-[10px] text-[var(--auth-text)]">
              ⌘ V
            </kbd>
            paste
          </span>
          <span className="inline-flex items-center gap-2">
            <kbd className="rounded border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-1.5 py-0.5 text-[10px] text-[var(--auth-text)]">
              ⏎
            </kbd>
            verify
          </span>
          <span className="inline-flex items-center gap-2">
            <kbd className="rounded border border-[var(--auth-secondary-border)] bg-[var(--auth-input-bg)] px-1.5 py-0.5 text-[10px] text-[var(--auth-text)]">
              esc
            </kbd>
            cancel
          </span>
          <span className="ml-auto text-[var(--auth-faint)]">
            mock · backend not wired
          </span>
        </div>
      </footer>
    </>
  );
}
