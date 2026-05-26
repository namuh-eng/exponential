"use client";

import { OPEN_ASK_LINEAR_EVENT } from "@/lib/command-palette";
import { useCallback, useEffect, useRef, useState } from "react";

interface AskLinearAssistantProps {
  workspaceId?: string;
  workspaceSlug?: string;
  teamKey: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function AskLinearAssistant({
  workspaceId = "",
  workspaceSlug = "",
  teamKey,
}: AskLinearAssistantProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const [canAskLinear, setCanAskLinear] = useState(true);
  const [policyMessage, setPolicyMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const responseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentPath =
    typeof window === "undefined" ? "/" : window.location.pathname;

  const close = useCallback(() => {
    setOpen(false);
    if (lastFocusedElementRef.current) {
      requestAnimationFrame(() => lastFocusedElementRef.current?.focus());
    }
  }, []);

  const openAssistant = useCallback(() => {
    if (!canAskLinear) {
      return;
    }
    lastFocusedElementRef.current = document.activeElement as HTMLElement;
    setOpen(true);
  }, [canAskLinear]);

  useEffect(() => {
    let active = true;
    fetch("/api/workspaces/current/ai-settings", { credentials: "include" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as {
          aiSettings?: {
            aiFeaturesEnabled?: boolean;
            askLinearEnabled?: boolean;
          };
          capabilities?: { canUseAgents?: boolean };
        } | null;
        if (!response.ok || !payload?.aiSettings) {
          return;
        }
        if (!active) {
          return;
        }
        const enabled =
          payload.aiSettings.aiFeaturesEnabled !== false &&
          payload.aiSettings.askLinearEnabled !== false &&
          payload.capabilities?.canUseAgents !== false;
        setCanAskLinear(enabled);
        setPolicyMessage(
          enabled ? null : "Ask Linear is disabled by workspace AI settings.",
        );
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function handleOpenAssistant() {
      openAssistant();
    }

    window.addEventListener(OPEN_ASK_LINEAR_EVENT, handleOpenAssistant);
    return () => {
      window.removeEventListener(OPEN_ASK_LINEAR_EVENT, handleOpenAssistant);
    };
  }, [openAssistant]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [close, open]);

  useEffect(() => {
    return () => {
      if (responseTimerRef.current) {
        clearTimeout(responseTimerRef.current);
      }
    };
  }, []);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = prompt.trim();
    if (!question || status === "loading") return;

    setMessages((current) => [...current, { role: "user", content: question }]);
    setPrompt("");
    setStatus("loading");

    if (responseTimerRef.current) {
      clearTimeout(responseTimerRef.current);
    }

    responseTimerRef.current = setTimeout(() => {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: `I can help with ${workspaceSlug || "this workspace"}${teamKey ? ` and team ${teamKey}` : ""}. Current route: ${currentPath}. This local assistant is ready to answer workspace questions once AI integration is connected.`,
        },
      ]);
      setStatus("idle");
    }, 250);
  }

  return (
    <>
      <button
        type="button"
        aria-label="Ask Linear"
        onClick={openAssistant}
        disabled={!canAskLinear}
        title={policyMessage ?? undefined}
        className="fixed right-5 bottom-5 z-40 flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-content-bg)] px-4 py-2.5 text-[13px] font-medium text-[var(--color-text-primary)] shadow-[var(--shadow-editorial-md)] transition hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[var(--color-content-bg)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span aria-hidden="true" className="text-[15px]">
          ✦
        </span>
        <span>Ask Linear</span>
      </button>

      {open ? (
        <aside
          aria-label="Ask Linear assistant"
          className="fixed right-5 bottom-20 z-[90] flex h-[min(560px,calc(100vh-7rem))] w-[min(420px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-[14px] border border-[var(--color-border-strong)] bg-[var(--color-content-bg)] shadow-[var(--shadow-editorial-md)]"
        >
          <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
                Ask Linear
              </h2>
              <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
                Workspace-aware help for {workspaceSlug || "your workspace"}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close Ask Linear"
              onClick={close}
              className="rounded-md px-2 py-1 text-[18px] leading-none text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              ×
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-[13px]">
            {messages.length === 0 ? (
              <div className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[var(--color-text-secondary)]">
                Ask about issues, projects, settings, or what to do next in this
                workspace.
              </div>
            ) : null}
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={
                  message.role === "user"
                    ? "ml-8 rounded-[10px] bg-[var(--color-accent)] p-3 text-white"
                    : "mr-8 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[var(--color-text-primary)]"
                }
              >
                {message.content}
              </div>
            ))}
            {status === "loading" ? (
              <output className="mr-8 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[var(--color-text-secondary)]">
                Ask Linear is thinking…
              </output>
            ) : null}
          </div>

          <form
            onSubmit={handleSubmit}
            className="border-t border-[var(--color-border)] p-3"
          >
            <label className="sr-only" htmlFor="ask-linear-prompt">
              Ask Linear prompt
            </label>
            <textarea
              id="ask-linear-prompt"
              ref={inputRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Ask about this workspace..."
              className="min-h-20 w-full resize-none rounded-[8px] border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-[var(--color-text-secondary)]">
              <span>Context: {currentPath}</span>
              <button
                type="submit"
                disabled={!prompt.trim() || status === "loading"}
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Ask
              </button>
            </div>
          </form>
        </aside>
      ) : null}
    </>
  );
}
