import {
  addCustomEmojiToWorkspaceSettings,
  readCustomEmojisFromWorkspaceSettings,
  removeCustomEmojiFromWorkspaceSettings,
  validateCustomEmojiInput,
} from "@/lib/custom-emojis";
import { describe, expect, it } from "vitest";

const imageUrl = "data:image/png;base64,iVBORw0KGgo=";

describe("custom emoji settings helpers", () => {
  it("normalizes, validates, reads, adds, and removes custom emojis", () => {
    expect(
      validateCustomEmojiInput({ name: ":Party_Parrot:", imageUrl }),
    ).toEqual({
      name: "party_parrot",
      imageUrl,
    });

    const add = addCustomEmojiToWorkspaceSettings(
      { other: true },
      {
        id: "emoji-1",
        name: "party",
        imageUrl,
        createdAt: "2026-05-17T00:00:00.000Z",
      },
    );
    expect("settings" in add).toBe(true);
    if (!("settings" in add)) return;
    expect(readCustomEmojisFromWorkspaceSettings(add.settings)).toHaveLength(1);
    expect(
      addCustomEmojiToWorkspaceSettings(add.settings, {
        id: "emoji-2",
        name: "party",
        imageUrl,
        createdAt: "2026-05-17T00:00:00.000Z",
      }),
    ).toEqual({ error: "A custom emoji with this name already exists" });

    const remove = removeCustomEmojiFromWorkspaceSettings(
      add.settings,
      "emoji-1",
    );
    expect(remove.found).toBe(true);
    expect(readCustomEmojisFromWorkspaceSettings(remove.settings)).toEqual([]);
  });

  it("rejects unsafe names and unsupported images", () => {
    expect(
      validateCustomEmojiInput({ name: "bad name", imageUrl }),
    ).toHaveProperty("error");
    expect(
      validateCustomEmojiInput({ name: "ok", imageUrl: "javascript:alert(1)" }),
    ).toHaveProperty("error");
  });
});
