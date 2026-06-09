"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
import PreferencesPage from "@/app/(app)/settings/account/preferences/page";
import { withWorkspaceSlug } from "@/lib/workspace-paths";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function SettingsPage() {
  const pathname = usePathname();
  const router = useRouter();
  const shellContext = useAppShellContext();
  const workspaceSlug = shellContext?.workspaceSlug;
  const sluggedSettingsRoot = workspaceSlug
    ? `/${encodeURIComponent(workspaceSlug)}/settings`
    : null;
  const isSluggedSettingsRoot = pathname === sluggedSettingsRoot;

  useEffect(() => {
    if (isSluggedSettingsRoot) {
      return;
    }

    router.replace(
      withWorkspaceSlug("/settings/account/preferences", workspaceSlug),
    );
  }, [isSluggedSettingsRoot, router, workspaceSlug]);

  if (isSluggedSettingsRoot) {
    return <PreferencesPage />;
  }

  return (
    <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
      Redirecting...
    </div>
  );
}
