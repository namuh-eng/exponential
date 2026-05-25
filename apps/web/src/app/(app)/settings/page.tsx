"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
import { withWorkspaceSlug } from "@/lib/workspace-paths";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const SETTINGS_ROOT_REDIRECT_DELAY_MS = 750;

export default function SettingsPage() {
  const router = useRouter();
  const shellContext = useAppShellContext();

  useEffect(() => {
    const id = window.setTimeout(() => {
      router.replace(
        withWorkspaceSlug(
          "/settings/account/preferences",
          shellContext?.workspaceSlug,
        ),
      );
    }, SETTINGS_ROOT_REDIRECT_DELAY_MS);

    return () => window.clearTimeout(id);
  }, [router, shellContext?.workspaceSlug]);

  return (
    <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
      Redirecting...
    </div>
  );
}
