"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

export default function EmojisSettingsPage() {
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
        Custom emojis
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Upload custom emojis to express your team's culture and personality.
      </p>

      <div className="mt-8">
        <EmptyState
          title="No custom emojis"
          description="Upload your first emoji to start using it in comments and reactions."
          action={{
            label: "Upload emoji",
            onClick: () => console.log("Upload"),
          }}
        />
      </div>
    </div>
  );
}
