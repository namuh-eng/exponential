"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useRef, useState } from "react";

type CustomEmoji = {
  id: string;
  name: string;
  imageUrl: string;
  createdAt: string;
};

async function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read emoji image"));
    reader.readAsDataURL(file);
  });
}

export default function EmojisSettingsPage() {
  const [emojis, setEmojis] = useState<CustomEmoji[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function loadEmojis() {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/custom-emojis");
      if (!response.ok) {
        setError("Unable to load custom emojis.");
        setLoading(false);
        return;
      }
      const data = (await response.json()) as { emojis: CustomEmoji[] };
      setEmojis(data.emojis);
      setLoading(false);
    }

    void loadEmojis();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Choose an image file to upload.");
      setSaving(false);
      return;
    }

    try {
      const imageUrl = await readFileAsDataUrl(file);
      const response = await fetch("/api/custom-emojis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, imageUrl }),
      });
      const data = (await response.json()) as {
        emoji?: CustomEmoji;
        error?: string;
      };
      if (!response.ok || !data.emoji) {
        setError(data.error ?? "Unable to upload emoji.");
        setSaving(false);
        return;
      }
      setEmojis((current) =>
        [...current, data.emoji as CustomEmoji].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      setName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setMessage(`:${data.emoji.name}: uploaded.`);
    } catch {
      setError("Unable to upload emoji.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEmoji(emoji: CustomEmoji) {
    setError(null);
    setMessage(null);
    const response = await fetch(`/api/custom-emojis/${emoji.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setError("Unable to delete emoji.");
      return;
    }
    setEmojis((current) => current.filter((item) => item.id !== emoji.id));
    setMessage(`:${emoji.name}: deleted.`);
  }

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

      <form
        onSubmit={handleSubmit}
        className="mt-8 rounded-[var(--editorial-radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      >
        <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
          Upload emoji
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="text-[13px] font-medium text-[var(--color-text-secondary)]">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="party_parrot"
              aria-label="Emoji name"
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[14px] text-[var(--color-text-primary)]"
            />
          </label>
          <label className="text-[13px] font-medium text-[var(--color-text-secondary)]">
            Image
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
              aria-label="Emoji image"
              className="mt-1 block w-full text-[13px] text-[var(--color-text-secondary)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--color-surface-2)] file:px-3 file:py-2 file:text-[13px] file:text-[var(--color-text-primary)]"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-[var(--color-accent)] px-4 py-[9px] text-[13px] font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Uploading..." : "Upload emoji"}
          </button>
        </div>
        <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)]">
          Use lowercase letters, numbers, underscores, or hyphens. Images are
          stored with workspace settings for this clone.
        </p>
      </form>

      {error && <p className="mt-4 text-[13px] text-red-500">{error}</p>}
      {message && (
        <p className="mt-4 text-[13px] text-[var(--color-text-secondary)]">
          {message}
        </p>
      )}

      <div className="mt-8">
        {emojis.length === 0 ? (
          <EmptyState
            title="No custom emojis"
            description="Upload your first emoji to start using it in comments and reactions."
          />
        ) : (
          <div className="overflow-hidden rounded-[var(--editorial-radius-lg)] border border-[var(--color-border)]">
            {emojis.map((emoji) => (
              <div
                key={emoji.id}
                className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3 last:border-b-0"
              >
                <div className="flex items-center gap-3">
                  <img
                    src={emoji.imageUrl}
                    alt={`:${emoji.name}:`}
                    className="h-8 w-8 rounded object-contain"
                  />
                  <div>
                    <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
                      :{emoji.name}:
                    </div>
                    <div className="text-[12px] text-[var(--color-text-tertiary)]">
                      Added {new Date(emoji.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void deleteEmoji(emoji)}
                  className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
