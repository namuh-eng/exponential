"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

export default function ConnectedAccountsPage() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">Loading...</div>
    );
  }

  return (
    <div className="max-w-[720px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Connected accounts
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Manage your social logins and third-party account connections.
      </p>

      <div className="mt-8">
        <EmptyState
          title="No connected accounts"
          description="You are currently signed in via email. Link other accounts for easier access."
          action={{
            label: "Connect account",
            onClick: () => console.log("Connect"),
          }}
        />
      </div>
    </div>
  );
}
