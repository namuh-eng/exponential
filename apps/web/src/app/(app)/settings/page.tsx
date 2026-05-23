"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
import { withWorkspaceSlug } from "@/lib/workspace-paths";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function SettingsPage() {
  const router = useRouter();
  const shellContext = useAppShellContext();

  useEffect(() => {
    router.replace(
      withWorkspaceSlug(
        "/settings/account/preferences",
        shellContext?.workspaceSlug,
      ),
    );
  }, [router, shellContext?.workspaceSlug]);

  return (
    <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
      Redirecting...
    </div>
  );
}
