"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

export default function PulseSettingsPage() {
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
        Pulse
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Visualize team activity, velocity, and health over time.
      </p>

      <div className="mt-8">
        <EmptyState
          title="Pulse is ready"
          description="Your workspace activity is being tracked. Review team velocity and burnout trends."
        />
      </div>
    </div>
  );
}
