export type CustomEmoji = {
  id: string;
  name: string;
  imageUrl: string;
  createdAt: string;
};

const MAX_EMOJIS = 100;
const MAX_NAME_LENGTH = 32;
const MAX_IMAGE_URL_LENGTH = 250_000;
const CUSTOM_EMOJI_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isCustomEmoji(value: unknown): value is CustomEmoji {
  const record = asRecord(value);
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.imageUrl === "string" &&
    typeof record.createdAt === "string" &&
    CUSTOM_EMOJI_NAME_PATTERN.test(record.name) &&
    isSupportedEmojiImageUrl(record.imageUrl)
  );
}

export function isSupportedEmojiImageUrl(value: string) {
  if (value.length > MAX_IMAGE_URL_LENGTH) return false;
  return (
    /^https?:\/\//.test(value) ||
    /^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml);base64,/i.test(value)
  );
}

export function normalizeCustomEmojiName(value: unknown) {
  return typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/^:+|:+$/g, "")
    : "";
}

export function validateCustomEmojiInput(input: {
  name: unknown;
  imageUrl: unknown;
}) {
  const name = normalizeCustomEmojiName(input.name);
  if (!name) return { error: "Emoji name is required" };
  if (name.length > MAX_NAME_LENGTH || !CUSTOM_EMOJI_NAME_PATTERN.test(name)) {
    return {
      error:
        "Emoji name must be 1-32 lowercase letters, numbers, underscores, or hyphens",
    };
  }

  const imageUrl = typeof input.imageUrl === "string" ? input.imageUrl : "";
  if (!imageUrl || !isSupportedEmojiImageUrl(imageUrl)) {
    return {
      error: "A PNG, JPG, GIF, WebP, SVG data URL or image URL is required",
    };
  }

  return { name, imageUrl };
}

export function readCustomEmojisFromWorkspaceSettings(
  settings: unknown,
): CustomEmoji[] {
  const customEmojis = asRecord(settings).customEmojis;
  if (!Array.isArray(customEmojis)) return [];
  return customEmojis
    .filter(isCustomEmoji)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function addCustomEmojiToWorkspaceSettings(
  settings: unknown,
  emoji: CustomEmoji,
) {
  const parsed = asRecord(settings);
  const customEmojis = readCustomEmojisFromWorkspaceSettings(settings);
  if (customEmojis.length >= MAX_EMOJIS) {
    return { error: "Custom emoji limit reached" };
  }
  if (customEmojis.some((existing) => existing.name === emoji.name)) {
    return { error: "A custom emoji with this name already exists" };
  }
  return { settings: { ...parsed, customEmojis: [...customEmojis, emoji] } };
}

export function removeCustomEmojiFromWorkspaceSettings(
  settings: unknown,
  emojiId: string,
) {
  const parsed = asRecord(settings);
  const customEmojis = readCustomEmojisFromWorkspaceSettings(settings);
  const nextCustomEmojis = customEmojis.filter((emoji) => emoji.id !== emojiId);
  return {
    found: nextCustomEmojis.length !== customEmojis.length,
    settings: { ...parsed, customEmojis: nextCustomEmojis },
  };
}
