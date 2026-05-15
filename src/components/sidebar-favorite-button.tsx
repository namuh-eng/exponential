"use client";

import {
  SIDEBAR_FAVORITES_CHANGED_EVENT,
  type SidebarFavoriteObjectType,
} from "@/lib/sidebar-favorites";
import { useEffect, useState } from "react";

interface SidebarFavoriteButtonProps {
  objectType: SidebarFavoriteObjectType;
  objectId: string;
  label?: string;
  className?: string;
}

export function SidebarFavoriteButton({
  objectType,
  objectId,
  label,
  className,
}: SidebarFavoriteButtonProps) {
  const [favorited, setFavorited] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "test") {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadFavoriteState() {
      try {
        const response = await fetch("/api/sidebar/favorites", {
          credentials: "include",
        });
        if (!response?.ok) return;

        const data = (await response.json()) as {
          favorites?: Array<{ objectType: string; objectId: string }>;
        };
        if (cancelled) return;

        setFavorited(
          (data.favorites ?? []).some(
            (favorite) =>
              favorite.objectType === objectType &&
              favorite.objectId === objectId,
          ),
        );
      } catch {
        if (!cancelled) setFavorited(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadFavoriteState();
    return () => {
      cancelled = true;
    };
  }, [objectType, objectId]);

  async function toggleFavorite() {
    if (saving) return;

    const nextFavorited = !favorited;
    setFavorited(nextFavorited);
    setSaving(true);

    try {
      const response = await fetch(
        nextFavorited
          ? "/api/sidebar/favorites"
          : `/api/sidebar/favorites?objectType=${encodeURIComponent(
              objectType,
            )}&objectId=${encodeURIComponent(objectId)}`,
        {
          method: nextFavorited ? "POST" : "DELETE",
          headers: nextFavorited
            ? { "Content-Type": "application/json" }
            : undefined,
          credentials: "include",
          body: nextFavorited ? JSON.stringify({ objectType, objectId }) : null,
        },
      );

      if (!response.ok) {
        setFavorited(!nextFavorited);
        return;
      }

      window.dispatchEvent(new Event(SIDEBAR_FAVORITES_CHANGED_EVENT));
    } catch {
      setFavorited(!nextFavorited);
    } finally {
      setSaving(false);
    }
  }

  const actionLabel = favorited ? "Remove from favorites" : "Add to favorites";
  const visibleLabel = favorited ? "Favorited" : "Favorite";

  return (
    <button
      type="button"
      aria-label={`${actionLabel}${label ? `: ${label}` : ""}`}
      aria-pressed={favorited}
      disabled={loading || saving}
      onClick={() => void toggleFavorite()}
      className={
        className ??
        `rounded-full border px-3 py-1.5 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          favorited
            ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]"
            : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        }`
      }
    >
      <span aria-hidden="true">{favorited ? "★" : "☆"}</span> {visibleLabel}
    </button>
  );
}
