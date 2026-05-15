"use client";

import { InsightsPanel } from "@/components/insights-panel";
import { useCallback, useEffect, useRef, useState } from "react";

interface ContextualInsightsProps {
  teamKey: string;
  scopedIssueIds: string[];
  contextLabel: string;
}

export function ContextualInsights({
  teamKey,
  scopedIssueIds,
  contextLabel,
}: ContextualInsightsProps) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => openerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "i"
      ) {
        event.preventDefault();
        setOpen(true);
        window.setTimeout(() => closeButtonRef.current?.focus(), 0);
      }

      if (event.key === "Escape" && open) {
        event.preventDefault();
        close();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close, open]);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current = document.querySelector<HTMLButtonElement>(
      '[aria-label="Close Insights"]',
    );
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);
  }, [open]);

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        aria-expanded={open}
        aria-label={`Open Insights for ${contextLabel}`}
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
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
          aria-hidden="true"
        >
          <path d="M3 3v18h18" />
          <path d="m7 14 3-3 3 2 5-6" />
        </svg>
        Insights
        <span className="sr-only">Ctrl Shift I</span>
      </button>
      {open && (
        <dialog open aria-label="Insights panel" className="contents">
          <button
            type="button"
            className="fixed inset-0 z-30 cursor-default bg-black/20"
            aria-label="Close Insights overlay"
            onClick={close}
            tabIndex={-1}
          />
          <InsightsPanel
            teamKey={teamKey}
            mode="drawer"
            open={open}
            onClose={close}
            scopedIssueIds={scopedIssueIds}
            contextLabel={contextLabel}
          />
        </dialog>
      )}
    </>
  );
}
