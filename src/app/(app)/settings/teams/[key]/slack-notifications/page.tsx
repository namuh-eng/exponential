"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface SlackSettings {
  channelName: string | null;
  isEnabled: boolean;
}

export default function TeamSlackSettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const [settings, setSettings] = useState<SlackSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // API placeholder
    setSettings({ channelName: null, isEnabled: false });
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  return (
    <div className="max-w-[720px]">
      <div className="mb-6">
        <Link
          href={`/settings/teams/${encodeURIComponent(teamKey)}`}
          className="text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Back to team settings
        </Link>
      </div>

      <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">
        Slack notifications
      </h1>
      <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
        Connect a Slack channel to receive updates about team activity.
      </p>

      <div className="mt-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-6 text-center">
        <div className="mb-4 flex justify-center">
          <svg
            aria-label="Slack"
            className="h-12 w-12 text-[var(--color-text-tertiary)]"
            viewBox="0 0 24 24"
            fill="currentColor"
            role="img"
          >
            <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.958 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.52 2.521h-2.522V8.834zM17.687 8.834a2.528 2.528 0 0 1-2.521 2.521 2.527 2.527 0 0 1-2.521-2.521V2.522A2.527 2.527 0 0 1 15.166 0a2.528 2.528 0 0 1 2.521 2.522v6.312zM15.166 18.958a2.528 2.528 0 0 1 2.521 2.522A2.528 2.528 0 0 1 15.166 24a2.527 2.527 0 0 1-2.521-2.522v-2.52h2.521zM15.166 17.687a2.527 2.527 0 0 1-2.521-2.521 2.527 2.527 0 0 1 2.521-2.521h6.312A2.527 2.527 0 0 1 24 15.166a2.528 2.528 0 0 1-2.522 2.521h-6.312z" />
          </svg>
        </div>
        <h3 className="mb-2 text-[15px] font-medium text-[var(--color-text-primary)]">
          Slack is not connected
        </h3>
        <p className="mb-6 text-[13px] text-[var(--color-text-secondary)]">
          Connect your workspace to Slack to start broadcasting team events.
        </p>
        <button
          type="button"
          className="rounded-md bg-white px-4 py-2 text-[13px] font-medium text-black hover:bg-white/90"
        >
          Connect Slack
        </button>
      </div>
    </div>
  );
}
